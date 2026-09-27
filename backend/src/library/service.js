import { relatedForSlug } from '../discovery/related.js';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { listEpisodeProgress } from '../catalog/episodes.js';
import { AppError } from '../errors/app-error.js';
import { recordAnalytics } from '../analytics/record.js';
import { withTransaction } from '../db/transaction.js';

const RECENT_LIMIT = 20;
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const librarySlugSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({ slug }).strict(),
});

export const preferencesSchema = z.object({
  body: z.object({
    genreSlugs: z.array(slug).max(8),
    countrySlugs: z.array(slug).max(8).optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const libraryListSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({
    page: z.coerce.number().int().min(1).max(100).optional(),
    limit: z.coerce.number().int().min(1).max(48).optional(),
  }).strict(),
  params: z.object({}).strict(),
});

function card(row) {
  return {
    slug: row.slug,
    title: row.canonical_title,
    releaseYear: row.release_year,
    synopsis: row.synopsis,
    poster: row.poster_url ? { url: row.poster_url } : null,
  };
}

async function publishedMovie(client, movieSlug) {
  const result = await client.query(
    `SELECT id FROM movies WHERE slug = $1 AND status = 'active'`,
    [movieSlug],
  );
  if (!result.rowCount) throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
  return result.rows[0].id;
}

async function listMembership(userId, table, orderColumn, { page = 1, limit = 24 } = {}) {
  const offset = (page - 1) * limit;
  const counted = await getPool().query(
    `SELECT COUNT(*)::int AS total
     FROM ${table} entry
     JOIN movies m ON m.id = entry.movie_id
     WHERE entry.user_id = $1 AND m.status = 'active'`,
    [userId],
  );
  const result = await getPool().query(
    `SELECT m.slug, m.canonical_title, m.release_year, m.synopsis,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster_url
     FROM ${table} entry
     JOIN movies m ON m.id = entry.movie_id
     WHERE entry.user_id = $1 AND m.status = 'active'
     ORDER BY entry.${orderColumn} DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset],
  );
  const total = counted.rows[0]?.total || 0;
  return {
    items: result.rows.map(card),
    pagination: {
      page,
      limit,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / limit),
    },
  };
}

const TABLES = {
  watchlist: { name: 'user_watchlist', order: 'created_at' },
  favorites: { name: 'user_favorites', order: 'created_at' },
  recent: { name: 'user_recent_views', order: 'viewed_at' },
};

function tableFor(kind) {
  const table = TABLES[kind];
  if (!table) throw new AppError('Unknown library', { status: 400, code: 'VALIDATION_ERROR' });
  return table;
}

export function listLibrary(userId, kind, query = {}) {
  const table = tableFor(kind);
  const page = query.page || 1;
  const limit = query.limit || 24;
  return listMembership(userId, table.name, table.order, { page, limit });
}

export async function watchProgress(userId) {
  const episodes = userId ? await listEpisodeProgress(userId) : [];
  return {
    stored: false,
    items: [],
    note: episodes.length
      ? 'Movie playback position is not stored. Episode resume points are saved only for this account.'
      : 'Playback position is not stored.',
    episodes,
  };
}

export async function addLibrary(userId, kind, movieSlug) {
  const table = tableFor(kind);
  return withTransaction(async (client) => {
    const movieId = await publishedMovie(client, movieSlug);
    const inserted = await client.query(
      `INSERT INTO ${table.name} (user_id, movie_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, movie_id) DO NOTHING
       RETURNING user_id`,
      [userId, movieId],
    );
    if (kind === 'recent') {
      await client.query(
        `UPDATE user_recent_views SET viewed_at = NOW()
         WHERE user_id = $1 AND movie_id = $2`,
        [userId, movieId],
      );
      await client.query(
        `DELETE FROM user_recent_views recent
         USING (
           SELECT movie_id
           FROM user_recent_views
           WHERE user_id = $1
           ORDER BY viewed_at DESC
           OFFSET $2
         ) extra
         WHERE recent.user_id = $1 AND recent.movie_id = extra.movie_id`,
        [userId, RECENT_LIMIT],
      );
    }
    if (inserted.rowCount > 0 && (kind === 'watchlist' || kind === 'favorites')) {
      recordAnalytics({
        name: kind === 'watchlist' ? 'WATCHLIST_ADD' : 'FAVORITE_ADD',
        subject: movieSlug,
        outcome: 'success',
      });
    }
    return { slug: movieSlug, created: inserted.rowCount > 0 };
  });
}

export async function removeLibrary(userId, kind, movieSlug) {
  const table = tableFor(kind);
  const result = await getPool().query(
    `DELETE FROM ${table.name} entry
     USING movies m
     WHERE entry.movie_id = m.id AND entry.user_id = $1 AND m.slug = $2`,
    [userId, movieSlug],
  );
  if (!result.rowCount) throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
  return { slug: movieSlug, removed: true };
}

export async function clearRecent(userId) {
  await getPool().query('DELETE FROM user_recent_views WHERE user_id = $1', [userId]);
  return { cleared: true };
}

export async function readPreferences(userId) {
  const result = await getPool().query(
    'SELECT preferred_genres, preferred_countries FROM user_preferences WHERE user_id = $1',
    [userId],
  );
  return {
    genreSlugs: result.rows[0]?.preferred_genres || [],
    countrySlugs: result.rows[0]?.preferred_countries || [],
  };
}

export async function savePreferences(userId, genreSlugs, countrySlugs) {
  const genres = [...new Set(genreSlugs)];
  const known = await getPool().query(
    `SELECT slug FROM genres WHERE slug = ANY($1::text[]) AND archived_at IS NULL`,
    [genres],
  );
  if (known.rowCount !== genres.length) {
    throw new AppError('Choose genres from the catalog', { status: 400, code: 'VALIDATION_ERROR' });
  }
  let countries = null;
  if (countrySlugs) {
    countries = [...new Set(countrySlugs)];
    const knownCountries = await getPool().query(
      `SELECT slug FROM countries WHERE slug = ANY($1::text[]) AND active = TRUE`,
      [countries],
    );
    if (knownCountries.rowCount !== countries.length) {
      throw new AppError('Choose countries from the catalog', { status: 400, code: 'VALIDATION_ERROR' });
    }
  }
  await getPool().query(
    `INSERT INTO user_preferences (user_id, preferred_genres, preferred_countries)
     VALUES ($1, $2::text[], COALESCE($3::text[], '{}'::text[]))
     ON CONFLICT (user_id) DO UPDATE SET
       preferred_genres = EXCLUDED.preferred_genres,
       preferred_countries = COALESCE($3::text[], user_preferences.preferred_countries)`,
    [userId, genres, countries],
  );
  return readPreferences(userId);
}

export async function preferredCountryMovies(userId) {
  const saved = await readPreferences(userId);
  if (!saved.countrySlugs.length) return null;
  const movies = await getPool().query(
    `SELECT DISTINCT m.slug, m.canonical_title, m.release_year, m.synopsis, m.popularity,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster_url
     FROM movies m
     JOIN movie_countries mc ON mc.movie_id = m.id
     JOIN countries c ON c.id = mc.country_id AND c.active = TRUE
     WHERE m.status = 'active'
       AND c.slug = ANY($2::text[])
       AND NOT EXISTS (
         SELECT 1 FROM user_watchlist w WHERE w.user_id = $1 AND w.movie_id = m.id
       )
     ORDER BY m.popularity DESC NULLS LAST, m.slug ASC
     LIMIT 12`,
    [userId, saved.countrySlugs],
  );
  if (!movies.rowCount) return null;
  return {
    title: 'Movies from countries you saved',
    movies: movies.rows.map(card),
  };
}

export async function becauseYouLike(userId) {
  const signal = await getPool().query(
    `SELECT g.slug, g.name, COUNT(*)::int AS weight
     FROM (
       SELECT movie_id FROM user_favorites WHERE user_id = $1
       UNION ALL
       SELECT movie_id FROM user_watchlist WHERE user_id = $1
       UNION ALL
       SELECT movie_id FROM user_recent_views WHERE user_id = $1
       UNION ALL
       SELECT mg.movie_id
       FROM user_preferences pref
       JOIN genres g2 ON g2.slug = ANY(pref.preferred_genres)
       JOIN movie_genres mg ON mg.genre_id = g2.id
       WHERE pref.user_id = $1
     ) picked
     JOIN movie_genres mg ON mg.movie_id = picked.movie_id
     JOIN genres g ON g.id = mg.genre_id AND g.archived_at IS NULL
     GROUP BY g.slug, g.name
     ORDER BY weight DESC, g.name ASC
     LIMIT 1`,
    [userId],
  );
  if (!signal.rowCount) return null;
  const genre = signal.rows[0];
  const movies = await getPool().query(
    `SELECT m.slug, m.canonical_title, m.release_year, m.synopsis,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster_url
     FROM movies m
     JOIN movie_genres mg ON mg.movie_id = m.id
     JOIN genres g ON g.id = mg.genre_id AND g.slug = $2
     WHERE m.status = 'active'
       AND NOT EXISTS (
         SELECT 1 FROM user_watchlist w WHERE w.user_id = $1 AND w.movie_id = m.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM user_favorites f WHERE f.user_id = $1 AND f.movie_id = m.id
       )
       AND NOT EXISTS (
         SELECT 1 FROM user_recent_views r WHERE r.user_id = $1 AND r.movie_id = m.id
       )
     ORDER BY COALESCE(m.popularity, 0) DESC, m.slug ASC
     LIMIT 12`,
    [userId, genre.slug],
  );
  if (!movies.rowCount) return null;
  return {
    genre: { slug: genre.slug, name: genre.name },
    movies: movies.rows.map(card),
  };
}

export async function becauseYouViewed(userId) {
  const result = await getPool().query(
    `SELECT m.slug, m.canonical_title
     FROM user_recent_views viewed
     JOIN movies m ON m.id = viewed.movie_id
     WHERE viewed.user_id = $1 AND m.status = 'active'
     ORDER BY viewed.viewed_at DESC
     LIMIT 1`,
    [userId],
  );
  if (!result.rowCount) return null;
  const anchor = result.rows[0];
  const related = await relatedForSlug(anchor.slug);
  const movies = related.data?.[0]?.items || [];
  if (!movies.length) return null;
  return {
    title: `Because you viewed ${anchor.canonical_title}`,
    movies,
  };
}

export async function eraseLibrary(client, userId) {
  await client.query('DELETE FROM user_watchlist WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM user_favorites WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM user_recent_views WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
  await client.query('DELETE FROM episode_progress WHERE user_id = $1', [userId]);
}
