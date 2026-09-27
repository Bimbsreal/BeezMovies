import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, poolStats } from '../db/pool.js';
import { discoveryCacheStats } from '../discovery/cache.js';
import { searchCacheStats } from '../search/cache.js';
import { PERFORMANCE_BUDGETS } from './budgets.js';
import { sanitize } from '../errors/sanitize.js';
import { logger } from '../logger/index.js';
import { release } from '../release.js';
import { catalogHealth } from '../catalog/quality.js';
import { operationalSnapshot } from './status.js';
import { backupState } from './flags.js';
import { listNotifications } from './incidents.js';

const version = JSON.parse(readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../package.json'),
  'utf8',
)).version;

function serviceStatus(checks, names, fallback = 'NOT CONFIGURED') {
  const matched = checks.filter((item) => names.includes(item.name));
  if (matched.length === 0) return fallback;
  if (matched.some((item) => item.status === 'DOWN')) return 'DOWN';
  if (matched.some((item) => item.status === 'DEGRADED')) return 'DEGRADED';
  if (matched.every((item) => item.status === 'NOT CONFIGURED')) return 'NOT CONFIGURED';
  if (matched.some((item) => item.status === 'HEALTHY')) return 'HEALTHY';
  return fallback;
}

async function optionalQuery(sql, params = []) {
  try {
    const result = await getPool().query(sql, params);
    return result.rows;
  } catch (error) {
    logger.warn({ err: sanitize(error.message), code: error.code }, 'Operations detail unavailable');
    return [];
  }
}

