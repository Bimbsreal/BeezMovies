import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { backupState } from '../ops/flags.js';
import { backupLevel } from '../ops/status.js';
import { IngestionError } from './errors.js';
import { normalizeMovie } from './normalize.js';
import { qualityIssues } from './quality-gate.js';
import { getAdapter, loadSource } from './registry.js';
import { resolveMovie } from './resolve.js';
import { countrySeedReport } from '../catalog/countries.js';

export function classifySeedRecord({ issues, match, error }) {
  if (error) return error.transient ? 'failed' : 'invalid';
  if (match?.confidence === 'high') return 'duplicate';
  if (match?.confidence === 'medium') return 'review';
  if (issues?.length) return 'incomplete';
  return 'valid';
}

function present(row, batches = []) {
  const discovered = row.discovered || 0;
  const processed = row.processed || 0;
  const elapsedMinutes = Math.max((Date.now() - new Date(row.started_at).getTime()) / 60000, 1 / 60);
  const remaining = discovered > processed ? discovered - processed : 0;
  return {
    id: row.id,
    source: row.source_slug,
    mode: row.mode,
    status: row.status,
    cursor: row.cursor_offset,
    discovered,
    processed,
    valid: row.valid_count,
    invalid: row.invalid_count,
    incomplete: row.incomplete_count,
    duplicates: row.duplicate_count,
    review: row.review_count,
    approved: row.approved_count,
    published: row.published_count,
    failed: row.failed_count,
    batchSize: row.batch_size,
    progress: discovered === 0 ? 0 : Math.round((processed / discovered) * 100),
    processingRatePerMinute: Number((processed / elapsedMinutes).toFixed(2)),
    remaining,
    lastError: row.last_error,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    batches: batches.map((batch) => ({
      id: batch.id,
      index: batch.batch_index,
      cursorBefore: batch.cursor_before,
      cursorAfter: batch.cursor_after,
      started: batch.started,
      processed: batch.processed,
      accepted: batch.accepted,
      rejected: batch.rejected,
      duplicates: batch.duplicates,
      errors: batch.errors,
    })),
  };
}

async function latestRun() {
  const result = await getPool().query(
    `SELECT * FROM catalog_seed_runs ORDER BY started_at DESC LIMIT 1`,
  );
  return result.rows[0] || null;
}

async function runById(id) {
  const result = await getPool().query('SELECT * FROM catalog_seed_runs WHERE id = $1', [id]);
  if (!result.rowCount) throw new AppError('Seed run not found', { status: 404, code: 'NOT_FOUND' });
  return result.rows[0];
}

async function withBatches(row) {
  if (!row) return null;
  const batches = await getPool().query(
    `SELECT * FROM catalog_seed_batches WHERE run_id = $1 ORDER BY batch_index DESC LIMIT 8`,
    [row.id],
  );
  return present(row, batches.rows);
}

export async function seedSafety() {
  const backup = await backupState();
  const level = backupLevel(backup);
  const reasons = [];
  if (level !== 'HEALTHY') reasons.push('A verified database backup is not recorded');
  if (!backup.lastRestoreFailureAt && !backup.lastSuccessAt) reasons.push('A restore drill has not been recorded');
  return {
    applyAllowed: false,
    backup: level,
    reasons,
  };
}

export async function bootstrapStatus() {
  const safety = await seedSafety();
  const run = await withBatches(await latestRun());
  let source = null;
  try {
    const loaded = await loadSource('development-metadata');
    const adapter = getAdapter(loaded.slug);
    source = {
      provider: adapter?.descriptor?.name || loaded.name,
      slug: loaded.slug,
      authentication: adapter?.descriptor?.authentication || 'none',
      endpoints: adapter?.descriptor?.endpoints || [],
      rateLimit: {
        requestsPerMinute: loaded.requestsPerMinute,
        minIntervalMs: loaded.minIntervalMs,
        concurrency: loaded.concurrencyLimit,
      },
      metadata: adapter?.descriptor?.metadata || [],
      attribution: adapter?.descriptor?.attribution || loaded.slug,
      allowedHosts: loaded.allowedHosts,
    };
  } catch {
    source = null;
  }
  return { run, source, safety, countries: await countrySeedReport() };
}

export async function startDryRun(actorId, { source = 'development-metadata', batchSize = 10 } = {}) {
  if (source !== 'development-metadata') {
    throw new AppError('Only the approved development metadata source can be bootstrapped', {
      status: 400,
      code: 'SOURCE_NOT_APPROVED',
    });
  }
  const size = Number.isInteger(batchSize) && batchSize >= 1 && batchSize <= 25 ? batchSize : 10;
  await loadSource(source);
  const created = await getPool().query(
    `INSERT INTO catalog_seed_runs (source_slug, mode, status, batch_size, opened_by)
     VALUES ($1, 'dry_run', 'running', $2, $3)
     RETURNING *`,
    [source, size, actorId],
  );
  return withBatches(created.rows[0]);
}

