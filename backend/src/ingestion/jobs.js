import { getPool } from '../db/pool.js';
import { getRedis } from '../redis/client.js';
import { withTransaction } from '../db/transaction.js';
import { sanitize } from '../errors/sanitize.js';
import { DEFAULT_MAX_ATTEMPTS } from './constants.js';
import { publicFailure } from './errors.js';
import { backoffSeconds } from './retry.js';
import { reserveSource } from './rate-limit.js';

const ACTIVE = ['pending', 'processing', 'failed'];

function idempotencyKey(sourceSlug, externalId, operation, discovery) {
  if (operation === 'discover') return `${sourceSlug}:discover:${discovery || 'catalog'}`;
  return `${sourceSlug}:${externalId}:upsert`;
}

async function notify(jobId) {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.lpush('beezmovies:jobs:metadata', jobId);
  } catch {
    // PostgreSQL is the durable queue. A missed wake-up is recovered by polling.
  }
}

export async function enqueueJob({
  source,
  externalId = null,
  operation,
  jobType,
  payload = {},
}) {
  const key = idempotencyKey(source.slug, externalId, operation, payload.discovery);

  const insert = async (client) => {
    const existing = await client.query(
      `SELECT *
       FROM ingestion_jobs
       WHERE idempotency_key = $1 AND status = ANY($2::text[])
       FOR UPDATE`,
      [key, ACTIVE],
    );
    if (existing.rowCount) return { job: existing.rows[0], created: false };

    const created = await client.query(
      `INSERT INTO ingestion_jobs (
         job_type, catalog_source_id, external_id, operation, idempotency_key,
         status, max_attempts, payload
       )
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7::jsonb)
       RETURNING *`,
      [jobType, source.id, externalId, operation, key, DEFAULT_MAX_ATTEMPTS, JSON.stringify(payload)],
    );
    return { job: created.rows[0], created: true };
  };

  try {
    const result = await withTransaction(insert);
    if (result.created) await notify(result.job.id);
    return result;
  } catch (error) {
    if (error.code !== '23505') throw error;
    const existing = await getPool().query(
      `SELECT * FROM ingestion_jobs
       WHERE idempotency_key = $1 AND status = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 1`,
      [key, ACTIVE],
    );
    return { job: existing.rows[0], created: false };
  }
}

async function claimLocked(client, job) {
  const gate = await reserveSource(client, { id: job.catalog_source_id });
  if (!gate.ok) {
    const seconds = Math.max(1, Math.ceil(gate.waitMs / 1000));
    await client.query(
      `UPDATE ingestion_jobs
       SET available_at = NOW() + make_interval(secs => $2)
       WHERE id = $1`,
      [job.id, seconds],
    );
    return { deferred: true };
  }

  const updated = await client.query(
    `UPDATE ingestion_jobs
     SET status = 'processing',
         attempt_count = attempt_count + 1,
         started_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [job.id],
  );
  return { deferred: false, job: updated.rows[0] };
}

export async function claimJobById(jobId) {
  return withTransaction(async (client) => {
    const selected = await client.query(
      `SELECT *
       FROM ingestion_jobs
       WHERE id = $1
         AND status IN ('pending', 'failed')
         AND attempt_count < max_attempts
       FOR UPDATE`,
      [jobId],
    );
    if (!selected.rowCount) return null;
    return claimLocked(client, selected.rows[0]);
  });
}

export async function claimNextJob() {
  return withTransaction(async (client) => {
    const selected = await client.query(
      `SELECT j.id
       FROM ingestion_jobs j
       JOIN catalog_sources s ON s.id = j.catalog_source_id
       JOIN catalog_source_runtime r ON r.catalog_source_id = s.id
       WHERE j.status IN ('pending', 'failed')
         AND j.available_at <= NOW()
         AND j.attempt_count < j.max_attempts
         AND s.status = 'active'
         AND s.archived_at IS NULL
         AND (
           r.health_status <> 'disabled'
           OR r.disabled_until IS NULL
           OR r.disabled_until <= NOW()
         )
       ORDER BY j.available_at, j.created_at
       FOR UPDATE OF j SKIP LOCKED
       LIMIT 1`,
    );
    if (!selected.rowCount) return null;

    const current = await client.query('SELECT * FROM ingestion_jobs WHERE id = $1', [selected.rows[0].id]);
    return claimLocked(client, current.rows[0]);
  });
}

export async function completeJob(job, { result, fingerprint }) {
  await getPool().query(
    `UPDATE ingestion_jobs
     SET status = 'completed',
         completed_at = NOW(),
         result = $2::jsonb,
         fingerprint = $3,
         last_error_code = NULL,
         last_error_message = NULL
     WHERE id = $1`,
    [job.id, JSON.stringify(result), fingerprint],
  );
}

export async function failJob(job, error) {
  const failure = publicFailure(error);
  const exhausted = job.attempt_count >= job.max_attempts || !failure.transient;
  const status = exhausted ? 'dead_letter' : 'failed';
  const seconds = failure.retryAfterMs
    ? Math.max(1, Math.ceil(failure.retryAfterMs / 1000))
    : backoffSeconds(job.attempt_count);
  const message = sanitize(failure.message).slice(0, 500);

  await getPool().query(
    `UPDATE ingestion_jobs
     SET status = $2,
         available_at = CASE
           WHEN $2 = 'failed' THEN NOW() + make_interval(secs => $3)
           ELSE available_at
         END,
         completed_at = CASE WHEN $2 = 'dead_letter' THEN NOW() ELSE completed_at END,
         last_error_code = $4,
         last_error_message = $5
     WHERE id = $1`,
    [job.id, status, seconds, failure.code, message],
  );

  return { status, code: failure.code };
}

export async function cancelJob(id) {
  const row = await getPool().query(
    `UPDATE ingestion_jobs
     SET status = 'cancelled', completed_at = NOW()
     WHERE id = $1 AND status IN ('pending', 'failed')
     RETURNING id, status`,
    [id],
  );
  return row.rows[0] || null;
}

export async function pruneIngestionHistory() {
  await getPool().query(
    `DELETE FROM ingestion_jobs
     WHERE status IN ('completed', 'cancelled')
       AND COALESCE(completed_at, updated_at) < NOW() - INTERVAL '30 days'`,
  );
  await getPool().query(
    `DELETE FROM ingestion_jobs
     WHERE status = 'dead_letter'
       AND COALESCE(completed_at, updated_at) < NOW() - INTERVAL '180 days'`,
  );
}

export function publicJobState(row) {
  if (row.status === 'pending' && row.attempt_count > 0) return 'RETRYING';
  if (row.status === 'pending' && row.available_at && new Date(row.available_at).getTime() > Date.now()) return 'RETRYING';
  if (row.status === 'pending') return 'QUEUED';
  if (row.status === 'processing') return 'RUNNING';
  if (row.status === 'completed') return 'COMPLETED';
  if (row.status === 'failed') return 'RETRYING';
  if (row.status === 'cancelled') return 'CANCELLED';
  if (row.status === 'dead_letter') return 'DEAD_LETTER';
  return 'FAILED';
}
