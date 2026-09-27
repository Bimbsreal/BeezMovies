import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { classifyMedia } from '../media/availability.js';
import { resolveMovieDownload } from '../media/resolution.js';
import { catalogQuery } from './db.js';
import { listCountriesForMovie, listGenresForMovie, listLanguagesForMovie } from './repositories/genres.js';
import { listCreditsForMovie } from './repositories/people.js';
import { industryLabelsForMovie } from './industries.js';
import { pagination } from './serializers.js';

const EPISODE_LIMIT = 24;

function notFound(message) {
  return new AppError(message, { status: 404, code: 'NOT_FOUND' });
}

function publicThumbnail(url) {
  if (typeof url !== 'string' || !url.startsWith('https://')) return null;
  if (url.toLowerCase().includes('.svg')) return null;
  return url;
}

async function seriesRow(slug) {
  const result = await catalogQuery(
    `SELECT m.id, m.slug, m.canonical_title, m.original_title, m.synopsis, m.tagline,
            m.release_year, m.runtime_minutes, m.status, m.popularity,
            l.code AS original_language_code, l.name AS original_language_name,
            ct.code AS content_type_code, ct.name AS content_type_name,
            (
              SELECT jsonb_build_object('url', mi.url, 'width', mi.width, 'height', mi.height)
              FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'backdrop'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS backdrop_url
     FROM movies m
     JOIN content_types ct ON ct.id = m.content_type_id AND ct.code = 'series' AND ct.active = TRUE
     LEFT JOIN languages l ON l.id = m.original_language_id
     WHERE m.slug = $1 AND m.status = 'active' AND m.archived_at IS NULL`,
    [slug],
  );
  return result.rows[0] || null;
}

async function episodeSignals(episodeId) {
  const result = await catalogQuery(
    `SELECT mr.media_type, mr.status, mr.availability_status, mr.rights_status, mr.metadata,
            p.status AS provider_status, COALESCE(h.status, 'unknown') AS health
     FROM media_references mr
     JOIN providers p ON p.id = mr.provider_id
     LEFT JOIN provider_health h ON h.provider_id = p.id
     WHERE mr.episode_id = $1 AND p.archived_at IS NULL`,
    [episodeId],
  );
  return result.rows.map((row) => ({
    mediaType: row.media_type,
    status: row.status,
    availability: row.availability_status,
    rights: row.rights_status,
    providerStatus: row.provider_status,
    health: row.health,
    metadata: row.metadata,
  }));
}

function episodeCard(row, seriesSlug, seasonNumber, mediaState) {
  return {
    number: row.episode_number,
    title: row.title,
    slug: row.slug,
    synopsis: row.synopsis,
    runtimeMinutes: row.runtime_minutes,
    releaseDate: row.release_date ? String(row.release_date).slice(0, 10) : null,
    thumbnailUrl: publicThumbnail(row.thumbnail_url),
    mediaState,
    href: `/show/${seriesSlug}/season/${seasonNumber}/episode/${row.episode_number}`,
  };
}

async function mediaForEpisodes(ids) {
  const states = new Map();
  if (!ids.length) return states;
  const result = await catalogQuery(
    `SELECT mr.episode_id, mr.media_type, mr.status, mr.availability_status, mr.rights_status, mr.metadata,
            p.status AS provider_status, COALESCE(h.status, 'unknown') AS health
     FROM media_references mr
     JOIN providers p ON p.id = mr.provider_id
     LEFT JOIN provider_health h ON h.provider_id = p.id
     WHERE mr.episode_id = ANY($1::uuid[]) AND p.archived_at IS NULL`,
    [ids],
  );
  const grouped = new Map();
  for (const row of result.rows) {
    const list = grouped.get(row.episode_id) || [];
    list.push({
      mediaType: row.media_type,
      status: row.status,
      availability: row.availability_status,
      rights: row.rights_status,
      providerStatus: row.provider_status,
      health: row.health,
      metadata: row.metadata,
    });
    grouped.set(row.episode_id, list);
  }
  for (const id of ids) states.set(id, classifyMedia(grouped.get(id) || []));
  return states;
}