export async function operationsBoard(databaseStatus) {
  const snapshot = await operationalSnapshot(databaseStatus);
  const checks = snapshot.checks;
  const providers = checks.filter((item) => item.group === 'Media' && item.name !== 'Downloads' && item.name !== 'Providers');
  const providerLevel = providers.length === 0
    ? serviceStatus(checks, ['Providers'])
    : (providers.some((item) => item.status === 'DOWN') && providers.every((item) => item.status === 'DOWN')
      ? 'DOWN'
      : providers.some((item) => item.status === 'DOWN' || item.status === 'DEGRADED')
        ? 'DEGRADED'
        : providers.every((item) => item.status === 'NOT CONFIGURED')
          ? 'NOT CONFIGURED'
          : 'HEALTHY');

  const [catalog, backup, notifications, downloads, providerHealth, recentFailures, searchLatency, zeroResults, security, migration, oldestJob] = await Promise.all([
    catalogHealth().catch(() => null),
    backupState(),
    listNotifications(),
    optionalQuery(
      `SELECT COALESCE(p.slug, 'unknown') AS provider,
              COUNT(*) FILTER (WHERE d.result = 'success')::int AS success,
              COUNT(*) FILTER (WHERE d.result = 'failed')::int AS failed
       FROM download_events d
       LEFT JOIN providers p ON p.id = d.provider_id
       WHERE d.created_at > NOW() - INTERVAL '24 hours'
       GROUP BY p.slug
       ORDER BY p.slug
       LIMIT 20`,
    ),
    optionalQuery(
      `SELECT p.slug,
              p.status AS provider_status,
              COALESCE(h.status, 'unknown') AS health,
              h.last_success_at,
              h.last_error_code,
              ROUND(AVG(d.duration_ms) FILTER (WHERE d.created_at > NOW() - INTERVAL '24 hours'))::int AS latency_ms,
              COUNT(d.id) FILTER (WHERE d.created_at > NOW() - INTERVAL '24 hours')::int AS attempts,
              COUNT(d.id) FILTER (WHERE d.result = 'failed' AND d.created_at > NOW() - INTERVAL '24 hours')::int AS failed
       FROM providers p
       LEFT JOIN provider_health h ON h.provider_id = p.id
       LEFT JOIN download_events d ON d.provider_id = p.id
       WHERE p.provider_type = 'media' AND p.archived_at IS NULL
       GROUP BY p.id, p.slug, p.status, h.status, h.last_success_at, h.last_error_code
       ORDER BY p.slug
       LIMIT 20`,
    ),
    optionalQuery(
      `SELECT p.slug AS provider, d.failure_category, d.created_at, m.slug AS movie
       FROM download_events d
       JOIN movies m ON m.id = d.movie_id
       LEFT JOIN providers p ON p.id = d.provider_id
       WHERE d.result = 'failed' AND d.created_at > NOW() - INTERVAL '24 hours'
       ORDER BY d.created_at DESC
       LIMIT 10`,
    ),
    optionalQuery(
      `SELECT COUNT(*)::int AS samples,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
              percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99
       FROM analytics_latency_samples
       WHERE recorded_at > NOW() - INTERVAL '1 hour'`,
    ),
    optionalQuery(
      `SELECT COALESCE(SUM(zero_count), 0)::int AS zero_results,
              COALESCE(SUM(search_count), 0)::int AS searches
       FROM analytics_search_terms
       WHERE day >= CURRENT_DATE - 7`,
    ),
    optionalQuery(
      `SELECT
         COUNT(*) FILTER (WHERE event_type = 'login_failure' AND created_at > NOW() - INTERVAL '1 hour')::int AS login_failures,
         COUNT(*) FILTER (WHERE event_type = 'password_reset_requested' AND created_at > NOW() - INTERVAL '1 hour')::int AS reset_requests,
         COUNT(*) FILTER (WHERE event_type = 'admin_authenticated' AND created_at > NOW() - INTERVAL '1 hour')::int AS admin_signins
       FROM auth_events`,
    ),
    optionalQuery(`SELECT name FROM schema_migrations ORDER BY name DESC LIMIT 1`),
    optionalQuery(
      `SELECT MIN(created_at) AS oldest
       FROM ingestion_jobs
       WHERE status IN ('pending', 'failed')`,
    ),
  ]);

  const latency = searchLatency[0] || {};
  const searchTerms = zeroResults[0] || { zero_results: 0, searches: 0 };
  const securityRow = security[0] || { login_failures: 0, reset_requests: 0, admin_signins: 0 };
  const downloadSuccess = downloads.reduce((sum, row) => sum + row.success, 0);
  const downloadFailed = downloads.reduce((sum, row) => sum + row.failed, 0);

  return {
    release: {
      version,
      label: release.label,
      deployedAt: null,
      migration: migration[0]?.name || null,
    },
    services: [
      { name: 'APPLICATION', status: serviceStatus(checks, ['API']) },
      { name: 'DATABASE', status: serviceStatus(checks, ['Database', 'Pool', 'Locks']) },
      { name: 'CACHE', status: serviceStatus(checks, ['Cache']) },
      { name: 'QUEUE', status: serviceStatus(checks, ['Queue', 'Ingestion']) },
      { name: 'WORKERS', status: serviceStatus(checks, ['Worker']) },
      { name: 'SEARCH', status: serviceStatus(checks, ['Search']) },
      { name: 'MEDIA PROVIDERS', status: providerLevel },
      { name: 'CDN', status: 'NOT CONFIGURED' },
      { name: 'PWA', status: serviceStatus(checks, ['PWA shell']) },
    ],
    notifications,
    alerts: snapshot.alerts.filter((alert) => alert.severity === 'CRITICAL' || alert.severity === 'HIGH'),
    catalog,
    search: {
      status: serviceStatus(checks, ['Search']),
      indexed: catalog?.search?.indexed ?? null,
      pending: catalog?.search?.pending ?? null,
      failed: catalog?.search?.failed ?? null,
      zeroResults: searchTerms.zero_results,
      searches: searchTerms.searches,
      latencyMs: {
        samples: latency.samples || 0,
        p50: latency.p50 == null ? null : Math.round(Number(latency.p50)),
        p95: latency.p95 == null ? null : Math.round(Number(latency.p95)),
        p99: latency.p99 == null ? null : Math.round(Number(latency.p99)),
      },
      regression: null,
    },
    downloads: {
      requests: downloadSuccess + downloadFailed,
      successful: downloadSuccess,
      failed: downloadFailed,
      providers: downloads,
      country: null,
    },
    providerHealth: providerHealth.map((row) => ({
      provider: row.slug,
      status: row.health,
      providerStatus: row.provider_status,
      latencyMs: row.latency_ms,
      errorRate: row.attempts > 0 ? Math.round((row.failed / row.attempts) * 100) : null,
      lastSuccessAt: row.last_success_at,
      attempts: row.attempts,
      failed: row.failed,
    })),
    recentFailures: recentFailures.map((row) => ({
      provider: row.provider,
      movie: row.movie,
      failure: row.failure_category,
      at: row.created_at,
    })),
    queue: {
      status: serviceStatus(checks, ['Queue', 'Ingestion']),
      oldestPendingAt: oldestJob[0]?.oldest || null,
    },
    database: {
      status: serviceStatus(checks, ['Database']),
      bytes: snapshot.databaseBytes,
      slowQueries: null,
      pool: poolStats(),
    },
    cache: {
      discovery: discoveryCacheStats(),
      search: searchCacheStats(),
    },
    budgets: PERFORMANCE_BUDGETS,
    backups: {
      status: serviceStatus(checks, ['Backups']),
      lastSuccessAt: backup.lastSuccessAt,
      lastFailureAt: backup.lastFailureAt,
      lastRestoreFailureAt: backup.lastRestoreFailureAt || null,
      sizeBytes: backup.sizeBytes,
    },
    security: {
      loginFailures: securityRow.login_failures,
      resetRequests: securityRow.reset_requests,
      adminSignins: securityRow.admin_signins,
    },
    cost: {
      databaseBytes: snapshot.databaseBytes,
      compute: null,
      cdn: null,
      cache: null,
      externalApis: null,
      workers: null,
    },
    performance: {
      comparedWith: null,
      api: {
        samples: latency.samples || 0,
        p50: latency.p50 == null ? null : Math.round(Number(latency.p50)),
        p95: latency.p95 == null ? null : Math.round(Number(latency.p95)),
        p99: latency.p99 == null ? null : Math.round(Number(latency.p99)),
      },
    },
  };
}
