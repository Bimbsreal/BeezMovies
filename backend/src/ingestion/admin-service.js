import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import { getPool } from '../db/pool.js';
import { recordAudit } from '../admin/audit.js';
import { clearOperationsCache } from '../ops/flags.js';
import { enqueueJob, cancelJob, publicJobState } from './jobs.js';
import { getAdapter, loadSource } from './registry.js';
import { readSchedules } from './scheduler.js';
import { DISCOVER_BATCH_LIMIT } from './constants.js';
import { validateMovie } from '../catalog/quality.js';
import { reindexMovie } from '../admin/control.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const externalId = z.string().regex(/^[A-Za-z0-9:._-]{1,200}$/);

const discoveryKind = z.enum([
  'NEW_RELEASE_DISCOVERY',
  'POPULAR_DISCOVERY',
  'METADATA_REFRESH',
  'MISSING_METADATA',
  'MISSING_ARTWORK',
  'REVALIDATION',
]);

export const createIngestionJobSchema = z.object({
  body: z.object({
    source: slug,
    externalId: externalId.optional(),
    operation: z.enum(['discover', 'upsert', 'refresh']).optional(),
    discovery: discoveryKind.optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const listIngestionJobsSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'dead_letter', 'cancelled']).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).strict(),
  params: z.object({}).strict(),
});