export async function getSeries(slug) {
  const series = await seriesRow(slug);
  if (!series) throw notFound('Series not found');
  const [genres, languages, countries, credits, labels, seasons, related] = await Promise.all([
    listGenresForMovie(series.id),
    listLanguagesForMovie(series.id),
    listCountriesForMovie(series.id),
    listCreditsForMovie(series.id),
    industryLabelsForMovie(series.id),
    catalogQuery(
      `SELECT s.season_number, s.title,
              COUNT(e.id) FILTER (WHERE e.status = 'active')::int AS episode_count
       FROM seasons s
       LEFT JOIN episodes e ON e.season_id = s.id
       WHERE s.series_id = $1 AND s.status = 'active'
       GROUP BY s.id
       ORDER BY s.season_number ASC`,
      [series.id],
    ),
    relatedSeries(series.id),
  ]);
  return {
    slug: series.slug,
    title: series.canonical_title,
    originalTitle: series.original_title,
    synopsis: series.synopsis,
    tagline: series.tagline,
    releaseYear: series.release_year,
    runtimeMinutes: series.runtime_minutes,
    popularity: series.popularity == null ? null : Number(series.popularity),
    contentType: { code: 'series', name: 'Series' },
    originalLanguage: series.original_language_code
      ? { code: series.original_language_code, name: series.original_language_name }
      : null,
    poster: series.poster?.url ? series.poster : null,
    backdropUrl: publicThumbnail(series.backdrop_url),
    genres,
    languages,
    countries,
    credits: credits.map((row) => ({
      name: row.person_name,
      department: row.department,
      job: row.job,
      characterName: row.character_name,
    })),
    industryLabels: labels,
    seasons: seasons.rows.map((row) => ({
      number: row.season_number,
      title: row.title || `Season ${row.season_number}`,
      episodeCount: row.episode_count,
      href: `/show/${series.slug}/season/${row.season_number}`,
    })),
    related,
  };
}

async function relatedSeries(seriesId) {
  const result = await catalogQuery(
    `SELECT m.slug, m.canonical_title, m.release_year, m.synopsis,
            ct.code AS content_type_code, ct.name AS content_type_name
     FROM movies m
     JOIN content_types ct ON ct.id = m.content_type_id AND ct.code = 'series'
     WHERE m.status = 'active'
       AND m.id <> $1
       AND (
         EXISTS (
           SELECT 1 FROM movie_genres mg
           JOIN movie_genres mine ON mine.genre_id = mg.genre_id AND mine.movie_id = $1
           WHERE mg.movie_id = m.id
         )
         OR EXISTS (
           SELECT 1 FROM movie_countries mc
           JOIN movie_countries mine ON mine.country_id = mc.country_id AND mine.movie_id = $1
           WHERE mc.movie_id = m.id
         )
       )
     ORDER BY COALESCE(m.popularity, 0) DESC, m.slug ASC
     LIMIT 8`,
    [seriesId],
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    title: row.canonical_title,
    releaseYear: row.release_year,
    synopsis: row.synopsis,
    contentType: { code: row.content_type_code, name: row.content_type_name },
    href: `/show/${row.slug}`,
  }));
}

export async function getSeason(slug, seasonNumber, query) {
  const series = await seriesRow(slug);
  if (!series) throw notFound('Series not found');
  const season = await catalogQuery(
    `SELECT id, season_number, title, synopsis
     FROM seasons
     WHERE series_id = $1 AND season_number = $2 AND status = 'active'`,
    [series.id, seasonNumber],
  );
  if (!season.rowCount) throw notFound('Season not found');
  const page = query.page || 1;
  const limit = Math.min(query.limit || EPISODE_LIMIT, 48);
  const offset = (page - 1) * limit;
  const count = await catalogQuery(
    `SELECT COUNT(*)::int AS total FROM episodes WHERE season_id = $1 AND status = 'active'`,
    [season.rows[0].id],
  );
  const rows = await catalogQuery(
    `SELECT id, episode_number, title, slug, synopsis, runtime_minutes, release_date::text AS release_date, thumbnail_url
     FROM episodes
     WHERE season_id = $1 AND status = 'active'
     ORDER BY episode_number ASC
     LIMIT $2 OFFSET $3`,
    [season.rows[0].id, limit, offset],
  );
  const media = await mediaForEpisodes(rows.rows.map((row) => row.id));
  return {
    series: { slug: series.slug, title: series.canonical_title, contentType: { code: 'series', name: 'Series' } },
    season: {
      number: season.rows[0].season_number,
      title: season.rows[0].title || `Season ${season.rows[0].season_number}`,
      synopsis: season.rows[0].synopsis,
    },
    data: rows.rows.map((row) => episodeCard(row, series.slug, season.rows[0].season_number, media.get(row.id))),
    pagination: pagination(page, limit, count.rows[0].total),
  };
}