async function classifyOne(source, adapter, externalId) {
  try {
    const raw = await adapter.getMovie(externalId);
    const normalized = normalizeMovie(raw, source.allowedHosts);
    const issues = qualityIssues(normalized);
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const match = await resolveMovie(client, source, normalized);
      await client.query('ROLLBACK');
      return {
        outcome: classifySeedRecord({ issues, match, error: null }),
        qualityPass: issues.length === 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    const transient = error instanceof IngestionError ? error.transient !== false : true;
    return {
      outcome: classifySeedRecord({
        issues: [],
        match: null,
        error: { transient: error instanceof IngestionError ? error.transient === true : transient },
      }),
      qualityPass: false,
    };
  }
}

export async function advanceDryRun(id) {
  const run = await runById(id);
  if (run.status === 'paused') {
    throw new AppError('The seed run is paused', { status: 409, code: 'SEED_PAUSED' });
  }
  if (run.status === 'cancelled' || run.status === 'completed') {
    throw new AppError('The seed run is not running', { status: 409, code: 'SEED_CLOSED' });
  }
  const source = await loadSource(run.source_slug);
  const adapter = getAdapter(source.slug);
  if (!adapter?.listPage) {
    throw new AppError('The approved source has no restartable page method', { status: 409, code: 'SOURCE_NOT_APPROVED' });
  }
  const page = await adapter.listPage({ cursor: run.cursor_offset, limit: run.batch_size });
  const totals = {
    valid: 0, invalid: 0, incomplete: 0, duplicate: 0, review: 0, failed: 0, quality: 0,
  };
  for (const item of page.items) {
    const result = await classifyOne(source, adapter, item.externalId);
    totals[result.outcome] += 1;
    if (result.qualityPass) totals.quality += 1;
  }
  const processed = page.items.length;
  const accepted = totals.valid;
  const rejected = totals.invalid + totals.incomplete;
  const nextCursor = page.nextCursor == null ? page.total : page.nextCursor;
  const approved = totals.valid;
  const done = nextCursor >= page.total || processed === 0;
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const batchIndex = await client.query(
      'SELECT COALESCE(MAX(batch_index), 0)::int AS max_index FROM catalog_seed_batches WHERE run_id = $1',
      [id],
    );
    await client.query(
      `INSERT INTO catalog_seed_batches (
         run_id, batch_index, cursor_before, cursor_after, started, processed, accepted, rejected, duplicates, errors
       ) VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9)`,
      [
        id,
        batchIndex.rows[0].max_index + 1,
        run.cursor_offset,
        nextCursor,
        processed,
        accepted,
        rejected,
        totals.duplicate,
        totals.failed + totals.invalid,
      ],
    );
    const updated = await client.query(
      `UPDATE catalog_seed_runs
       SET cursor_offset = $2,
           discovered = $3,
           processed = processed + $4,
           valid_count = valid_count + $5,
           invalid_count = invalid_count + $6,
           incomplete_count = incomplete_count + $7,
           duplicate_count = duplicate_count + $8,
           review_count = review_count + $9,
           approved_count = approved_count + $10,
           failed_count = failed_count + $11,
           status = $12,
           finished_at = CASE WHEN $12 = 'completed' THEN NOW() ELSE finished_at END,
           updated_at = NOW(),
           last_error = NULL
       WHERE id = $1
       RETURNING *`,
      [
        id,
        nextCursor,
        page.total,
        processed,
        totals.quality,
        totals.invalid,
        totals.incomplete,
        totals.duplicate,
        totals.review,
        approved,
        totals.failed,
        done ? 'completed' : 'running',
      ],
    );
    await client.query('COMMIT');
    return withBatches(updated.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function setStatus(id, from, to) {
  const result = await getPool().query(
    `UPDATE catalog_seed_runs
     SET status = $2, updated_at = NOW()
     WHERE id = $1 AND status = $3
     RETURNING *`,
    [id, to, from],
  );
  if (!result.rowCount) throw new AppError('The seed run cannot change state', { status: 409, code: 'SEED_CLOSED' });
  return withBatches(result.rows[0]);
}

export function pauseDryRun(id) {
  return setStatus(id, 'running', 'paused');
}

export function resumeDryRun(id) {
  return setStatus(id, 'paused', 'running');
}

export async function cancelDryRun(id) {
  const result = await getPool().query(
    `UPDATE catalog_seed_runs
     SET status = 'cancelled', updated_at = NOW(), finished_at = NOW()
     WHERE id = $1 AND status IN ('running', 'paused', 'failed')
     RETURNING *`,
    [id],
  );
  if (!result.rowCount) throw new AppError('The seed run cannot be cancelled', { status: 409, code: 'SEED_CLOSED' });
  return withBatches(result.rows[0]);
}

export function retryDryRun(id) {
  return setStatus(id, 'failed', 'running');
}

export async function refuseProductionSeed() {
  const safety = await seedSafety();
  throw new AppError(safety.reasons[0] || 'Production seeding is not approved', {
    status: 409,
    code: 'SEED_BLOCKED',
    details: { reasons: safety.reasons, applyAllowed: false },
  });
}
