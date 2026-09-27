import { randomUUID } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logger/index.js';

export const CLIENT_EVENTS = new Set([
  'PAGE_VIEW',
  'MOVIE_VIEW',
  'SEARCH_RESULT_CLICK',
  'TRAILER_PLAY',
  'PWA_INSTALL',
  'PWA_OPEN',
  'PWA_FAILURE',
  'RAIL_IMPRESSION',
  'RAIL_CLICK',
  'RECOMMENDATION_IMPRESSION',
  'RECOMMENDATION_CLICK',
  'WEB_VITAL',
]);

const SERVER_EVENTS = new Set([
  'SEARCH',
  'DOWNLOAD_REQUEST',
  'DOWNLOAD_RESOLVED',
  'DOWNLOAD_FAILED',
  'WATCHLIST_ADD',
  'FAVORITE_ADD',
  'API_LATENCY',
  'ERROR',
  'CATALOG_ADDED',
  'CATALOG_PUBLISHED',
  'CATALOG_ARCHIVED',
]);

const ERROR_STATUSES = new Set([400, 401, 403, 404, 429, 500, 502, 503]);
const PAGE_SUBJECTS = new Set(['home', 'search', 'movies', 'genres', 'collections', 'countries']);
const RAIL_SUBJECTS = /^(hero|featured|recent|trending|genres|collections|countries|collection(?::[a-z0-9-]+)?)$/;
const REC_SUBJECTS = new Set(['related', 'because-you-like', 'because-you-viewed']);
const PWA_SUBJECTS = new Set(['install', 'open', 'startup', 'service-worker']);
const VITAL_SUBJECTS = /^((lcp|inp|cls):(home|movie|search))$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const pending = new Set();
let writeImpl = persistEvents;

export function setAnalyticsWriter(writer) {
  writeImpl = writer || persistEvents;
}

export function recordAnalytics(input) {
  const job = Promise.resolve()
    .then(() => writeImpl([normalizeServer(input)]))
    .catch((error) => {
      logger.warn({ code: error.code || 'ANALYTICS_SKIPPED' }, 'ANALYTICS_SKIPPED');
    });
  pending.add(job);
  job.finally(() => pending.delete(job));
  return job;
}

export function flushAnalytics() {
  return Promise.allSettled([...pending]);
}

export async function acceptClientEvents(events, visitorKey) {
  const normalized = [];
  for (const event of events) {
    normalized.push(await normalizeClient(event, visitorKey));
  }
  try {
    await writeImpl(normalized);
    return { accepted: normalized.length, unavailable: false };
  } catch (error) {
    logger.warn({ code: error.code || 'ANALYTICS_SKIPPED' }, 'ANALYTICS_SKIPPED');
    return { accepted: 0, unavailable: true };
  }
}

export function recordErrorStatus(status) {
  if (!ERROR_STATUSES.has(status)) return;
  recordAnalytics({ name: 'ERROR', statusCode: status, outcome: 'failed' });
}

export async function pruneAnalytics() {
  await getPool().query(`DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '14 days'`);
  await getPool().query(`DELETE FROM analytics_latency_samples WHERE recorded_at < NOW() - INTERVAL '14 days'`);
  await getPool().query(`DELETE FROM analytics_search_terms WHERE day < CURRENT_DATE - 30`);
  await getPool().query(`DELETE FROM analytics_daily WHERE day < CURRENT_DATE - 400`);
  await getPool().query(`DELETE FROM search_query_stats WHERE last_searched_at < NOW() - INTERVAL '30 days'`);
}

function normalizeServer(input) {
  if (!SERVER_EVENTS.has(input.name)) {
    throw new AppError('Unknown analytics event', { status: 400, code: 'VALIDATION_ERROR' });
  }
  return {
    id: input.id || randomUUID(),
    name: input.name,
    subject: cleanKey(input.subject),
    outcome: cleanKey(input.outcome),
    providerSlug: cleanKey(input.providerSlug),
    failureCategory: cleanKey(input.failureCategory).slice(0, 64),
    statusCode: Number.isInteger(input.statusCode) ? input.statusCode : 0,
    durationMs: boundedDuration(input.durationMs),
    queryText: input.name === 'SEARCH' ? searchText(input.subject) : '',
    metric: serverMetric(input),
    visitorKey: null,
  };
}

