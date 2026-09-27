import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { fingerprintValue, normalizeMovie } from './normalize.js';
import { publicFailure } from './errors.js';
import { enqueueJob } from './jobs.js';
import { getAdapter, loadSource } from './registry.js';
import { withReservedSource } from './rate-limit.js';
import { DISCOVER_BATCH_LIMIT } from './constants.js';
import { productionCatalogStatus } from './census.js';

export const SYNC_QUEUE_LIMIT = 40;

const TASKS = [
  'catalog-sync',
  'metadata-update',
  'country-sync',
  'genre-sync',
  'artwork-sync',
  'series-sync',
  'episode-sync',
  'search-index',
  'cache-invalidation',
];

export function shouldThrottleSync(queueDepth, limit = SYNC_QUEUE_LIMIT) {
  return queueDepth >= limit;
}

export function classifySyncRecord(record) {
  const layers = ['catalog-sync', 'metadata-update'];
  if (record.countries) layers.push('country-sync');
  if (record.genres) layers.push('genre-sync');
  if (record.artwork) layers.push('artwork-sync');
  if (record.contentType === 'series' || record.seasons > 0) {
    layers.push('series-sync');
    if (record.seasons > 0) layers.push('episode-sync');
  }
  if (record.trailerRemoved) layers.push('metadata-update');
  layers.push('search-index', 'cache-invalidation');
  const disposition = record.previousFingerprint && record.previousFingerprint === record.fingerprint
    ? 'unchanged'
    : (record.previousFingerprint ? 'updated' : 'created');
  return {
    disposition,
    layers: [...new Set(layers)].filter((layer) => TASKS.includes(layer)),
  };
}

