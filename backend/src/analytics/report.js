import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { pruneAnalytics } from './record.js';

const DAY_MS = 24 * 60 * 60 * 1000;
let lastPrune = 0;

export function resolvePeriod(query) {
  const now = new Date();
  if (query.period === 'custom') {
    const from = parseDay(query.from);
    const to = parseDay(query.to);
    if (!from || !to || to < from) {
      throw new AppError('Choose a valid date range', { status: 400, code: 'VALIDATION_ERROR' });
    }
    const end = new Date(to.getTime() + DAY_MS);
    if (end.getTime() - from.getTime() > 90 * DAY_MS) {
      throw new AppError('Custom ranges are limited to 90 days', { status: 400, code: 'VALIDATION_ERROR' });
    }
    return windowFor(from, end, 'custom');
  }
  const days = { today: 0, '7d': 7, '30d': 30, '90d': 90 }[query.period || '7d'];
  if (days == null) {
    throw new AppError('Choose a valid time period', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const start = days === 0
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(now.getTime() - days * DAY_MS);
  return windowFor(start, now, query.period || '7d');
}

function windowFor(from, to, key) {
  const length = to.getTime() - from.getTime();
  const period = {
    key,
    from,
    to,
    previousFrom: new Date(from.getTime() - length),
    previousTo: from,
    label: key === 'today' ? 'Today' : key === 'custom' ? 'Custom range' : `Last ${key.slice(0, -1)} days`,
  };
  period.fromDay = dayStamp(period.from);
  period.toDay = dayStamp(new Date(period.to.getTime() - 1));
  period.previousFromDay = dayStamp(period.previousFrom);
  period.previousToDay = dayStamp(new Date(period.previousTo.getTime() - 1));
  return period;
}

function dayStamp(value) {
  return value.toISOString().slice(0, 10);
}

function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function analyticsReport(query) {
  await pruneIfDue();
  const period = resolvePeriod(query);
  const [counts, previous, movies, search, downloads, providers, discovery, pwa, performance, errors, catalog] = await Promise.all([
    groupedCounts(period.fromDay, period.toDay),
    groupedCounts(period.previousFromDay, period.previousToDay),
    movieRows(period.fromDay, period.toDay),
    searchReport(period.fromDay, period.toDay),
    downloadReport(period.fromDay, period.toDay),
    providerReport(period.fromDay, period.toDay),
    discoveryReport(period.fromDay, period.toDay),
    namedCounts(period.fromDay, period.toDay, ['PWA_INSTALL', 'PWA_OPEN', 'PWA_FAILURE']),
    performanceReport(period.from, period.to),
    errorReport(period.fromDay, period.toDay),
    catalogReport(period),
  ]);
  return {
    period: {
      key: period.key,
      label: period.label,
      from: period.from.toISOString(),
      to: period.to.toISOString(),
      note: 'Compared with the previous period of the same length. A change does not show a cause.',
    },
    overview: {
      movieViews: compare(counts.MOVIE_VIEW, previous.MOVIE_VIEW),
      searches: compare(counts.SEARCH, previous.SEARCH),
      downloads: compare(counts.DOWNLOAD_REQUEST, previous.DOWNLOAD_REQUEST),
      errors: compare(counts.ERROR, previous.ERROR),
    },
    catalog,
    movies,
    search,
    downloads,
    providers,
    discovery,
    pwa: {
      installs: pwa.PWA_INSTALL || 0,
      opens: pwa.PWA_OPEN || 0,
      failures: pwa.PWA_FAILURE || 0,
    },
    performance,
    errors,
  };
}

export async function analyticsCsv(query) {
  const period = resolvePeriod(query);
  const rows = await getPool().query(
    `SELECT day, event_name, subject_key, outcome, provider_slug, failure_category, status_code, event_count
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date
     ORDER BY day, event_name, event_count DESC`,
    [period.fromDay, period.toDay],
  );
  const header = 'day,event,subject,outcome,provider,failure,status,count';
  const lines = rows.rows.map((row) => [
    dayLabel(row.day),
    row.event_name,
    row.subject_key,
    row.outcome,
    row.provider_slug,
    row.failure_category,
    row.status_code,
    row.event_count,
  ].map(csvCell).join(','));
  return `${header}\n${lines.join('\n')}\n`;
}

async function pruneIfDue() {
  const now = Date.now();
  if (now - lastPrune < 60 * 60 * 1000) return;
  lastPrune = now;
  try {
    await pruneAnalytics();
  } catch {
    lastPrune = 0;
  }
}

async function groupedCounts(from, to) {
  const rows = await getPool().query(
    `SELECT event_name, COALESCE(SUM(event_count), 0)::int AS count
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date
     GROUP BY event_name`,
    [from, to],
  );
  return Object.fromEntries(rows.rows.map((row) => [row.event_name, row.count]));
}

function compare(current = 0, previous = 0) {
  return { current, previous };
}

async function movieRows(from, to) {
  const rows = await getPool().query(
    `SELECT subject_key AS slug,
            SUM(event_count) FILTER (WHERE event_name = 'MOVIE_VIEW')::int AS views,
            SUM(event_count) FILTER (WHERE event_name = 'TRAILER_PLAY')::int AS trailers,
            SUM(event_count) FILTER (WHERE event_name = 'DOWNLOAD_REQUEST')::int AS requests,
            SUM(event_count) FILTER (WHERE event_name = 'DOWNLOAD_RESOLVED')::int AS resolved,
            SUM(event_count) FILTER (WHERE event_name = 'DOWNLOAD_FAILED')::int AS failed
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date
       AND event_name IN ('MOVIE_VIEW', 'TRAILER_PLAY', 'DOWNLOAD_REQUEST', 'DOWNLOAD_RESOLVED', 'DOWNLOAD_FAILED')
       AND subject_key <> ''
     GROUP BY subject_key
     ORDER BY COALESCE(SUM(event_count) FILTER (WHERE event_name = 'MOVIE_VIEW'), 0) DESC, subject_key
     LIMIT 50`,
    [from, to],
  );
  return rows.rows.map((row) => ({
    slug: row.slug,
    views: row.views || 0,
    trailers: row.trailers || 0,
    requests: row.requests || 0,
    resolved: row.resolved || 0,
    failed: row.failed || 0,
  }));
}

async function searchReport(from, to) {
  const totals = await getPool().query(
    `SELECT COALESCE(SUM(search_count), 0)::int AS searches,
            COALESCE(SUM(zero_count), 0)::int AS zero_results,
            COALESCE(SUM(click_count), 0)::int AS clicks
     FROM analytics_search_terms
     WHERE day >= $1::date AND day <= $2::date`,
    [from, to],
  );
  const popular = await getPool().query(
    `SELECT query_text, SUM(search_count)::int AS searches, SUM(zero_count)::int AS zero_results, SUM(click_count)::int AS clicks
     FROM analytics_search_terms
     WHERE day >= $1::date AND day <= $2::date
     GROUP BY query_text
     ORDER BY SUM(search_count) DESC, query_text
     LIMIT 20`,
    [from, to],
  );
  const zeros = popular.rows.filter((row) => row.zero_results > 0);
  const row = totals.rows[0];
  const searches = row.searches || 0;
  return {
    searches,
    zeroResults: row.zero_results || 0,
    successful: Math.max(searches - (row.zero_results || 0), 0),
    clicks: row.clicks || 0,
    clickRate: searches ? Number((row.clicks / searches).toFixed(3)) : null,
    popular: popular.rows.map(termRow),
    zeroQueries: zeros.map(termRow),
    retentionDays: 30,
  };
}

function termRow(row) {
  return {
    query: row.query_text,
    searches: row.searches,
    zeroResults: row.zero_results,
    clicks: row.clicks,
  };
}

async function downloadReport(from, to) {
  const rows = await getPool().query(
    `SELECT event_name, provider_slug, failure_category, SUM(event_count)::int AS count
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date
       AND event_name IN ('DOWNLOAD_REQUEST', 'DOWNLOAD_RESOLVED', 'DOWNLOAD_FAILED')
     GROUP BY event_name, provider_slug, failure_category`,
    [from, to],
  );
  const summary = { requests: 0, resolved: 0, failed: 0, failures: [] };
  for (const row of rows.rows) {
    if (row.event_name === 'DOWNLOAD_REQUEST') summary.requests += row.count;
    if (row.event_name === 'DOWNLOAD_RESOLVED') summary.resolved += row.count;
    if (row.event_name === 'DOWNLOAD_FAILED') {
      summary.failed += row.count;
      summary.failures.push({
        provider: row.provider_slug || 'unknown',
        category: row.failure_category || 'unknown',
        count: row.count,
      });
    }
  }
  return summary;
}

async function providerReport(from, to) {
  const rows = await getPool().query(
    `SELECT p.slug, p.name,
            COALESCE(h.status, 'unknown') AS health,
            COALESCE(SUM(d.event_count) FILTER (WHERE d.event_name = 'DOWNLOAD_RESOLVED'), 0)::int AS resolved,
            COALESCE(SUM(d.event_count) FILTER (WHERE d.event_name = 'DOWNLOAD_FAILED'), 0)::int AS failed,
            COALESCE(SUM(d.event_count) FILTER (WHERE d.failure_category = 'PROVIDER_TIMEOUT'), 0)::int AS timeouts,
            COALESCE(SUM(d.duration_sum) FILTER (WHERE d.event_name IN ('DOWNLOAD_RESOLVED', 'DOWNLOAD_FAILED')), 0)::bigint AS duration_sum,
            COALESCE(SUM(d.duration_count) FILTER (WHERE d.event_name IN ('DOWNLOAD_RESOLVED', 'DOWNLOAD_FAILED')), 0)::int AS duration_count
     FROM providers p
     LEFT JOIN provider_health h ON h.provider_id = p.id
     LEFT JOIN analytics_daily d
       ON d.provider_slug = p.slug
      AND d.day >= $1::date AND d.day <= $2::date
     WHERE p.archived_at IS NULL
     GROUP BY p.slug, p.name, h.status
     ORDER BY p.name`,
    [from, to],
  );
  return rows.rows.map((row) => {
    const attempts = row.resolved + row.failed;
    return {
      slug: row.slug,
      name: row.name,
      availability: row.health,
      resolved: row.resolved,
      failed: row.failed,
      successRate: attempts ? Number((row.resolved / attempts).toFixed(3)) : null,
      failureRate: attempts ? Number((row.failed / attempts).toFixed(3)) : null,
      timeoutRate: attempts ? Number((row.timeouts / attempts).toFixed(3)) : null,
      averageResponseMs: row.duration_count ? Math.round(Number(row.duration_sum) / row.duration_count) : null,
    };
  });
}

async function discoveryReport(from, to) {
  const rows = await getPool().query(
    `SELECT event_name, subject_key, SUM(event_count)::int AS count
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date
       AND event_name IN ('RAIL_IMPRESSION', 'RAIL_CLICK', 'RECOMMENDATION_IMPRESSION', 'RECOMMENDATION_CLICK')
     GROUP BY event_name, subject_key
     ORDER BY subject_key`,
    [from, to],
  );
  const rails = new Map();
  const recommendations = { impressions: 0, clicks: 0, subjects: [] };
  for (const row of rows.rows) {
    if (row.event_name.startsWith('RECOMMENDATION')) {
      if (row.event_name.endsWith('IMPRESSION')) recommendations.impressions += row.count;
      else recommendations.clicks += row.count;
      recommendations.subjects.push({ subject: row.subject_key, event: row.event_name, count: row.count });
    } else {
      const current = rails.get(row.subject_key) || { subject: row.subject_key, impressions: 0, clicks: 0 };
      if (row.event_name === 'RAIL_IMPRESSION') current.impressions += row.count;
      else current.clicks += row.count;
      rails.set(row.subject_key, current);
    }
  }
  return {
    rails: [...rails.values()].map((rail) => ({
      ...rail,
      engagementRate: rail.impressions ? Number((rail.clicks / rail.impressions).toFixed(3)) : null,
    })),
    recommendations: {
      ...recommendations,
      clickRate: recommendations.impressions
        ? Number((recommendations.clicks / recommendations.impressions).toFixed(3))
        : null,
      note: 'An impression is not a successful recommendation. Use the click count.',
    },
  };
}

async function namedCounts(from, to, names) {
  const counts = await groupedCounts(from, to);
  return Object.fromEntries(names.map((name) => [name, counts[name] || 0]));
}

async function errorReport(from, to) {
  const rows = await getPool().query(
    `SELECT status_code, SUM(event_count)::int AS count
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date AND event_name = 'ERROR'
     GROUP BY status_code
     ORDER BY count DESC, status_code`,
    [from, to],
  );
  return rows.rows.map((row) => ({ status: row.status_code, count: row.count }));
}

async function performanceReport(from, to) {
  const metrics = ['api:search', 'api:movie', 'vital:lcp:home', 'vital:lcp:movie', 'vital:lcp:search', 'vital:inp:home', 'vital:inp:movie', 'vital:inp:search', 'vital:cls:home', 'vital:cls:movie', 'vital:cls:search'];
  const entries = await Promise.all(metrics.map(async (metric) => [metric, await percentiles(metric, from, to)]));
  const found = Object.fromEntries(entries);
  return {
    sampleRetentionDays: 14,
    search: found['api:search'],
    movieDetail: found['api:movie'],
    download: await percentiles('download:%', from, to),
    vitals: {
      home: vitalSet(found, 'home'),
      movie: vitalSet(found, 'movie'),
      search: vitalSet(found, 'search'),
    },
  };
}

function vitalSet(found, page) {
  return {
    lcpMs: found[`vital:lcp:${page}`],
    inpMs: found[`vital:inp:${page}`],
    clsThousandths: found[`vital:cls:${page}`],
  };
}

async function percentiles(metric, from, to) {
  const rows = await getPool().query(
    `SELECT
       percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms) AS p50,
       percentile_cont(0.75) WITHIN GROUP (ORDER BY duration_ms) AS p75,
       percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95,
       percentile_cont(0.99) WITHIN GROUP (ORDER BY duration_ms) AS p99,
       COUNT(*)::int AS samples
     FROM analytics_latency_samples
     WHERE metric LIKE $1 AND recorded_at >= $2 AND recorded_at < $3`,
    [metric, from, to],
  );
  const row = rows.rows[0];
  if (!row?.samples) return null;
  return {
    p50: Math.round(Number(row.p50)),
    p75: Math.round(Number(row.p75)),
    p95: Math.round(Number(row.p95)),
    p99: Math.round(Number(row.p99)),
    samples: row.samples,
  };
}

async function catalogReport(period) {
  const added = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM movies WHERE created_at >= $1 AND created_at < $2`,
    [period.from, period.to],
  );
  const counts = await groupedCounts(period.fromDay, period.toDay);
  const snapshot = await getPool().query(`
    SELECT
      (SELECT COUNT(*)::int FROM movies WHERE status = 'active' AND NOT EXISTS (
        SELECT 1 FROM movie_images i WHERE i.movie_id = movies.id AND i.image_type = 'poster'
      )) AS missing_posters,
      (SELECT COUNT(*)::int FROM ingestion_reviews WHERE status = 'pending') AS duplicates,
      (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'failed' AND created_at >= $1 AND created_at < $2) AS metadata_failures
  `, [period.from, period.to]);
  const trend = await getPool().query(
    `SELECT day,
            SUM(event_count) FILTER (WHERE event_name = 'CATALOG_ADDED')::int AS added,
            SUM(event_count) FILTER (WHERE event_name = 'CATALOG_PUBLISHED')::int AS published,
            SUM(event_count) FILTER (WHERE event_name = 'CATALOG_ARCHIVED')::int AS archived
     FROM analytics_daily
     WHERE day >= $1::date AND day <= $2::date
       AND event_name IN ('CATALOG_ADDED', 'CATALOG_PUBLISHED', 'CATALOG_ARCHIVED')
     GROUP BY day
     ORDER BY day`,
    [period.fromDay, period.toDay],
  );
  return {
    added: added.rows[0].count,
    published: counts.CATALOG_PUBLISHED || 0,
    archived: counts.CATALOG_ARCHIVED || 0,
    metadataFailures: snapshot.rows[0].metadata_failures,
    duplicateCandidates: snapshot.rows[0].duplicates,
    missingPosters: snapshot.rows[0].missing_posters,
    snapshotNote: 'Missing artwork and duplicate candidates are the current catalog, not a historical trend.',
    trend: trend.rows.map((row) => ({
      day: dayLabel(row.day),
      added: row.added || 0,
      published: row.published || 0,
      archived: row.archived || 0,
    })),
  };
}

function dayLabel(value) {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${value.getFullYear()}-${month}-${day}`;
}

function csvCell(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