async function normalizeClient(event, visitorKey) {
  if (!CLIENT_EVENTS.has(event.name)) {
    throw new AppError('Unknown analytics event', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const subject = cleanKey(event.subject);
  if (subject.includes('@')) {
    throw new AppError('Analytics subject is not valid', { status: 400, code: 'VALIDATION_ERROR' });
  }
  await assertSubject(event.name, subject);
  const durationMs = boundedDuration(event.durationMs);
  if (event.name === 'WEB_VITAL' && durationMs == null) {
    throw new AppError('A web vital needs a measurement', { status: 400, code: 'VALIDATION_ERROR' });
  }
  return {
    id: event.id,
    name: event.name,
    subject,
    outcome: event.name === 'SEARCH_RESULT_CLICK' ? 'click' : '',
    providerSlug: '',
    failureCategory: '',
    statusCode: 0,
    durationMs,
    queryText: event.name === 'SEARCH_RESULT_CLICK' ? searchText(event.query) : '',
    metric: event.name === 'WEB_VITAL' ? `vital:${subject}` : '',
    visitorKey: visitorKey || null,
  };
}

async function assertSubject(name, subject) {
  if (name === 'PAGE_VIEW') {
    if (PAGE_SUBJECTS.has(subject)) return;
    if (subject.startsWith('movie:')) {
      await assertActiveSlug(subject.slice(6));
      return;
    }
    if (subject.startsWith('country:')) {
      await assertActiveCountry(subject.slice(8));
      return;
    }
  } else if (name === 'MOVIE_VIEW' || name === 'TRAILER_PLAY' || name === 'SEARCH_RESULT_CLICK') {
    await assertActiveSlug(subject);
    return;
  } else if ((name === 'RAIL_IMPRESSION' || name === 'RAIL_CLICK') && RAIL_SUBJECTS.test(subject)) {
    return;
  } else if ((name === 'RECOMMENDATION_IMPRESSION' || name === 'RECOMMENDATION_CLICK') && REC_SUBJECTS.has(subject)) {
    return;
  } else if ((name === 'PWA_INSTALL' || name === 'PWA_OPEN' || name === 'PWA_FAILURE') && PWA_SUBJECTS.has(subject)) {
    return;
  } else if (name === 'WEB_VITAL' && VITAL_SUBJECTS.test(subject)) {
    return;
  }
  throw new AppError('Analytics subject is not valid', { status: 400, code: 'VALIDATION_ERROR' });
}

async function assertActiveCountry(slug) {
  if (!SLUG.test(slug || '')) {
    throw new AppError('Analytics subject is not valid', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const row = await getPool().query(
    'SELECT 1 FROM countries WHERE slug = $1 AND active = TRUE',
    [slug],
  );
  if (!row.rowCount) {
    throw new AppError('Analytics subject is not valid', { status: 400, code: 'VALIDATION_ERROR' });
  }
}

async function assertActiveSlug(slug) {
  if (!SLUG.test(slug || '')) {
    throw new AppError('Analytics subject is not valid', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const row = await getPool().query(
    `SELECT 1 FROM movies WHERE slug = $1 AND status = 'active'`,
    [slug],
  );
  if (!row.rowCount) {
    throw new AppError('Analytics subject is not valid', { status: 400, code: 'VALIDATION_ERROR' });
  }
}

function serverMetric(input) {
  if (input.name === 'API_LATENCY') return `api:${cleanKey(input.subject)}`;
  if (input.name === 'DOWNLOAD_RESOLVED' || input.name === 'DOWNLOAD_FAILED') {
    return `download:${cleanKey(input.providerSlug) || 'none'}`;
  }
  if (input.name === 'SEARCH' && input.durationMs != null) return 'api:search';
  return '';
}

function cleanKey(value) {
  return String(value || '').trim().slice(0, 80);
}

function searchText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 -]/g, '')
    .slice(0, 80);
}

function boundedDuration(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 120000) {
    throw new AppError('Analytics measurement is not valid', { status: 400, code: 'VALIDATION_ERROR' });
  }
  return number;
}

async function persistEvents(events) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    for (const event of events) {
      const inserted = await client.query(
        `INSERT INTO analytics_events (
           id, event_name, subject_key, outcome, provider_slug, failure_category,
           status_code, duration_ms, visitor_key
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (id) DO NOTHING
         RETURNING id`,
        [
          event.id,
          event.name,
          event.subject,
          event.outcome,
          event.providerSlug,
          event.failureCategory,
          event.statusCode,
          event.durationMs,
          event.visitorKey,
        ],
      );
      if (!inserted.rowCount) continue;
      await client.query(
        `INSERT INTO analytics_daily (
           day, event_name, subject_key, outcome, provider_slug, failure_category,
           status_code, event_count, duration_sum, duration_count
         ) VALUES (CURRENT_DATE, $1, $2, $3, $4, $5, $6, 1, $7, $8)
         ON CONFLICT ON CONSTRAINT analytics_daily_pkey DO UPDATE SET
           event_count = analytics_daily.event_count + 1,
           duration_sum = analytics_daily.duration_sum + EXCLUDED.duration_sum,
           duration_count = analytics_daily.duration_count + EXCLUDED.duration_count`,
        [
          event.name,
          event.name === 'SEARCH' ? '' : event.subject,
          event.outcome,
          event.providerSlug,
          event.failureCategory,
          event.statusCode,
          event.durationMs || 0,
          event.durationMs == null ? 0 : 1,
        ],
      );
      if (event.name === 'SEARCH' && event.queryText) {
        await client.query(
          `INSERT INTO analytics_search_terms (day, query_text, search_count, zero_count)
           VALUES (CURRENT_DATE, $1, 1, $2)
           ON CONFLICT (day, query_text) DO UPDATE SET
             search_count = analytics_search_terms.search_count + 1,
             zero_count = analytics_search_terms.zero_count + EXCLUDED.zero_count`,
          [event.queryText, event.outcome === 'zero' ? 1 : 0],
        );
      }
      if (event.name === 'SEARCH_RESULT_CLICK' && event.queryText) {
        await client.query(
          `UPDATE analytics_search_terms
           SET click_count = click_count + 1
           WHERE day = CURRENT_DATE AND query_text = $1`,
          [event.queryText],
        );
      }
      if (event.metric && event.durationMs != null) {
        await client.query(
          `INSERT INTO analytics_latency_samples (metric, duration_ms) VALUES ($1, $2)`,
          [event.metric, event.durationMs],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
