import { getPool } from '../db/pool.js';
import { assertAdapter } from './adapter.js';
import { developmentMetadataAdapter } from './sources/development.js';
import { IngestionError } from './errors.js';

const adapters = new Map();

export function registerAdapter(slug, adapter) {
  assertAdapter(adapter);
  adapters.set(slug, adapter);
}

export function getAdapter(slug) {
  return adapters.get(slug) ?? null;
}

registerAdapter('development-metadata', developmentMetadataAdapter);

const DEV_SOURCE_ID = '77777777-7777-4777-8777-777777777703';

export async function loadSource(slug) {
  if (slug === 'development-metadata') {
    await getPool().query(
      `INSERT INTO catalog_sources (id, name, slug, source_type, status, external_reference)
       VALUES ($1, 'Development metadata', 'development-metadata', 'metadata', 'active', 'development-metadata')
       ON CONFLICT (slug) DO NOTHING`,
      [DEV_SOURCE_ID],
    );
    await getPool().query(
      `INSERT INTO catalog_source_runtime (
         catalog_source_id, health_status, requests_per_minute, min_interval_ms,
         concurrency_limit, priority, allowed_hosts
       )
       SELECT id, 'healthy', 30, 0, 2, 40, ARRAY['images.example.com', 'videos.example.com']::text[]
       FROM catalog_sources
       WHERE slug = 'development-metadata'
       ON CONFLICT (catalog_source_id) DO NOTHING`,
    );
  }

  const result = await getPool().query(
    `SELECT s.id, s.slug, s.name, s.source_type, s.status, s.last_synchronized_at,
            r.health_status, r.requests_per_minute, r.min_interval_ms, r.concurrency_limit,
            r.priority, r.field_priority, r.allowed_hosts, r.success_count, r.error_count,
            r.consecutive_failures, r.last_success_at, r.last_failure_at, r.disabled_until
     FROM catalog_sources s
     JOIN catalog_source_runtime r ON r.catalog_source_id = s.id
     WHERE s.slug = $1 AND s.archived_at IS NULL`,
    [slug],
  );

  if (!result.rowCount) {
    throw new IngestionError('INVALID_SOURCE_ID', 'Metadata source is not registered', { transient: false });
  }

  const row = result.rows[0];
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    sourceType: row.source_type,
    status: row.status,
    lastSynchronizedAt: row.last_synchronized_at,
    healthStatus: row.health_status,
    requestsPerMinute: row.requests_per_minute,
    minIntervalMs: row.min_interval_ms,
    concurrencyLimit: row.concurrency_limit,
    priority: row.priority,
    fieldPriority: row.field_priority ?? {},
    allowedHosts: row.allowed_hosts ?? [],
    successCount: Number(row.success_count),
    errorCount: Number(row.error_count),
    consecutiveFailures: row.consecutive_failures,
    lastSuccessAt: row.last_success_at,
    lastFailureAt: row.last_failure_at,
    disabledUntil: row.disabled_until,
  };
}
