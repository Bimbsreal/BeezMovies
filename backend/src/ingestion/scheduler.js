import { getPool } from '../db/pool.js';
import { SCHEDULE_MIN_SECONDS } from './constants.js';
import { IngestionError } from './errors.js';
import { releaseDisabledSources } from './health.js';
import { enqueueJob } from './jobs.js';
import { loadSource } from './registry.js';
import { startSync } from './sync.js';

export function assertScheduleInterval(seconds) {
  if (!Number.isInteger(seconds) || seconds < SCHEDULE_MIN_SECONDS) {
    throw new IngestionError('MALFORMED_METADATA', 'Schedule interval is too frequent', {
      transient: false,
    });
  }
}

const DISCOVERY = {
  discovery: 'NEW_RELEASE_DISCOVERY',
  initial_import: 'POPULAR_DISCOVERY',
  periodic_update: 'REVALIDATION',
  stale_refresh: 'METADATA_REFRESH',
};

async function enqueueTargeted(source, discovery, rows) {
  let created = 0;
  for (const row of rows) {
    const queued = await enqueueJob({
      source,
      externalId: row.external_id,
      operation: 'refresh',
      jobType: 'metadata:upsert',
      payload: { origin: 'maintenance', discovery },
    });
    if (queued.created) created += 1;
  }
  return created;
}

async function enqueueStale(source) {
  const stale = await getPool().query(
    `SELECT external_id
     FROM external_identifiers
     WHERE catalog_source_id = $1
       AND (
         last_synchronized_at IS NULL
         OR last_synchronized_at < NOW() - INTERVAL '7 days'
       )
     ORDER BY last_synchronized_at NULLS FIRST
     LIMIT 20`,
    [source.id],
  );
  for (const row of stale.rows) {
    await enqueueJob({
      source,
      externalId: row.external_id,
      operation: 'refresh',
      jobType: 'metadata:upsert',
      payload: { origin: 'stale-refresh', discovery: 'METADATA_REFRESH' },
    });
  }
  return stale.rowCount;
}

export async function enqueueDueSchedules(now = new Date()) {
  await releaseDisabledSources();
  const due = await getPool().query(
    `SELECT id, name, catalog_source_id, schedule_type, interval_seconds
     FROM ingestion_schedules
     WHERE enabled = TRUE
       AND (next_run_at IS NULL OR next_run_at <= $1)
     ORDER BY next_run_at NULLS FIRST
     LIMIT 10`,
    [now],
  );

  for (const schedule of due.rows) {
    assertScheduleInterval(schedule.interval_seconds);
    if (
      schedule.catalog_source_id
      && ['discovery', 'initial_import', 'periodic_update'].includes(schedule.schedule_type)
    ) {
      const slug = await getPool().query(
        'SELECT slug, status FROM catalog_sources WHERE id = $1',
        [schedule.catalog_source_id],
      );
      if (slug.rowCount && slug.rows[0].status === 'active') {
        const source = await loadSource(slug.rows[0].slug);
        await enqueueJob({
          source,
          operation: 'discover',
          jobType: 'metadata:discover',
          payload: {
            schedule: schedule.name,
            discovery: DISCOVERY[schedule.schedule_type] || 'NEW_RELEASE_DISCOVERY',
          },
        });
      }
    }
    if (
      schedule.catalog_source_id
      && ['incremental_sync', 'episode_sync'].includes(schedule.schedule_type)
    ) {
      const slug = await getPool().query(
        'SELECT slug, status FROM catalog_sources WHERE id = $1',
        [schedule.catalog_source_id],
      );
      if (slug.rowCount && slug.rows[0].status === 'active') {
        await startSync(null, {
          sourceSlug: slug.rows[0].slug,
          mode: 'scheduled',
          layer: schedule.schedule_type === 'episode_sync' ? 'episode' : 'catalog',
        });
      }
    }
    if (schedule.schedule_type === 'stale_refresh' && schedule.catalog_source_id) {
      const slug = await getPool().query(
        'SELECT slug, status FROM catalog_sources WHERE id = $1',
        [schedule.catalog_source_id],
      );
      if (slug.rowCount && slug.rows[0].status === 'active') {
        const source = await loadSource(slug.rows[0].slug);
        await enqueueStale(source);
        const missingMeta = await getPool().query(
          `SELECT ei.external_id
           FROM external_identifiers ei
           JOIN movies m ON m.id = ei.movie_id
           WHERE ei.catalog_source_id = $1 AND m.deleted_at IS NULL AND m.synopsis IS NULL
           LIMIT 10`,
          [source.id],
        );
        const missingArt = await getPool().query(
          `SELECT ei.external_id
           FROM external_identifiers ei
           JOIN movies m ON m.id = ei.movie_id
           WHERE ei.catalog_source_id = $1 AND m.deleted_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM movie_images i
               WHERE i.movie_id = m.id AND i.image_type = 'poster'
             )
           LIMIT 10`,
          [source.id],
        );
        await enqueueTargeted(source, 'MISSING_METADATA', missingMeta.rows);
        await enqueueTargeted(source, 'MISSING_ARTWORK', missingArt.rows);
      }
    }
    await getPool().query(
      `UPDATE ingestion_schedules
       SET last_run_at = $2,
           next_run_at = $2::timestamptz + make_interval(secs => interval_seconds)
       WHERE id = $1`,
      [schedule.id, now],
    );
  }

  return due.rowCount;
}

export async function readSchedules() {
  const rows = await getPool().query(
    `SELECT name, schedule_type, interval_seconds, enabled, next_run_at, last_run_at
     FROM ingestion_schedules
     ORDER BY name`,
  );
  return rows.rows;
}
