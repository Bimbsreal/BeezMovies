import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { invalidateCatalogCache } from './admin.js';
import { getMovieList } from './service.js';
import { upsertMovieDocuments } from '../search/indexer.js';

const uuid = z.string().uuid();
const status = z.enum(['verified', 'review', 'unavailable']);

export async function listLanguages() {
  const result = await getPool().query(
    `SELECT l.code, l.name, l.direction, l.ui_ready,
            (
              SELECT COUNT(DISTINCT m.id)::int
              FROM movies m
              WHERE m.status = 'active' AND m.archived_at IS NULL
                AND (
                  m.original_language_id = l.id
                  OR EXISTS (
                    SELECT 1 FROM movie_languages ml
                    WHERE ml.movie_id = m.id AND ml.language_id = l.id
                  )
                )
            ) AS movie_count
     FROM languages l
     ORDER BY l.name ASC`,
  );
  return result.rows.map((row) => ({
    code: row.code,
    name: row.name,
    direction: row.direction,
    uiReady: row.ui_ready,
    movieCount: row.movie_count,
  }));
}

export async function languageMovies(code, query) {
  const language = (await listLanguages()).find((item) => item.code === code);
  if (!language) throw new AppError('Language not found', { status: 404, code: 'NOT_FOUND' });
  const page = await getMovieList({ ...query, language: code, status: undefined }, null);
  return { language, ...page };
}

export async function localizationBoard() {
  const result = await getPool().query(
    `SELECT m.slug, m.canonical_title, m.original_title, m.synopsis,
            ol.code AS original_code, ol.name AS original_name,
            COALESCE(json_agg(DISTINCT lang.name) FILTER (WHERE lang.name IS NOT NULL), '[]'::json) AS languages,
            COALESCE(json_agg(DISTINCT jsonb_build_object(
              'id', alt.id, 'title', alt.title, 'status', alt.status, 'language', alang.name
            )) FILTER (WHERE alt.id IS NOT NULL), '[]'::json) AS titles,
            COUNT(DISTINCT syn.id) FILTER (WHERE syn.status = 'verified')::int AS verified_synopses,
            COUNT(DISTINCT syn.id) FILTER (WHERE syn.status = 'review')::int AS review_synopses
     FROM movies m
     LEFT JOIN languages ol ON ol.id = m.original_language_id
     LEFT JOIN movie_languages ml ON ml.movie_id = m.id
     LEFT JOIN languages lang ON lang.id = ml.language_id
     LEFT JOIN alternate_titles alt ON alt.movie_id = m.id
     LEFT JOIN languages alang ON alang.id = alt.language_id
     LEFT JOIN movie_synopses syn ON syn.movie_id = m.id
     WHERE m.archived_at IS NULL
     GROUP BY m.id, ol.code, ol.name
     ORDER BY m.canonical_title ASC
     LIMIT 100`,
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    title: row.canonical_title,
    originalTitle: row.original_title,
    originalLanguage: row.original_code ? { code: row.original_code, name: row.original_name } : null,
    languages: row.languages,
    titles: row.titles,
    synopsis: {
      source: row.synopsis ? 'verified' : 'unavailable',
      localized: row.verified_synopses > 0 ? 'verified' : (row.review_synopses > 0 ? 'review' : 'unavailable'),
    },
  }));
}

export async function setAlternateTitleStatus(id, next) {
  const result = await getPool().query(
    `UPDATE alternate_titles SET status = $2 WHERE id = $1
     RETURNING movie_id`,
    [id, next],
  );
  if (!result.rowCount) throw new AppError('Title not found', { status: 404, code: 'NOT_FOUND' });
  const movie = await getPool().query('SELECT slug FROM movies WHERE id = $1', [result.rows[0].movie_id]);
  await getPool().query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     SELECT 'movie.catalog.updated', m.id, m.slug FROM movies m WHERE m.id = $1`,
    [result.rows[0].movie_id],
  );
  await upsertMovieDocuments([result.rows[0].movie_id]);
  await invalidateCatalogCache({ slug: movie.rows[0]?.slug });
  return { id, status: next };
}

export const titleStatusSchema = z.object({
  body: z.object({ status, confirm: z.literal(true) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const languageCodeSchema = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/);