export const ingestionBatchSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    source: slug,
    externalIds: z.array(externalId).min(1).max(25),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const ingestionQueueSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    enabled: z.boolean(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const ingestionActionSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    movieId: z.string().uuid().optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const cancelIngestionSchema = z.object({
  body: z.object({ confirm: z.literal(true) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

export const ingestionJobSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({
    id: z.string().uuid(),
  }).strict(),
});

function presentJob(row) {
  return {
    id: row.id,
    jobType: row.job_type,
    externalId: row.external_id,
    operation: row.operation,
    status: row.status,
    state: publicJobState(row),
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts,
    availableAt: row.available_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    errorCode: row.last_error_code,
    errorMessage: row.last_error_message,
    result: row.result,
    movieId: row.result?.movieId || null,
    movieSlug: row.result?.slug || null,
    createdAt: row.created_at,
  };
}

export async function requestIngestion({ source: sourceSlug, externalId, operation, discovery }) {
  if (!getAdapter(sourceSlug)) {
    throw new AppError('Unknown metadata source', { status: 400, code: 'VALIDATION_ERROR' });
  }

  let source;
  try {
    source = await loadSource(sourceSlug);
  } catch {
    throw new AppError('Unknown metadata source', { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (source.status !== 'active') {
    throw new AppError('Metadata source is not active', { status: 400, code: 'VALIDATION_ERROR' });
  }

  const selected = operation ?? (externalId ? 'upsert' : 'discover');
  if (selected === 'discover' && externalId) {
    throw new AppError('Discovery does not accept an external id', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  if (selected !== 'discover' && !externalId) {
    throw new AppError('An external id is required', { status: 400, code: 'VALIDATION_ERROR' });
  }

  const queued = await enqueueJob({
    source,
    externalId: externalId ?? null,
    operation: selected,
    jobType: selected === 'discover' ? 'metadata:discover' : 'metadata:upsert',
    payload: { origin: 'admin', discovery: discovery || (selected === 'discover' ? 'NEW_RELEASE_DISCOVERY' : undefined) },
  });

  return { ...presentJob(queued.job), created: queued.created };
}

export async function listIngestionJobs({ status, limit = 20 }) {
  const rows = await getPool().query(
    `SELECT j.*, s.slug AS source_slug
     FROM ingestion_jobs j
     JOIN catalog_sources s ON s.id = j.catalog_source_id
     WHERE ($1::text IS NULL OR j.status = $1)
     ORDER BY j.created_at DESC
     LIMIT $2`,
    [status ?? null, limit],
  );
  return rows.rows.map((row) => ({ ...presentJob(row), source: row.source_slug }));
}

export async function getIngestionJob(id) {
  const rows = await getPool().query(
    `SELECT j.*, s.slug AS source_slug
     FROM ingestion_jobs j
     JOIN catalog_sources s ON s.id = j.catalog_source_id
     WHERE j.id = $1`,
    [id],
  );
  if (!rows.rowCount) {
    throw new AppError('Ingestion job not found', { status: 404, code: 'NOT_FOUND' });
  }
  return { ...presentJob(rows.rows[0]), source: rows.rows[0].source_slug };
}

export async function cancelIngestionJob(actorId, id) {
  const cancelled = await cancelJob(id);
  if (!cancelled) {
    throw new AppError('Only a queued job can be cancelled', { status: 409, code: 'CONFLICT' });
  }
  await recordAudit(null, {
    actorId,
    action: 'INGESTION_CANCELLED',
    targetType: 'ingestion_job',
    targetId: id,
  });
  return { id, status: 'cancelled', state: 'CANCELLED' };
}

export async function requestIngestionBatch(actorId, sourceSlug, externalIds) {
  if (!Array.isArray(externalIds) || externalIds.length === 0 || externalIds.length > DISCOVER_BATCH_LIMIT) {
    throw new AppError('A batch must contain between 1 and 25 external ids', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  const source = await loadSource(sourceSlug);
  const summary = { total: externalIds.length, processed: 0, successful: 0, skipped: 0, failed: 0, pendingReview: 0 };
  for (const externalId of externalIds) {
    summary.processed += 1;
    try {
      const queued = await enqueueJob({
        source,
        externalId,
        operation: 'upsert',
        jobType: 'metadata:upsert',
        payload: { origin: 'batch' },
      });
      if (queued.created) summary.successful += 1;
      else summary.skipped += 1;
    } catch {
      summary.failed += 1;
    }
  }
  await recordAudit(null, {
    actorId,
    action: 'INGESTION_BATCH_QUEUED',
    targetType: 'catalog_source',
    targetId: source.id,
    metadata: { total: String(summary.total), queued: String(summary.successful) },
  });
  return summary;
}

export async function ingestionMetrics() {
  const counts = await getPool().query(
    `SELECT status, COUNT(*)::int AS count,
            COUNT(*) FILTER (WHERE status = 'failed' OR (status = 'pending' AND attempt_count > 0))::int AS retrying
     FROM ingestion_jobs
     GROUP BY status`,
  );
  const timing = await getPool().query(
    `SELECT COUNT(*) FILTER (WHERE status = 'completed' AND completed_at > NOW() - INTERVAL '1 day')::int AS completed_day,
            COUNT(*) FILTER (WHERE status = 'dead_letter' AND completed_at > NOW() - INTERVAL '1 day')::int AS failed_day,
            COALESCE(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)
              FILTER (WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at > NOW() - INTERVAL '1 day'), 0)::int AS average_ms,
            COALESCE(SUM(attempt_count), 0)::int AS attempts
     FROM ingestion_jobs`,
  );
  const byStatus = Object.fromEntries(counts.rows.map((row) => [row.status, row.count]));
  const finished = (timing.rows[0].completed_day || 0) + (timing.rows[0].failed_day || 0);
  return {
    queued: byStatus.pending || 0,
    running: byStatus.processing || 0,
    completed: byStatus.completed || 0,
    failed: byStatus.failed || 0,
    retrying: counts.rows.reduce((sum, row) => sum + (row.retrying || 0), 0),
    deadLetter: byStatus.dead_letter || 0,
    cancelled: byStatus.cancelled || 0,
    throughput: timing.rows[0].completed_day || 0,
    successRate: finished ? Math.round((timing.rows[0].completed_day / finished) * 100) : null,
    failureRate: finished ? Math.round((timing.rows[0].failed_day / finished) * 100) : null,
    averageProcessingMs: timing.rows[0].average_ms || 0,
    attempts: timing.rows[0].attempts || 0,
  };
}

export async function retryFailedIngestion(actorId) {
  const rows = await getPool().query(
    `UPDATE ingestion_jobs
     SET status = 'pending',
         available_at = NOW(),
         completed_at = NULL,
         max_attempts = LEAST(10, GREATEST(max_attempts, attempt_count + 1))
     WHERE id IN (
       SELECT id FROM ingestion_jobs
       WHERE status IN ('failed', 'dead_letter')
       ORDER BY updated_at
       LIMIT 25
     )
     RETURNING id`,
  );
  await recordAudit(null, {
    actorId,
    action: 'INGESTION_FAILED_RETRIED',
    targetType: 'ingestion_job',
    targetId: 'failed',
    metadata: { retried: String(rows.rowCount) },
  });
  return { retried: rows.rowCount, limit: 25 };
}

export async function validateIngestionMovie(movieId) {
  return validateMovie(movieId);
}

export async function reindexIngestionMovie(actorId, movieId) {
  return reindexMovie(actorId, movieId);
}

export async function setIngestionQueue(actorId, enabled) {
  const current = await getPool().query(
    `SELECT value FROM platform_settings WHERE key = 'feature_flags'`,
  );
  const stored = current.rows[0]?.value || {};
  const flags = {
    ingestion: enabled,
    searchIndexing: stored.searchIndexing !== false,
    advertising: stored.advertising !== false,
  };
  await getPool().query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ('feature_flags', $1::jsonb, NOW(), $2)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [JSON.stringify(flags), actorId],
  );
  clearOperationsCache();
  await recordAudit(null, {
    actorId,
    action: 'INGESTION_QUEUE_CHANGED',
    targetType: 'setting',
    targetId: 'feature_flags',
    metadata: { ingestion: enabled ? 'on' : 'off' },
  });
  return { ingestion: enabled };
}

export async function listIngestionSources() {
  const rows = await getPool().query(
    `SELECT s.slug, s.name, s.source_type, s.status, s.last_synchronized_at,
            r.health_status, r.priority, r.requests_per_minute, r.concurrency_limit,
            r.success_count, r.error_count, r.consecutive_failures,
            r.last_success_at, r.last_failure_at, r.disabled_until
     FROM catalog_sources s
     LEFT JOIN catalog_source_runtime r ON r.catalog_source_id = s.id
     WHERE s.archived_at IS NULL
     ORDER BY s.slug`,
  );
  const schedules = await readSchedules();
  return {
    sources: rows.rows.map((row) => ({
      slug: row.slug,
      name: row.name,
      type: row.source_type,
      status: row.status,
      health: row.health_status,
      adapter: getAdapter(row.slug)?.descriptor || null,
      priority: row.priority,
      requestsPerMinute: row.requests_per_minute,
      concurrencyLimit: row.concurrency_limit,
      successCount: row.success_count === null ? null : Number(row.success_count),
      errorCount: row.error_count === null ? null : Number(row.error_count),
      consecutiveFailures: row.consecutive_failures,
      lastSynchronizedAt: row.last_synchronized_at,
      lastSuccessAt: row.last_success_at,
      lastFailureAt: row.last_failure_at,
      disabledUntil: row.disabled_until,
    })),
    schedules: schedules.map((row) => ({
      name: row.name,
      type: row.schedule_type,
      intervalSeconds: row.interval_seconds,
      enabled: row.enabled,
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
    })),
  };
}
