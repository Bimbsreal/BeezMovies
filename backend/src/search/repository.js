import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { withTransaction } from '../db/transaction.js';
import { logger } from '../logger/index.js';
import { pagination } from '../catalog/serializers.js';
import { SEARCH_STATEMENT_TIMEOUT_MS, SEARCH_SUGGESTION_LIMIT } from './constants.js';
import { searchableKey } from './keys.js';

const FILTERS = `
  d.index_version = (SELECT version FROM search_index_versions WHERE status = 'active' LIMIT 1)
  AND d.status = 'active'
  AND ($2::text IS NULL OR d.genre_slugs @> ARRAY[$2]::text[])
  AND ($3::smallint IS NULL OR d.release_year = $3)
  AND ($4::text IS NULL OR d.language_codes @> ARRAY[$4]::text[])
  AND ($5::text IS NULL OR d.country_codes @> ARRAY[$5]::text[])
  AND ($6::text IS NULL OR d.collection_slug = $6)
  AND ($7::uuid IS NULL OR d.person_ids @> ARRAY[$7]::uuid[])
  AND ($8::text IS NULL OR d.content_type_code = $8)
`;

const MATCH = `
  d.normalized_title = catalog_normalize_text($1)
  OR (
    char_length(catalog_normalize_text($1)) >= 2
    AND d.normalized_title LIKE catalog_normalize_text($1) || '%'
  )
  OR catalog_normalize_text($1) = ANY(d.alternate_keys)
  OR (
    char_length(catalog_normalize_text($1)) >= 4
    AND EXISTS (
      SELECT 1 FROM unnest(d.alternate_keys) alt
      WHERE alt LIKE '%' || catalog_normalize_text($1) || '%'
    )
  )
  OR d.search_vector @@ plainto_tsquery('simple', $1)
  OR (
    char_length(catalog_normalize_text($1)) >= 5
    AND (d.title_text % $1 OR $1 <% d.title_text OR $1 <% d.people_text)
  )
`;

const RANKED = `
  SELECT d.slug, d.document, d.content_type_code,
    CASE
      WHEN d.normalized_title = catalog_normalize_text($1) THEN 'exact_title'
      WHEN char_length(catalog_normalize_text($1)) >= 2
        AND d.normalized_title LIKE catalog_normalize_text($1) || '%' THEN 'prefix_title'
      WHEN catalog_normalize_text($1) = ANY(d.alternate_keys)
        OR (
          char_length(catalog_normalize_text($1)) >= 4
          AND EXISTS (
            SELECT 1 FROM unnest(d.alternate_keys) alt
            WHERE alt LIKE '%' || catalog_normalize_text($1) || '%'
          )
        ) THEN 'alternate_title'
      WHEN d.search_vector @@ plainto_tsquery('simple', $1) THEN 'text'
      ELSE 'fuzzy'
    END AS match_label,
    CASE
      WHEN d.normalized_title = catalog_normalize_text($1) THEN 1000
      WHEN char_length(catalog_normalize_text($1)) >= 2
        AND d.normalized_title LIKE catalog_normalize_text($1) || '%' THEN 700
      WHEN catalog_normalize_text($1) = ANY(d.alternate_keys)
        OR (
          char_length(catalog_normalize_text($1)) >= 4
          AND EXISTS (
            SELECT 1 FROM unnest(d.alternate_keys) alt
            WHERE alt LIKE '%' || catalog_normalize_text($1) || '%'
          )
        ) THEN 500
      WHEN d.search_vector @@ plainto_tsquery('simple', $1)
        THEN 200 + (ts_rank_cd(d.search_vector, plainto_tsquery('simple', $1)) * 50)
      ELSE similarity(d.title_text, $1) * 100
    END
    + CASE
        WHEN d.content_type_code = 'series' AND d.normalized_title = catalog_normalize_text($1) THEN 50
        ELSE 0
      END AS text_score,
    COALESCE(d.popularity, 0) * 0.05 AS editorial_score
  FROM search_documents d
  WHERE ${FILTERS}
    AND (${MATCH})
`;

function filterParams(query) {
  return [
    query.q,
    query.genre ?? null,
    query.year ?? null,
    query.language ?? null,
    query.country ?? null,
    query.collection ?? null,
    query.person ?? null,
    query.type ?? null,
  ];
}

async function prepare(client) {
  await client.query(`SET LOCAL statement_timeout = '${SEARCH_STATEMENT_TIMEOUT_MS}ms'`);
  await client.query('SET LOCAL pg_trgm.similarity_threshold = 0.34');
  await client.query('SET LOCAL pg_trgm.word_similarity_threshold = 0.45');
}

function asSearchError(error) {
  logger.error({ event: 'SEARCH_FAILED', code: error.code || 'SEARCH_FAILED' }, 'SEARCH_FAILED');
  if (error.code === '57014') {
    return new AppError('Search timed out', { status: 503, code: 'SEARCH_UNAVAILABLE' });
  }
  return new AppError('Search is temporarily unavailable', { status: 500, code: 'SEARCH_UNAVAILABLE' });
}