async function neighbor(seasonId, episodeNumber, direction, seriesSlug, seasonNumber) {
  const comparison = direction === 'next' ? '>' : '<';
  const order = direction === 'next' ? 'ASC' : 'DESC';
  const result = await catalogQuery(
    `SELECT episode_number, title
     FROM episodes
     WHERE season_id = $1 AND status = 'active' AND episode_number ${comparison} $2
     ORDER BY episode_number ${order}
     LIMIT 1`,
    [seasonId, episodeNumber],
  );
  if (!result.rowCount) return null;
  const row = result.rows[0];
  return {
    number: row.episode_number,
    title: row.title,
    href: `/show/${seriesSlug}/season/${seasonNumber}/episode/${row.episode_number}`,
  };
}

export async function getEpisode(slug, seasonNumber, episodeNumber) {
  const series = await seriesRow(slug);
  if (!series) throw notFound('Series not found');
  const found = await catalogQuery(
    `SELECT e.id, e.episode_number, e.title, e.slug, e.synopsis, e.runtime_minutes,
            e.release_date::text AS release_date, e.thumbnail_url, e.season_id,
            s.season_number, s.title AS season_title
     FROM episodes e
     JOIN seasons s ON s.id = e.season_id
     WHERE s.series_id = $1 AND s.season_number = $2 AND s.status = 'active'
       AND e.episode_number = $3 AND e.status = 'active'`,
    [series.id, seasonNumber, episodeNumber],
  );
  if (!found.rowCount) throw notFound('Episode not found');
  const row = found.rows[0];
  const [signals, previous, next] = await Promise.all([
    episodeSignals(row.id),
    neighbor(row.season_id, row.episode_number, 'previous', series.slug, row.season_number),
    neighbor(row.season_id, row.episode_number, 'next', series.slug, row.season_number),
  ]);
  return {
    series: {
      slug: series.slug,
      title: series.canonical_title,
      href: `/show/${series.slug}`,
      contentType: { code: 'series', name: 'Series' },
    },
    season: {
      number: row.season_number,
      title: row.season_title || `Season ${row.season_number}`,
      href: `/show/${series.slug}/season/${row.season_number}`,
    },
    episode: {
      number: row.episode_number,
      title: row.title,
      synopsis: row.synopsis,
      runtimeMinutes: row.runtime_minutes,
      releaseDate: row.release_date,
      thumbnailUrl: publicThumbnail(row.thumbnail_url),
      mediaState: classifyMedia(signals),
    },
    previous,
    next,
  };
}

export async function downloadEpisode(slug, seasonNumber, episodeNumber) {
  const episode = await getEpisode(slug, seasonNumber, episodeNumber);
  if (episode.episode.mediaState.state !== 'MEDIA_AVAILABLE') {
    throw new AppError('Download unavailable', {
      status: 409,
      code: episode.episode.mediaState.state || 'MEDIA_UNAVAILABLE',
    });
  }
  const row = await catalogQuery(
    `SELECT e.id
     FROM episodes e
     JOIN seasons s ON s.id = e.season_id
     JOIN movies m ON m.id = s.series_id
     WHERE m.slug = $1 AND s.season_number = $2 AND e.episode_number = $3`,
    [slug, seasonNumber, episodeNumber],
  );
  return resolveMovieDownload(slug, { episodeId: row.rows[0].id });
}