function presentRun(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source_slug,
    mode: row.mode,
    status: row.status,
    discovered: row.discovered,
    created: row.created_count,
    updated: row.updated_count,
    unchanged: row.unchanged_count,
    duplicates: row.duplicate_count,
    rejected: row.rejected_count,
    review: row.review_count,
    failed: row.failed_count,
    note: row.note,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

async function queueDepth() {
  const result = await getPool().query(
    `SELECT COUNT(*)::int AS depth
     FROM ingestion_jobs
     WHERE status IN ('pending', 'processing', 'failed')`,
  );
  return result.rows[0].depth;
}

async function latestFingerprint(sourceId, externalId) {
  const result = await getPool().query(
    `SELECT fingerprint
     FROM ingestion_records
     WHERE catalog_source_id = $1 AND external_id = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [sourceId, externalId],
  );
  return result.rows[0]?.fingerprint || null;
}

async function activeJob(sourceId, externalId) {
  const result = await getPool().query(
    `SELECT id FROM ingestion_jobs
     WHERE catalog_source_id = $1 AND external_id = $2
       AND status IN ('pending', 'processing', 'failed')
     LIMIT 1`,
    [sourceId, externalId],
  );
  return result.rowCount > 0;
}

async function addTask(runId, kind, status, externalId, detail) {
  await getPool().query(
    `INSERT INTO catalog_sync_tasks (run_id, task_kind, status, external_id, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [runId, kind, status, externalId, JSON.stringify(detail || {})],
  );
}

async function bump(runId, column) {
  await getPool().query(
    `UPDATE catalog_sync_runs SET ${column} = ${column} + 1 WHERE id = $1`,
    [runId],
  );
}

export async function advanceSync(runId, { layer = 'catalog' } = {}) {
  const current = await getPool().query(
    `SELECT r.*, s.slug AS source_slug
     FROM catalog_sync_runs r
     JOIN catalog_sources s ON s.id = r.catalog_source_id
     WHERE r.id = $1`,
    [runId],
  );
  const run = current.rows[0];
  if (!run || run.status !== 'running') return presentRun(run);
  const source = await loadSource(run.source_slug);
  const adapter = getAdapter(source.slug);
  if (!adapter?.listPage) {
    throw new AppError('This source does not publish a resumable catalog page', {
      status: 409,
      code: 'SYNC_UNSUPPORTED',
    });
  }
  const checkpoint = await getPool().query(
    'SELECT * FROM catalog_sync_checkpoints WHERE catalog_source_id = $1',
    [source.id],
  );
  const cursor = checkpoint.rows[0]?.failure_position ?? checkpoint.rows[0]?.cursor_position ?? 0;
  const page = await adapter.listPage({ cursor, limit: DISCOVER_BATCH_LIMIT });
  let stopAt = null;
  const priorSeen = checkpoint.rows[0]?.seen_external_ids || [];
  const seen = new Set(cursor === 0 ? [] : priorSeen);

  for (let index = 0; index < page.items.length; index += 1) {
    const item = page.items[index];
    seen.add(item.externalId);
    const reserved = await withReservedSource(source, () => adapter.getMovie(item.externalId));
    if (!reserved.ok) {
      stopAt = page.cursor + index;
      await bump(runId, 'failed_count');
      await addTask(runId, 'catalog-sync', 'failed', item.externalId, { reason: 'rate-limit' });
      break;
    }
    try {
      const normalized = normalizeMovie(reserved.value, source.allowedHosts);
      const fingerprint = fingerprintValue(normalized);
      const previousFingerprint = await latestFingerprint(source.id, item.externalId);
      const queuedAlready = await activeJob(source.id, item.externalId);
      const decision = classifySyncRecord({
        fingerprint,
        previousFingerprint: queuedAlready ? fingerprint : previousFingerprint,
        contentType: normalized.contentType,
        seasons: normalized.seasons?.length || 0,
        countries: normalized.countries.length > 0,
        genres: normalized.genres.length > 0,
        artwork: normalized.images.length > 0,
        trailerRemoved: false,
      });
      const episodeOnly = layer === 'episode';
      const relevant = !episodeOnly || decision.layers.includes('episode-sync') || decision.layers.includes('series-sync');
      if (!relevant || decision.disposition === 'unchanged' || queuedAlready) {
        await bump(runId, 'unchanged_count');
        for (const kind of decision.layers) {
          await addTask(runId, kind, 'skipped', item.externalId, { disposition: 'unchanged' });
        }
      } else {
        await enqueueJob({
          source,
          externalId: item.externalId,
          operation: 'refresh',
          jobType: 'metadata:upsert',
          payload: { origin: 'sync', discovery: 'REVALIDATION', runId },
        });
        await bump(runId, previousFingerprint ? 'updated_count' : 'created_count');
        for (const kind of decision.layers) {
          await addTask(runId, kind, 'pending', item.externalId, { disposition: decision.disposition });
        }
      }
      await bump(runId, 'discovered');
      await getPool().query(
        `UPDATE catalog_sync_checkpoints
         SET last_success_external_id = $2, failure_position = NULL, updated_at = NOW()
         WHERE catalog_source_id = $1`,
        [source.id, item.externalId],
      );
    } catch (error) {
      const failure = publicFailure(error);
      await bump(runId, failure.transient ? 'failed_count' : 'rejected_count');
      await addTask(runId, 'catalog-sync', 'failed', item.externalId, { code: failure.code });
      if (failure.transient) {
        stopAt = page.cursor + index;
        break;
      }
      await bump(runId, 'discovered');
    }
  }

  const finishedPage = stopAt === null;
  const nextCursor = finishedPage ? (page.nextCursor ?? 0) : stopAt;
  const completed = finishedPage && page.nextCursor == null;
  let review = 0;
  if (completed) {
    for (const id of priorSeen) {
      if (!seen.has(id)) review += 1;
    }
  }
  await getPool().query(
    `UPDATE catalog_sync_checkpoints
     SET cursor_position = $2,
         page_number = page_number + 1,
         failure_position = $3,
         last_synchronized_at = CASE WHEN $4 THEN NOW() ELSE last_synchronized_at END,
         initial_completed = initial_completed OR $4,
         seen_external_ids = $5,
         updated_at = NOW()
     WHERE catalog_source_id = $1`,
    [source.id, nextCursor, stopAt, completed, [...seen].slice(-500)],
  );
  if (review) {
    await getPool().query(
      `UPDATE catalog_sync_runs SET review_count = review_count + $2 WHERE id = $1`,
      [runId, review],
    );
    await addTask(runId, 'catalog-sync', 'pending', null, { reason: 'missing-from-source', count: review });
  }
  const status = completed ? 'completed' : 'running';
  const updated = await getPool().query(
    `UPDATE catalog_sync_runs
     SET status = $2, finished_at = CASE WHEN $2 = 'completed' THEN NOW() ELSE finished_at END
     WHERE id = $1
     RETURNING *`,
    [runId, status],
  );
  return presentRun({ ...updated.rows[0], source_slug: source.slug });
}

export async function startSync(actorId, { sourceSlug, mode = 'manual', layer = 'catalog' }) {
  const source = await loadSource(sourceSlug);
  if (source.status !== 'active') {
    throw new AppError('Metadata source is not active', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const active = await getPool().query(
    `SELECT r.*, s.slug AS source_slug
     FROM catalog_sync_runs r
     JOIN catalog_sources s ON s.id = r.catalog_source_id
     WHERE r.catalog_source_id = $1 AND r.status IN ('running', 'paused')
     ORDER BY r.started_at DESC
     LIMIT 1`,
    [source.id],
  );
  if (active.rowCount) return presentRun(active.rows[0]);

  const depth = await queueDepth();
  const throttled = shouldThrottleSync(depth);
  await getPool().query(
    `INSERT INTO catalog_sync_checkpoints (catalog_source_id)
     VALUES ($1)
     ON CONFLICT (catalog_source_id) DO NOTHING`,
    [source.id],
  );
  const checkpoint = await getPool().query(
    'SELECT initial_completed FROM catalog_sync_checkpoints WHERE catalog_source_id = $1',
    [source.id],
  );
  let selected = mode === 'manual' ? 'incremental' : mode;
  let note = null;
  if (selected === 'initial' && checkpoint.rows[0]?.initial_completed) {
    selected = 'incremental';
    note = 'Initial synchronization already completed. Continuing from the checkpoint.';
  }
  if (mode === 'manual') selected = 'manual';
  if (mode === 'scheduled') selected = 'scheduled';
  const created = await getPool().query(
    `INSERT INTO catalog_sync_runs (catalog_source_id, mode, status, note)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [source.id, selected === 'initial' ? 'initial' : selected, throttled ? 'throttled' : 'running', note],
  );
  if (throttled) {
    return syncBoard();
  }
  await advanceSync(created.rows[0].id, { layer });
  if (actorId) {
    const { recordAudit } = await import('../admin/audit.js');
    await recordAudit(null, {
      actorId,
      action: 'CATALOG_SYNC_STARTED',
      targetType: 'catalog_source',
      targetId: source.id,
      metadata: { mode: selected },
    });
  }
  return syncBoard();
}

async function setRunStatus(runId, from, status) {
  const result = await getPool().query(
    `UPDATE catalog_sync_runs
     SET status = $3,
         finished_at = CASE WHEN $3 IN ('cancelled', 'completed') THEN NOW() ELSE finished_at END
     WHERE id = $1 AND status = $2
     RETURNING id`,
    [runId, from, status],
  );
  if (!result.rowCount) {
    throw new AppError('That synchronization cannot be changed', { status: 409, code: 'CONFLICT' });
  }
}

export async function pauseSync(runId) {
  await setRunStatus(runId, 'running', 'paused');
  return syncBoard();
}

export async function resumeSync(runId) {
  await setRunStatus(runId, 'paused', 'running');
  await advanceSync(runId);
  return syncBoard();
}

export async function cancelSync(runId) {
  const result = await getPool().query(
    `UPDATE catalog_sync_runs
     SET status = 'cancelled', finished_at = NOW()
     WHERE id = $1 AND status IN ('running', 'paused', 'throttled')
     RETURNING id`,
    [runId],
  );
  if (!result.rowCount) {
    throw new AppError('That synchronization cannot be cancelled', { status: 409, code: 'CONFLICT' });
  }
  return syncBoard();
}

export async function retryFailedSync(actorId) {
  const { retryFailedIngestion } = await import('./admin-service.js');
  return retryFailedIngestion(actorId);
}

export async function syncHealth() {
  const result = await getPool().query(
    `SELECT
       (SELECT COUNT(*)::int FROM movies WHERE content_type_id IS NULL AND archived_at IS NULL) AS unknown_type,
       (SELECT COUNT(*)::int FROM movies m
         WHERE m.status = 'active' AND NOT EXISTS (
           SELECT 1 FROM movie_countries mc WHERE mc.movie_id = m.id
         )) AS unknown_country,
       (SELECT COUNT(*)::int FROM episodes e
         LEFT JOIN seasons s ON s.id = e.season_id
         LEFT JOIN movies m ON m.id = s.series_id
         WHERE s.id IS NULL OR m.id IS NULL) AS orphan_episodes,
       (SELECT COUNT(*)::int FROM movies m
         WHERE m.status = 'active' AND NOT EXISTS (
           SELECT 1 FROM search_documents d
           JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
           WHERE d.movie_id = m.id AND d.status = 'active'
         )) AS search_mismatches,
       (SELECT COUNT(*)::int FROM movie_videos WHERE available = FALSE) AS trailers_unavailable,
       (SELECT COALESCE(json_agg(code ORDER BY sort_order), '[]'::json)
         FROM content_types WHERE active = TRUE) AS content_types`,
  );
  const labels = await getPool().query(
    `SELECT c.code AS country, t.code AS type, l.label
     FROM industry_labels l
     JOIN countries c ON c.id = l.country_id
     JOIN content_types t ON t.id = l.content_type_id
     WHERE l.origin = 'derived' AND l.active = TRUE
     ORDER BY c.code, t.code`,
  );
  return {
    unknownContentType: result.rows[0].unknown_type,
    unknownCountry: result.rows[0].unknown_country,
    orphanEpisodes: result.rows[0].orphan_episodes,
    searchMismatches: result.rows[0].search_mismatches,
    trailersUnavailable: result.rows[0].trailers_unavailable,
    contentTypes: result.rows[0].content_types,
    industryLabels: labels.rows,
    mediaNote: 'Catalog synchronization does not mark a title downloadable. Media availability stays on the approved media provider.',
  };
}

export async function syncBoard() {
  const runs = await getPool().query(
    `SELECT r.*, s.slug AS source_slug
     FROM catalog_sync_runs r
     JOIN catalog_sources s ON s.id = r.catalog_source_id
     ORDER BY r.started_at DESC
     LIMIT 8`,
  );
  const checkpoints = await getPool().query(
    `SELECT c.cursor_position, c.page_number, c.last_synchronized_at, c.last_success_external_id,
            c.failure_position, c.initial_completed, s.slug
     FROM catalog_sync_checkpoints c
     JOIN catalog_sources s ON s.id = c.catalog_source_id
     ORDER BY s.slug`,
  );
  const depth = await queueDepth();
  const latency = await getPool().query(
    `SELECT s.slug,
            CASE WHEN r.success_count > 0 THEN (r.total_latency_ms / r.success_count)::int ELSE 0 END AS average_ms,
            r.error_count, r.success_count
     FROM catalog_sources s
     LEFT JOIN catalog_source_runtime r ON r.catalog_source_id = s.id
     WHERE s.archived_at IS NULL
     ORDER BY s.slug`,
  );
  const current = runs.rows.find((row) => row.status === 'running' || row.status === 'paused') || null;
  const last = runs.rows.find((row) => row.status === 'completed' || row.status === 'cancelled') || runs.rows[0] || null;
  const failed = runs.rows.reduce((sum, row) => sum + row.failed_count, 0);
  const discovered = runs.rows.reduce((sum, row) => sum + row.discovered, 0);
  const health = await syncHealth();
  const catalog = await productionCatalogStatus();
  const alerts = [];
  if (failed > 0) alerts.push('A synchronization record failed and was left for review or retry.');
  if (!catalog.seeding.applyAllowed) alerts.push(catalog.seeding.reasons[0] || 'Production seeding is blocked.');
  return {
    current: presentRun(current),
    last: presentRun(last),
    runs: runs.rows.map(presentRun),
    checkpoints: checkpoints.rows.map((row) => ({
      source: row.slug,
      cursor: row.cursor_position,
      page: row.page_number,
      lastSynchronizedAt: row.last_synchronized_at,
      lastSuccessExternalId: row.last_success_external_id,
      failurePosition: row.failure_position,
      initialCompleted: row.initial_completed,
    })),
    queueDepth: depth,
    throttled: shouldThrottleSync(depth),
    sources: latency.rows.map((row) => ({
      slug: row.slug,
      averageLatencyMs: Number(row.average_ms) || 0,
      successCount: Number(row.success_count) || 0,
      errorCount: Number(row.error_count) || 0,
    })),
    failureRate: discovered ? Math.round((failed / discovered) * 100) : 0,
    alerts,
    catalog,
    health,
    schedules: {
      incremental: 'Daily incremental sync is installed and disabled. The shortest allowed interval is one hour.',
      episodes: 'Daily episode sync is installed and disabled. It queues series records only.',
    },
  };
}

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const syncStartSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    source: slug,
    mode: z.enum(['initial', 'incremental', 'manual']).default('manual'),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const syncRunSchema = z.object({
  body: z.object({ confirm: z.literal(true) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});
