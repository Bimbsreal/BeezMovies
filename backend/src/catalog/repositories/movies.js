import { catalogQuery } from '../db.js';
import { LIST_CAP, MOVIE_SORTS } from '../constants.js';

const SUMMARY_SELECT = `
  m.slug,
  m.canonical_title,
  m.original_title,
  m.synopsis,
  m.tagline,
  m.release_date::text AS release_date,
  m.release_year,
  m.runtime_minutes,
  m.status,
  m.adult,
  m.popularity,
  l.code AS original_language_code,
  l.name AS original_language_name,
  COALESCE(
    json_agg(DISTINCT jsonb_build_object('slug', g.slug, 'name', g.name))
      FILTER (WHERE g.id IS NOT NULL),
    '[]'::json
  ) AS genres,
  (
    SELECT jsonb_build_object('url', mi.url, 'width', mi.width, 'height', mi.height)
    FROM movie_images mi
    WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
    ORDER BY mi.priority ASC, mi.created_at ASC
    LIMIT 1
  ) AS poster,
  ct.code AS content_type_code,
  ct.name AS content_type_name
`;

function orderSql(sort, order) {
  if (sort === 'trending') {
    return 'COALESCE(m.popularity, 0) DESC, m.release_date DESC NULLS LAST, m.slug ASC';
  }
  const column = MOVIE_SORTS[sort] || MOVIE_SORTS.release_date;
  const direction = order === 'asc' ? 'ASC' : 'DESC';
  return `${column} ${direction} NULLS LAST, m.slug ASC`;
}

export function movieWhere(filters) {
  const clauses = ['m.status = ANY($1::text[])'];
  const params = [filters.statuses];

  const add = (sql, value) => {
    params.push(value);
    clauses.push(sql.replaceAll('$?', `$${params.length}`));
  };

  if (filters.year) add('m.release_year = $?', filters.year);
  if (filters.releasedFrom) add('m.release_date >= $?::date', filters.releasedFrom);
  if (filters.releasedTo) add('m.release_date <= $?::date', filters.releasedTo);
  if (filters.genre) {
    add(`EXISTS (
      SELECT 1 FROM movie_genres mg
      JOIN genres g ON g.id = mg.genre_id
      WHERE mg.movie_id = m.id AND g.slug = $?
    )`, filters.genre);
  }
  if (filters.language) {
    add(`(
      EXISTS (
        SELECT 1 FROM movie_languages ml
        JOIN languages lang ON lang.id = ml.language_id
        WHERE ml.movie_id = m.id AND lang.code = $?
      )
      OR EXISTS (
        SELECT 1 FROM languages lang
        WHERE lang.id = m.original_language_id AND lang.code = $?
      )
    )`, filters.language);
  }
  if (filters.country) {
    add(`EXISTS (
      SELECT 1 FROM movie_countries mc
      JOIN countries c ON c.id = mc.country_id
      WHERE mc.movie_id = m.id AND c.code = $?
    )`, filters.country);
  }
  if (filters.contentType) {
    add(`EXISTS (
      SELECT 1 FROM content_types ct
      WHERE ct.id = m.content_type_id AND ct.code = $? AND ct.active = TRUE
    )`, filters.contentType);
  }
  if (filters.collection) {
    add(`EXISTS (
      SELECT 1 FROM collection_movies cm
      JOIN collections col ON col.id = cm.collection_id
      WHERE cm.movie_id = m.id AND col.slug = $? AND col.archived_at IS NULL
    )`, filters.collection);
  }
  if (filters.personId) add(`EXISTS (
    SELECT 1 FROM movie_credits credit
    WHERE credit.movie_id = m.id AND credit.person_id = $?::uuid
  )`, filters.personId);
  if (filters.q) {
    add(`(
      m.normalized_title LIKE ('%' || catalog_normalize_text($?) || '%')
      OR EXISTS (
        SELECT 1 FROM alternate_titles alt
        WHERE alt.movie_id = m.id
          AND alt.normalized_title LIKE ('%' || catalog_normalize_text($?) || '%')
      )
    )`, filters.q);
  }

  return { where: clauses.join(' AND '), params };
}

const MOVIE_COLUMNS = `
  m.id,
  m.slug,
  m.canonical_title,
  m.original_title,
  m.synopsis,
  m.tagline,
  m.release_date::text AS release_date,
  m.release_year,
  m.runtime_minutes,
  m.status,
  m.adult,
  m.popularity,
  m.created_at,
  m.updated_at,
  l.code AS original_language_code,
  l.name AS original_language_name,
  ct.code AS content_type_code,
  ct.name AS content_type_name
`;

export async function findMovieBySlug(slug) {
  const result = await catalogQuery(
    `SELECT ${MOVIE_COLUMNS}
     FROM movies m
     LEFT JOIN languages l ON l.id = m.original_language_id
     LEFT JOIN content_types ct ON ct.id = m.content_type_id
     WHERE m.slug = $1`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function findMovieById(id) {
  const result = await catalogQuery(
    `SELECT ${MOVIE_COLUMNS}
     FROM movies m
     LEFT JOIN languages l ON l.id = m.original_language_id
     LEFT JOIN content_types ct ON ct.id = m.content_type_id
     WHERE m.id = $1`,
    [id],
  );
  return result.rows[0] || null;
}

export async function listMovies(filters) {
  const { where, params } = movieWhere(filters);
  const count = await catalogQuery(
    `SELECT COUNT(*)::int AS total FROM movies m WHERE ${where}`,
    params,
  );
  const limitIndex = params.length + 1;
  const offsetIndex = params.length + 2;
  const rows = await catalogQuery(
    `SELECT ${SUMMARY_SELECT}
     FROM movies m
     LEFT JOIN languages l ON l.id = m.original_language_id
     LEFT JOIN content_types ct ON ct.id = m.content_type_id
     LEFT JOIN movie_genres mg ON mg.movie_id = m.id
     LEFT JOIN genres g ON g.id = mg.genre_id
     WHERE ${where}
     GROUP BY m.id, l.code, l.name, ct.code, ct.name
     ORDER BY ${orderSql(filters.sort, filters.order)}
     LIMIT $${limitIndex} OFFSET $${offsetIndex}`,
    [...params, filters.limit, filters.offset],
  );
  return { total: count.rows[0].total, rows: rows.rows };
}

export async function listMoviesForCollection(collectionId) {
  const result = await catalogQuery(
    `SELECT ${SUMMARY_SELECT}, cm.sort_order
     FROM collection_movies cm
     JOIN movies m ON m.id = cm.movie_id
     LEFT JOIN languages l ON l.id = m.original_language_id
     LEFT JOIN content_types ct ON ct.id = m.content_type_id
     LEFT JOIN movie_genres mg ON mg.movie_id = m.id
     LEFT JOIN genres g ON g.id = mg.genre_id
     WHERE cm.collection_id = $1 AND m.status = 'active'
     GROUP BY m.id, l.code, l.name, ct.code, ct.name, cm.sort_order
     ORDER BY cm.sort_order ASC, m.slug ASC
     LIMIT $2`,
    [collectionId, LIST_CAP],
  );
  return result.rows;
}