export async function listEpisodeProgress(userId) {
  const result = await getPool().query(
    `SELECT e.episode_number, e.title, s.season_number, m.slug AS series_slug, m.canonical_title AS series_title,
            p.position_seconds, p.updated_at
     FROM episode_progress p
     JOIN episodes e ON e.id = p.episode_id AND e.status = 'active'
     JOIN seasons s ON s.id = e.season_id AND s.status = 'active'
     JOIN movies m ON m.id = s.series_id AND m.status = 'active'
     WHERE p.user_id = $1
     ORDER BY p.updated_at DESC
     LIMIT 12`,
    [userId],
  );
  return result.rows.map((row) => ({
    series: row.series_title,
    seriesSlug: row.series_slug,
    season: row.season_number,
    episode: row.episode_number,
    title: row.title,
    positionSeconds: row.position_seconds,
    href: `/show/${row.series_slug}/season/${row.season_number}/episode/${row.episode_number}`,
  }));
}

export async function saveEpisodeProgress(userId, episodeId, positionSeconds) {
  const episode = await getPool().query(
    `SELECT e.id
     FROM episodes e
     JOIN seasons s ON s.id = e.season_id AND s.status = 'active'
     JOIN movies m ON m.id = s.series_id AND m.status = 'active'
     WHERE e.id = $1 AND e.status = 'active'`,
    [episodeId],
  );
  if (!episode.rowCount) throw notFound('Episode not found');
  await getPool().query(
    `INSERT INTO episode_progress (user_id, episode_id, position_seconds)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, episode_id)
     DO UPDATE SET position_seconds = EXCLUDED.position_seconds, updated_at = NOW()`,
    [userId, episodeId, positionSeconds],
  );
  return { stored: true };
}

export async function importEpisodeBatch(client, seriesId, seasons) {
  const results = [];
  for (const season of seasons) {
    await client.query('SAVEPOINT episode_batch');
    try {
      const saved = await client.query(
        `INSERT INTO seasons (series_id, season_number, title, synopsis)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (series_id, season_number) DO UPDATE
           SET title = COALESCE(EXCLUDED.title, seasons.title),
               synopsis = COALESCE(EXCLUDED.synopsis, seasons.synopsis),
               updated_at = NOW()
         RETURNING id, season_number`,
        [seriesId, season.number, season.title || null, season.synopsis || null],
      );
      await client.query('RELEASE SAVEPOINT episode_batch');
      const seasonId = saved.rows[0].id;
      for (const episode of season.episodes || []) {
        await client.query('SAVEPOINT episode_batch');
        try {
          await client.query(
            `INSERT INTO episodes (
               season_id, episode_number, title, slug, synopsis, runtime_minutes, release_date, thumbnail_url, external_id
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (season_id, episode_number) DO UPDATE
               SET title = EXCLUDED.title,
                   synopsis = COALESCE(EXCLUDED.synopsis, episodes.synopsis),
                   updated_at = NOW()`,
            [
              seasonId,
              episode.number,
              episode.title,
              episode.slug,
              episode.synopsis || null,
              episode.runtimeMinutes || null,
              episode.releaseDate || null,
              publicThumbnail(episode.thumbnailUrl),
              episode.externalId || null,
            ],
          );
          await client.query('RELEASE SAVEPOINT episode_batch');
          results.push({ season: season.number, episode: episode.number, ok: true });
        } catch {
          await client.query('ROLLBACK TO SAVEPOINT episode_batch');
          results.push({ season: season.number, episode: episode.number, ok: false });
        }
      }
    } catch {
      await client.query('ROLLBACK TO SAVEPOINT episode_batch');
      results.push({ season: season.number, episode: null, ok: false });
    }
  }
  return results;
}

