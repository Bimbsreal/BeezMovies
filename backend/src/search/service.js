import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logger/index.js';
import { getCollections, getGenres, getMovieList } from '../catalog/service.js';
import { SEARCH_MIN_QUERY } from './constants.js';
import { searchCache } from './cache.js';
import { searchCacheKey, searchableKey } from './keys.js';
import { queryDidYouMean, querySearch, querySuggestions, searchPage } from './repository.js';
import { getRecentList, getTrendingList } from '../discovery/home.js';
import { recordAnalytics } from '../analytics/record.js';
import { searchEpisodeHits } from '../catalog/episodes.js';

const DISCOVERY_PAGE = { page: 1, limit: 12, order: 'desc' };

function assertSearchable(q) {
  if (searchableKey(q).length < SEARCH_MIN_QUERY) {
    throw new AppError('Enter a search term', { status: 400, code: 'VALIDATION_ERROR' });
  }
}

async function activeVersion() {
  const rows = await getPool().query(
    `SELECT version FROM search_index_versions WHERE status = 'active' LIMIT 1`,
  );
  return rows.rows[0]?.version ?? 0;
}

async function rememberQuery(q, total, durationMs) {
  const key = searchableKey(q).slice(0, 80);
  if (!key) return;
  try {
    await getPool().query(
      `INSERT INTO search_query_stats (
         normalized_query, search_count, zero_result_count, total_duration_ms
       )
       VALUES ($1, 1, $2, $3)
       ON CONFLICT (normalized_query) DO UPDATE SET
         search_count = search_query_stats.search_count + 1,
         zero_result_count = search_query_stats.zero_result_count + EXCLUDED.zero_result_count,
         total_duration_ms = search_query_stats.total_duration_ms + EXCLUDED.total_duration_ms,
         last_searched_at = NOW()`,
      [key, total === 0 ? 1 : 0, durationMs],
    );
  } catch (error) {
    logger.warn({ event: 'SEARCH_STATS_SKIPPED', code: error.code }, 'SEARCH_STATS_SKIPPED');
  }
}

export async function searchCatalog(query, { useCache = true } = {}) {
  assertSearchable(query.q);
  const version = await activeVersion();
  const cacheKey = searchCacheKey({
    version,
    query: query.q,
    filters: query,
    page: query.page,
    limit: query.limit,
  });
  if (useCache) {
    const cached = await searchCache.get(cacheKey);
    if (cached) {
      recordAnalytics({
        name: 'SEARCH',
        subject: query.q,
        outcome: (cached.pagination?.total || 0) === 0 ? 'zero' : 'success',
      });
      return cached;
    }
  }

  const started = Date.now();
  const result = await querySearch({
    ...query,
    offset: (query.page - 1) * query.limit,
  });
  const durationMs = Date.now() - started;
  const data = result.rows.map((row) => ({
    ...row.document,
    contentType: row.document.contentType || (row.content_type_code ? {
      code: row.content_type_code,
      name: row.content_type_code === 'movie' ? 'Movie' : (row.content_type_code === 'series' ? 'Series' : row.content_type_code),
    } : null),
    relevance: { match: row.match_label },
  }));
  const episodic = !query.type || query.type === 'series' || query.type === 'episode' || query.type === 'season';
  const body = {
    data,
    episodes: episodic ? await searchEpisodeHits(query.q) : [],
    pagination: searchPage(query, result.total),
    didYouMean: result.total === 0 ? await queryDidYouMean(query.q) : [],
  };
  logger.info({
    event: 'SEARCH_QUERY',
    durationMs,
    resultCount: result.total,
    zero: result.total === 0,
  }, 'SEARCH_QUERY');
  await rememberQuery(query.q, result.total, durationMs);
  recordAnalytics({
    name: 'SEARCH',
    subject: query.q,
    outcome: result.total === 0 ? 'zero' : 'success',
    durationMs,
  });
  if (useCache) await searchCache.set(cacheKey, body);
  return body;
}

export async function suggestCatalog(q) {
  assertSearchable(q);
  return { data: await querySuggestions(q) };
}

async function discoveryList(sort) {
  return getMovieList({ ...DISCOVERY_PAGE, sort }, null);
}

export function getTrending() {
  return getTrendingList();
}

export function getPopular() {
  return discoveryList('popularity');
}

export function getRecent() {
  return getRecentList();
}

export async function getDiscoveryGenres() {
  return { data: await getGenres() };
}

export async function getDiscoveryCollections() {
  return { data: await getCollections() };
}