export async function searchQuery(text, params) {
  try {
    return await getPool().query(text, params);
  } catch (error) {
    throw asSearchError(error);
  }
}

export async function querySearch(query) {
  try {
    return await withTransaction(async (client) => {
      await prepare(client);
      const params = filterParams(query);
      const count = await client.query(
        `SELECT COUNT(*)::int AS total FROM search_documents d WHERE ${FILTERS} AND (${MATCH})`,
        params,
      );
      const rows = await client.query(
        `SELECT slug, document, match_label, content_type_code
         FROM (${RANKED}) ranked
         ORDER BY text_score DESC, editorial_score DESC, slug ASC
         LIMIT $9 OFFSET $10`,
        [...params, query.limit, query.offset],
      );
      return {
        total: count.rows[0].total,
        rows: rows.rows,
      };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw asSearchError(error);
  }
}

export async function queryDidYouMean(q) {
  if (searchableKey(q).length < 5) return [];
  try {
    return await withTransaction(async (client) => {
      await prepare(client);
      const rows = await client.query(
        `SELECT d.slug, d.title
         FROM search_documents d
         WHERE d.index_version = (SELECT version FROM search_index_versions WHERE status = 'active' LIMIT 1)
           AND d.status = 'active'
           AND (d.title_text % $1 OR $1 <% d.title_text)
         ORDER BY similarity(d.title_text, $1) DESC, d.slug ASC
         LIMIT 3`,
        [q],
      );
      return rows.rows.map((row) => ({ type: 'movie', label: row.title, slug: row.slug }));
    });
  } catch (error) {
    throw asSearchError(error);
  }
}

export async function querySuggestions(q) {
  const keyLength = searchableKey(q).length;
  if (keyLength < 2) return [];
  try {
    return await withTransaction(async (client) => {
      await prepare(client);
      const movies = await client.query(
        `SELECT d.title AS label, d.slug, d.release_year AS year,
                d.document #>> '{poster,url}' AS poster
         FROM search_documents d
         WHERE d.index_version = (SELECT version FROM search_index_versions WHERE status = 'active' LIMIT 1)
           AND d.status = 'active'
           AND d.normalized_title LIKE catalog_normalize_text($1) || '%'
         ORDER BY d.popularity DESC NULLS LAST, d.title ASC
         LIMIT 5`,
        [q],
      );
      const people = await client.query(
        `SELECT id, name
         FROM people
         WHERE archived_at IS NULL
           AND (
             normalized_name LIKE catalog_normalize_text($1) || '%'
             OR normalized_name LIKE '%' || catalog_normalize_text($1)
           )
         ORDER BY name ASC
         LIMIT 3`,
        [q],
      );
      const genres = await client.query(
        `SELECT slug, name
         FROM genres
         WHERE slug LIKE catalog_normalize_text($1) || '%'
            OR catalog_normalize_text(name) LIKE catalog_normalize_text($1) || '%'
         ORDER BY name ASC
         LIMIT 3`,
        [q],
      );
      const countryKey = countrySearchKey(q);
      const countries = countryKey.length < 2 ? { rows: [] } : await client.query(
        `SELECT c.slug, c.rail_title
         FROM countries c
         LEFT JOIN country_aliases a ON a.country_id = c.id
         WHERE c.active = TRUE
           AND (
             c.slug = $1
             OR a.alias = $1
             OR catalog_normalize_text(c.display_name) = catalog_normalize_text($1)
             OR catalog_normalize_text(c.rail_title) = catalog_normalize_text($1)
           )
         GROUP BY c.slug, c.rail_title, c.display_name
         ORDER BY c.display_name ASC
         LIMIT 3`,
        [countryKey],
      );
      const collections = await client.query(
        `SELECT slug, name
         FROM collections
         WHERE archived_at IS NULL
           AND (
             slug LIKE catalog_normalize_text($1) || '%'
             OR catalog_normalize_text(name) LIKE catalog_normalize_text($1) || '%'
           )
         ORDER BY name ASC
         LIMIT 3`,
        [q],
      );
      return [
        ...movies.rows.map((row) => ({
          type: 'movie',
          label: row.label,
          slug: row.slug,
          year: row.year,
          poster: row.poster,
        })),
        ...people.rows.map((row) => ({ type: 'person', label: row.name, id: row.id })),
        ...countries.rows.map((row) => ({ type: 'country', label: row.rail_title, slug: row.slug })),
        ...genres.rows.map((row) => ({ type: 'genre', label: row.name, slug: row.slug })),
        ...collections.rows.map((row) => ({ type: 'collection', label: row.name, slug: row.slug })),
      ].slice(0, SEARCH_SUGGESTION_LIMIT);
    });
  } catch (error) {
    throw asSearchError(error);
  }
}

export function countrySearchKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(movies|movie|films|film|cinema)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function searchPage(query, total) {
  return pagination(query.page, query.limit, total);
}