export async function adminSeriesBoard() {
  const result = await getPool().query(
    `SELECT m.slug, m.canonical_title AS title, m.original_title, m.status, m.release_year,
            l.name AS language,
            COALESCE(string_agg(DISTINCT c.display_name, ', ' ORDER BY c.display_name), '') AS countries,
            COUNT(DISTINCT s.id)::int AS seasons,
            COUNT(DISTINCT e.id)::int AS episodes,
            COUNT(DISTINCT mr.id) FILTER (
              WHERE mr.rights_status = 'AUTHORIZED' AND mr.availability_status = 'available' AND mr.media_type = 'download'
            )::int AS authorized_media
     FROM movies m
     JOIN content_types ct ON ct.id = m.content_type_id AND ct.code = 'series'
     LEFT JOIN languages l ON l.id = m.original_language_id
     LEFT JOIN movie_countries mc ON mc.movie_id = m.id
     LEFT JOIN countries c ON c.id = mc.country_id
     LEFT JOIN seasons s ON s.series_id = m.id
     LEFT JOIN episodes e ON e.season_id = s.id
     LEFT JOIN media_references mr ON mr.episode_id = e.id
     GROUP BY m.id, l.name
     ORDER BY m.canonical_title ASC
     LIMIT 50`,
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    title: row.title,
    originalTitle: row.original_title,
    status: row.status,
    releaseYear: row.release_year,
    language: row.language,
    countries: row.countries,
    seasons: row.seasons,
    episodes: row.episodes,
    authorizedMedia: row.authorized_media,
  }));
}

export async function searchEpisodeHits(q) {
  const term = String(q || '').trim();
  if (term.length < 2) return [];
  const like = `%${term.replace(/[%_\\]/g, '')}%`;
  const result = await catalogQuery(
    `SELECT kind, title, episode_number, season_number, season_title, series_slug, series_title
     FROM (
       SELECT 'episode' AS kind, e.title, e.episode_number, s.season_number, s.title AS season_title,
              m.slug AS series_slug, m.canonical_title AS series_title, e.episode_number AS sort_episode
       FROM episodes e
       JOIN seasons s ON s.id = e.season_id AND s.status = 'active'
       JOIN movies m ON m.id = s.series_id AND m.status = 'active' AND m.archived_at IS NULL
       JOIN content_types ct ON ct.id = m.content_type_id AND ct.code = 'series'
       WHERE e.status = 'active'
         AND (e.title ILIKE $1 OR m.canonical_title ILIKE $1)
       UNION ALL
       SELECT 'season' AS kind, COALESCE(s.title, 'Season ' || s.season_number::text), NULL::int, s.season_number, s.title,
              m.slug, m.canonical_title, 0
       FROM seasons s
       JOIN movies m ON m.id = s.series_id AND m.status = 'active' AND m.archived_at IS NULL
       JOIN content_types ct ON ct.id = m.content_type_id AND ct.code = 'series'
       WHERE s.status = 'active'
         AND (COALESCE(s.title, '') ILIKE $1 OR m.canonical_title ILIKE $1)
     ) hits
     ORDER BY CASE WHEN lower(series_title) = lower($2) THEN 0 ELSE 1 END,
              series_title, season_number, sort_episode
     LIMIT 8`,
    [like, term],
  );
  return result.rows.map((row) => ({
    kind: row.kind,
    title: row.title,
    series: row.series_title,
    seriesSlug: row.series_slug,
    season: row.season_number,
    episode: row.episode_number,
    href: row.kind === 'episode'
      ? `/show/${row.series_slug}/season/${row.season_number}/episode/${row.episode_number}`
      : `/show/${row.series_slug}/season/${row.season_number}`,
  }));
}

const numberParam = z.coerce.number().int().positive();
const emptyBody = z.object({}).strict().optional().default({});

export const seriesSlugSchema = z.object({
  body: emptyBody,
  params: z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict(),
  query: z.object({}).strict(),
});

export const seasonSchema = z.object({
  body: emptyBody,
  params: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    season: numberParam,
  }).strict(),
  query: z.object({
    page: z.coerce.number().int().min(1).max(100).default(1),
    limit: z.coerce.number().int().min(1).max(48).default(EPISODE_LIMIT),
  }).strict(),
});

export const episodeSchema = z.object({
  body: emptyBody,
  params: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    season: numberParam,
    episode: numberParam,
  }).strict(),
  query: z.object({}).strict(),
});

export const progressSchema = z.object({
  body: z.object({
    positionSeconds: z.number().int().min(0).max(86400),
    confirm: z.literal(true),
  }).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
  query: z.object({}).strict(),
});
