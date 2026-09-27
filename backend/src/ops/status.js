import { existsSync } from 'node:fs';
import path from 'node:path';
import { getPool } from '../db/pool.js';
import { getRedisStatus } from '../redis/client.js';
import { backupState } from './flags.js';
import { sanitize } from '../errors/sanitize.js';
import { logger } from '../logger/index.js';

const PWA_ASSETS = [
  ['Manifest', 'frontend/public/manifest.webmanifest'],
  ['Service worker', 'frontend/public/sw.js'],
  ['Icons', 'frontend/public/branding/icon-192.png'],
  ['Startup logo', 'frontend/public/branding/beezmovies-logo.jpg'],
  ['Bee artwork', 'frontend/public/branding/beezmovies-bee.png'],
];

export function pwaAssetReport() {
  return PWA_ASSETS.map(([name, relativePath]) => ({
    name,
    present: existsSync(path.resolve(process.cwd(), relativePath))
      || existsSync(path.resolve(process.cwd(), '..', relativePath)),
  }));
}

const WORKER_STALE_MS = 60_000;

export function level(status) {
  if (status === 'HEALTHY' || status === 'DEGRADED' || status === 'DOWN' || status === 'NOT CONFIGURED') {
    return status;
  }
  return 'NOT CONFIGURED';
}

export function databaseLevel(status) {
  if (status === 'ok') return 'HEALTHY';
  if (status === 'not_configured' || status === 'migrations_pending') return 'NOT CONFIGURED';
  return 'DOWN';
}

export function cacheLevel(status) {
  if (status === 'ready' || status === 'ok') return 'HEALTHY';
  if (status === 'disabled' || status === 'not_configured') return 'NOT CONFIGURED';
  return 'DEGRADED';
}

export function workerLevel(seenAt, now = Date.now()) {
  if (!seenAt) return 'NOT CONFIGURED';
  const age = now - new Date(seenAt).getTime();
  if (Number.isNaN(age)) return 'NOT CONFIGURED';
  return age <= WORKER_STALE_MS ? 'HEALTHY' : 'DOWN';
}

export function backupLevel(backup, now = Date.now()) {
  if (backup?.lastRestoreFailureAt) return 'DOWN';
  if (!backup?.lastSuccessAt && !backup?.lastFailureAt) return 'NOT CONFIGURED';
  if (backup.lastFailureAt && (!backup.lastSuccessAt || new Date(backup.lastFailureAt) > new Date(backup.lastSuccessAt))) {
    return 'DOWN';
  }
  if (backup.sizeBytes === 0) return 'DOWN';
  if (backup.previousSizeBytes > 0 && backup.sizeBytes > 0) {
    const ratio = backup.sizeBytes / backup.previousSizeBytes;
    if (ratio < 0.2 || ratio > 5) return 'DEGRADED';
  }
  const ageHours = (now - new Date(backup.lastSuccessAt).getTime()) / 36e5;
  if (Number.isNaN(ageHours)) return 'NOT CONFIGURED';
  return ageHours > Number(backup.maxAgeHours || 26) ? 'DOWN' : 'HEALTHY';
}

export function providerLevel(status) {
  if (status === 'available') return 'HEALTHY';
  if (status === 'degraded') return 'DEGRADED';
  if (status === 'unavailable') return 'DOWN';
  return 'NOT CONFIGURED';
}

function check(group, name, status, detail) {
  return { group, name, status: level(status), detail: detail || '' };
}

function alertsFor(checks) {
  const alerts = [];
  const find = (name) => checks.find((item) => item.name === name);
  const database = find('Database');
  const backups = find('Backups');
  const worker = find('Worker');
  const search = find('Search');
  const downloads = find('Downloads');
  if (database?.status === 'DOWN') {
    alerts.push({ severity: 'CRITICAL', code: 'DATABASE_UNAVAILABLE', message: 'Database is unavailable' });
  }
  if (backups?.status === 'DOWN') {
    alerts.push({ severity: 'CRITICAL', code: 'BACKUP_FAILED', message: 'Backup is missing or older than the allowed age' });
  }
  if (downloads?.status === 'DOWN') {
    alerts.push({ severity: 'CRITICAL', code: 'DOWNLOADS_FAILING', message: 'Recent download resolutions are failing' });
  }
  if (worker?.status === 'DOWN') {
    alerts.push({ severity: 'HIGH', code: 'WORKER_DOWN', message: 'Worker heartbeat is stale' });
  }
  if (search?.status === 'DOWN') {
    alerts.push({ severity: 'HIGH', code: 'SEARCH_UNAVAILABLE', message: 'Search index is unavailable' });
  }
  const providerDown = checks.filter((item) => item.group === 'Media' && item.status === 'DOWN');
  if (providerDown.length > 0) {
    alerts.push({ severity: 'HIGH', code: 'PROVIDER_OUTAGE', message: 'A media provider health record is unavailable' });
  }
  if (find('Ingestion')?.status === 'DEGRADED') {
    alerts.push({ severity: 'MEDIUM', code: 'INGESTION_FAILURES', message: 'Ingestion has dead-letter jobs' });
  }
  if (find('Queue')?.status === 'DOWN') {
    alerts.push({ severity: 'HIGH', code: 'QUEUE_BACKLOG', message: 'The job queue backlog is above the threshold' });
  }
  if (find('Cache')?.status === 'DEGRADED') {
    alerts.push({ severity: 'MEDIUM', code: 'CACHE_UNAVAILABLE', message: 'Cache is unavailable and the catalog is serving from PostgreSQL' });
  }
  if (find('Pool')?.status === 'DEGRADED') {
    alerts.push({ severity: 'MEDIUM', code: 'POOL_WAITING', message: 'Database pool has requests waiting for a connection' });
  }
  return alerts;
}

