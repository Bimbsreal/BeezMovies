import { catalogQuery } from '../db.js';
import { LIST_CAP, PUBLIC_MOVIE_STATUS } from '../constants.js';

export async function listGenres() {
  const result = await catalogQuery(
    `SELECT g.slug, g.name, COUNT(m.id)::int AS movie_count
     FROM genres g
     LEFT JOIN movie_genres mg ON mg.genre_id = g.id
     LEFT JOIN movies m ON m.id = mg.movie_id AND m.status = $1
     WHERE g.archived_at IS NULL
     GROUP BY g.id
     ORDER BY g.name ASC
     LIMIT $2`,
    [PUBLIC_MOVIE_STATUS, LIST_CAP],
  );
  return result.rows;
}

export async function findGenreBySlug(slug) {
  const result = await catalogQuery(
    'SELECT id, slug, name FROM genres WHERE slug = $1 AND archived_at IS NULL',
    [slug],
  );
  return result.rows[0] || null;
}

export async function listGenresForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT g.slug, g.name
     FROM movie_genres mg
     JOIN genres g ON g.id = mg.genre_id
     WHERE mg.movie_id = $1 AND g.archived_at IS NULL
     ORDER BY g.slug ASC`,
    [movieId],
  );
  return result.rows;
}

export async function listLanguagesForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT l.code, l.name
     FROM movie_languages ml
     JOIN languages l ON l.id = ml.language_id
     WHERE ml.movie_id = $1
     ORDER BY l.code ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({ code: row.code, name: row.name }));
}

export async function listCountriesForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT c.code, c.name, c.slug, c.display_name
     FROM movie_countries mc
     JOIN countries c ON c.id = mc.country_id
     WHERE mc.movie_id = $1 AND c.active = TRUE
     ORDER BY c.display_name ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    slug: row.slug,
    displayName: row.display_name,
  }));
}

export async function listVerifiedSynopses(movieId) {
  const result = await catalogQuery(
    `SELECT s.synopsis, l.code, l.name
     FROM movie_synopses s
     JOIN languages l ON l.id = s.language_id
     WHERE s.movie_id = $1 AND s.status = 'verified'
     ORDER BY l.name ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    text: row.synopsis,
    language: { code: row.code, name: row.name },
    status: 'verified',
  }));
}

export async function listTagsForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT t.slug, t.name
     FROM movie_tags mt
     JOIN tags t ON t.id = mt.tag_id
     WHERE mt.movie_id = $1
     ORDER BY t.slug ASC`,
    [movieId],
  );
  return result.rows;
}

export async function listAlternateTitles(movieId) {
  const result = await catalogQuery(
    `SELECT alt.title, alt.status, l.code AS language_code, l.name AS language_name,
            c.code AS country_code, c.name AS country_name
     FROM alternate_titles alt
     LEFT JOIN languages l ON l.id = alt.language_id
     LEFT JOIN countries c ON c.id = alt.country_id
     WHERE alt.movie_id = $1 AND alt.status = 'verified'
     ORDER BY alt.title ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    title: row.title,
    status: row.status,
    language: row.language_code ? { code: row.language_code, name: row.language_name } : null,
    country: row.country_code ? { code: row.country_code, name: row.country_name } : null,
  }));
}