export async function operationalSnapshot(databaseStatus) {
  const backup = await backupState();
  let counts = {};
  let providers = [];
  let lockCount = 0;
  let connectionCount = null;
  let databaseBytes = null;
  try {
    const result = await getPool().query(`
      SELECT
        (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'dead_letter') AS dead_letter,
        (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status IN ('pending', 'failed')) AS ingestion_backlog,
        (SELECT COUNT(*)::int FROM search_index_events WHERE consumed_at IS NULL) AS index_backlog,
        (SELECT COUNT(*)::int FROM search_index_versions WHERE status = 'active') AS active_indexes,
        (SELECT seen_at FROM ops_heartbeats WHERE service = 'worker') AS worker_seen,
        (SELECT COUNT(*)::int FROM download_events WHERE result = 'failed' AND created_at > NOW() - INTERVAL '1 hour') AS download_failures,
        (SELECT COUNT(*)::int FROM download_events WHERE result = 'success' AND created_at > NOW() - INTERVAL '1 hour') AS download_success,
        (SELECT COUNT(*)::int FROM pg_stat_activity WHERE datname = current_database()) AS connections,
        pg_database_size(current_database())::bigint AS database_bytes,
        (SELECT COUNT(*)::int FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND datname = current_database()) AS locks
    `);
    counts = result.rows[0] || {};
    connectionCount = counts.connections;
    databaseBytes = Number(counts.database_bytes);
    lockCount = counts.locks || 0;
    const providerRows = await getPool().query(`
      SELECT slug, COALESCE(provider_health.status, 'unknown') AS status
      FROM providers
      LEFT JOIN provider_health ON provider_health.provider_id = providers.id
      WHERE providers.status = 'active'
      ORDER BY slug
    `);
    providers = providerRows.rows;
  } catch (error) {
    logger.warn({ err: sanitize(error.message), code: error.code }, 'Operational snapshot incomplete');
  }

  const deadLetter = counts.dead_letter || 0;
  const downloadFailures = counts.download_failures || 0;
  const downloadSuccess = counts.download_success || 0;
  const searchStatus = (counts.active_indexes || 0) > 0 && (counts.index_backlog || 0) < 100
    ? 'HEALTHY'
    : 'DEGRADED';
  const downloadStatus = downloadFailures >= 5 && downloadFailures > downloadSuccess ? 'DOWN' : 'HEALTHY';

  const memoryMb = Math.round(process.memoryUsage().rss / 1e6);
  const waiting = getPool().waitingCount || 0;
  const assets = pwaAssetReport();
  const missingAssets = assets.filter((item) => !item.present).map((item) => item.name);
  const checks = [
    check('System', 'API', 'HEALTHY', `${memoryMb} MB`),
    check('System', 'Pool', waiting > 2 ? 'DEGRADED' : 'HEALTHY', `${waiting} waiting`),
    check('System', 'Database', databaseLevel(databaseStatus), connectionCount == null ? '' : `${connectionCount} connections`),
    check('System', 'Cache', cacheLevel(getRedisStatus())),
    check('System', 'Locks', lockCount > 0 ? 'DEGRADED' : 'HEALTHY', lockCount > 0 ? `${lockCount} waiting` : ''),
    check('Workers', 'Worker', workerLevel(counts.worker_seen)),
    check('Workers', 'Ingestion', deadLetter > 0 ? 'DEGRADED' : 'HEALTHY', deadLetter > 0 ? `${deadLetter} dead-letter` : ''),
    check(
      'Workers',
      'Queue',
      (counts.ingestion_backlog || 0) >= 100 ? 'DOWN' : (counts.ingestion_backlog || 0) > 25 ? 'DEGRADED' : 'HEALTHY',
      `${counts.ingestion_backlog || 0} pending`,
    ),
    check('Search', 'Search', searchStatus, `${counts.index_backlog || 0} waiting`),
    check('Media', 'Downloads', downloadStatus),
    check('Backups', 'Backups', backupLevel(backup)),
    check(
      'PWA',
      'PWA shell',
      missingAssets.length ? 'DEGRADED' : 'HEALTHY',
      missingAssets.length ? `Missing ${missingAssets.join(', ')}` : 'Required assets present',
    ),
  ];

  if (providers.length === 0) {
    checks.push(check('Media', 'Providers', 'NOT CONFIGURED'));
  } else {
    for (const provider of providers) {
      checks.push(check('Media', provider.slug, providerLevel(provider.status)));
    }
  }

  return {
    checks,
    alerts: alertsFor(checks),
    databaseBytes,
  };
}

export async function recordWorkerHeartbeat() {
  await getPool().query(
    `INSERT INTO ops_heartbeats (service, seen_at)
     VALUES ('worker', NOW())
     ON CONFLICT (service) DO UPDATE SET seen_at = NOW()`,
  );
}
