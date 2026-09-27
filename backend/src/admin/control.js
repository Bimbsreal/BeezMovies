import { z } from 'zod';
import { config } from '../config/index.js';
import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { AppError } from '../errors/app-error.js';
import { invalidateCatalogCache } from '../catalog/admin.js';
import { getMediaAdapter } from '../media/registry.js';
import { recordProviderHealth } from '../media/repository.js';
import { getRedisStatus } from '../redis/client.js';
import { release } from '../release.js';
import { operationalSnapshot, pwaAssetReport } from '../ops/status.js';
import { maintenanceState, flagEnabled } from '../ops/flags.js';
import { enqueueReindex, upsertMovieDocuments } from '../search/indexer.js';
import { listAudit, recordAudit } from './audit.js';
import { recordAnalytics } from '../analytics/record.js';

const MANUAL_SOURCE_ID = '99999999-9999-4999-8999-999999999901';
const uuid = z.string().uuid();
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const slug = z.string().regex(SLUG_PATTERN);
const confirm = z.literal(true);

export const movieListSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({
    q: z.string().trim().max(80).optional(),
    status: z.enum(['draft', 'review', 'approved', 'active', 'archived']).optional(),
    sort: z.enum(['title', 'release_year', 'created_at', 'updated_at', 'status']).optional(),
    direction: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).max(10000).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }).strict(),
});

export const movieIdSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const moviePatchSchema = z.object({
  body: z.object({
    canonicalTitle: z.string().trim().min(1).max(300).optional(),
    originalTitle: z.string().trim().max(300).nullable().optional(),
    synopsis: z.string().trim().max(5000).nullable().optional(),
    tagline: z.string().trim().max(300).nullable().optional(),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    runtimeMinutes: z.number().int().positive().max(1000).nullable().optional(),
    languageCode: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/).nullable().optional(),
    genreSlugs: z.array(slug).max(12).optional(),
    countryCodes: z.array(z.string().regex(/^[A-Z]{2}$/)).max(12).optional(),
    alternateTitles: z.array(z.string().trim().min(1).max(300)).max(12).optional(),
    collectionId: uuid.nullable().optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const confirmSchema = z.object({
  body: z.object({ confirm }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const movieCreateSchema = z.object({
  body: z.object({
    canonicalTitle: z.string().trim().min(1).max(300),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const genreMergeSchema = z.object({
  body: z.object({
    targetId: uuid,
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const bulkSchema = z.object({
  body: z.object({
    action: z.enum(['publish', 'unpublish', 'archive', 'reindex', 'assignGenre', 'assignCountry', 'assignCollection']),
    ids: z.array(uuid).min(1).max(100),
    genreSlug: slug.optional(),
    countryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
    collectionId: uuid.optional(),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

const named = z.object({
  name: z.string().trim().min(1).max(80),
  slug: slug.optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export const genreCreateSchema = z.object({
  body: named.pick({ name: true, slug: true }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const genrePatchSchema = z.object({
  body: z.object({ name: z.string().trim().min(1).max(80) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const collectionCreateSchema = z.object({
  body: named.strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const collectionPatchSchema = z.object({
  body: z.object({
    name: z.string().trim().min(1).max(80).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const collectionOrderSchema = z.object({
  body: z.object({ movieIds: z.array(uuid).max(100) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const userStatusSchema = z.object({
  body: z.object({
    accountStatus: z.enum(['active', 'suspended']),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const userRolesSchema = z.object({
  body: z.object({
    roles: z.array(z.enum(['user', 'admin', 'super_admin', 'content_admin', 'moderator'])).min(1).max(4),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const settingsSchema = z.object({
  body: z.object({
    opsNote: z.string().trim().max(280),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const batchReindexSchema = z.object({
  body: z.object({ ids: z.array(uuid).min(1).max(50), confirm }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const fullReindexSchema = z.object({
  body: z.object({ confirm }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

const SORTS = {
  title: 'm.canonical_title',
  release_year: 'm.release_year',
  created_at: 'm.created_at',
  updated_at: 'm.updated_at',
  status: 'm.status',
};

function notFound(message) {
  return new AppError(message, { status: 404, code: 'NOT_FOUND' });
}

function slugify(value) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function likeTerm(value) {
  if (!value) return null;
  return `%${value.replace(/[\\%_]/g, '')}%`;
}

async function curate(client, movieId, field) {
  await client.query(
    `INSERT INTO catalog_field_provenance (
       movie_id, field_name, catalog_source_id, source_updated_at, transformation_version, origin
     ) VALUES ($1, $2, $3, NOW(), 'catalog-normalize-v1', 'manual')
     ON CONFLICT (movie_id, field_name) DO UPDATE SET
       catalog_source_id = EXCLUDED.catalog_source_id,
       source_updated_at = NOW(),
       transformation_version = EXCLUDED.transformation_version,
       origin = 'manual',
       ingested_at = NOW()`,
    [movieId, field, MANUAL_SOURCE_ID],
  );
}

export async function dashboard() {
  const rows = await getPool().query(
    `SELECT
       (SELECT COUNT(*)::int FROM movies) AS movies_total,
       (SELECT COUNT(*)::int FROM movies WHERE status = 'active') AS movies_published,
       (SELECT COUNT(*)::int FROM movies WHERE status = 'draft') AS movies_draft,
       (SELECT COUNT(*)::int FROM movies WHERE created_at > NOW() - INTERVAL '30 days') AS movies_recent,
       (SELECT COUNT(*)::int FROM movies WHERE updated_at > NOW() - INTERVAL '7 days') AS movies_updated,
       (SELECT COUNT(*)::int FROM movies WHERE status = 'archived') AS movies_archived,
       (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL) AS users_total,
       (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND account_status = 'active') AS users_active,
       (SELECT COUNT(*)::int FROM users WHERE deleted_at IS NULL AND account_status = 'suspended') AS users_suspended,
       (SELECT COUNT(*)::int FROM provider_health WHERE status IN ('unavailable', 'degraded')) AS media_failed,
       (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'pending') AS jobs_pending,
       (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'processing') AS jobs_processing,
       (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'completed') AS jobs_completed,
       (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'failed') AS jobs_failed,
       (SELECT COUNT(*)::int FROM ingestion_jobs WHERE status = 'dead_letter') AS jobs_dead,
       (SELECT COUNT(*)::int FROM media_references WHERE status = 'available') AS media_active,
       (SELECT COUNT(*)::int FROM media_references WHERE status = 'unavailable') AS media_unavailable,
       (SELECT COUNT(*)::int FROM provider_health WHERE status = 'available') AS providers_available,
       (SELECT COUNT(*)::int FROM search_documents d
         JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
         WHERE d.status = 'active') AS indexed_movies,
       (SELECT COUNT(*)::int FROM search_index_events WHERE consumed_at IS NULL) AS index_pending,
       (SELECT COUNT(*)::int FROM search_index_events WHERE last_error_code IS NOT NULL AND consumed_at IS NOT NULL) AS index_failed`,
  );
  const row = rows.rows[0];
  const database = await getPool().query('SELECT 1 AS ok');
  const databaseState = database.rows[0]?.ok === 1 ? 'ok' : 'unavailable';
  const snapshot = await operationalSnapshot(databaseState);
  const level = (group, name) => snapshot.checks.find((item) => item.group === group && item.name === name)?.status || 'NOT CONFIGURED';
  return {
    catalog: {
      totalMovies: row.movies_total,
      published: row.movies_published,
      draft: row.movies_draft,
      archived: row.movies_archived,
      recentlyAdded: row.movies_recent,
      recentlyUpdated: row.movies_updated,
    },
    ingestion: {
      pending: row.jobs_pending,
      queued: row.jobs_pending,
      processing: row.jobs_processing,
      running: row.jobs_processing,
      completed: row.jobs_completed,
      successful: row.jobs_completed,
      failed: row.jobs_failed,
      deadLetter: row.jobs_dead,
    },
    media: {
      available: row.media_active,
      unavailable: row.media_unavailable,
      failedChecks: row.media_failed,
      activeReferences: row.media_active,
      unavailableReferences: row.media_unavailable,
      providersAvailable: row.providers_available,
    },
    search: {
      indexed: row.indexed_movies,
      pending: row.index_pending,
      failed: row.index_failed,
      indexedMovies: row.indexed_movies,
      pendingUpdates: row.index_pending,
      failedUpdates: row.index_failed,
    },
    users: {
      total: row.users_total,
      active: row.users_active,
      suspended: row.users_suspended,
    },
    system: {
      api: level('System', 'API'),
      database: level('System', 'Database'),
      workers: level('Workers', 'Worker'),
      cache: level('System', 'Cache'),
      queue: level('Workers', 'Ingestion'),
      worker: row.jobs_processing > 0 ? 'processing' : 'idle',
      cacheConnection: getRedisStatus(),
    },
  };
}

export async function listMovies(query) {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  const sort = SORTS[query.sort || 'updated_at'];
  const direction = query.direction === 'asc' ? 'ASC' : 'DESC';
  const params = [query.status ?? null, likeTerm(query.q)];
  const where = `WHERE ($1::text IS NULL OR m.status = $1)
    AND ($2::text IS NULL OR m.canonical_title ILIKE $2 OR m.slug ILIKE $2)`;
  const total = await getPool().query(`SELECT COUNT(*)::int AS count FROM movies m ${where}`, params);
  const rows = await getPool().query(
    `SELECT m.id, m.canonical_title, m.release_year, m.status, m.created_at, m.updated_at,
            COALESCE(array_agg(DISTINCT g.name) FILTER (WHERE g.id IS NOT NULL), ARRAY[]::text[]) AS genres
     FROM movies m
     LEFT JOIN movie_genres mg ON mg.movie_id = m.id
     LEFT JOIN genres g ON g.id = mg.genre_id
     ${where}
     GROUP BY m.id
     ORDER BY ${sort} ${direction} NULLS LAST, m.canonical_title ASC
     LIMIT $3 OFFSET $4`,
    [...params, limit, (page - 1) * limit],
  );
  return {
    data: rows.rows.map((row) => ({
      id: row.id,
      title: row.canonical_title,
      releaseYear: row.release_year,
      status: row.status,
      published: row.status === 'active',
      genres: row.genres,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    pagination: { page, limit, total: total.rows[0].count },
  };
}

export async function getMovie(id) {
  const movie = await getPool().query(
    `SELECT m.id, m.canonical_title, m.original_title, m.slug, m.synopsis, m.tagline,
            m.release_date::text AS release_date, m.runtime_minutes, m.status,
            l.code AS language_code, m.created_at, m.updated_at
     FROM movies m
     LEFT JOIN languages l ON l.id = m.original_language_id
     WHERE m.id = $1`,
    [id],
  );
  if (!movie.rowCount) throw notFound('Movie not found');
  const [genres, countries, titles, collection, images, videos, curated, identifiers, credits, media] = await Promise.all([
    getPool().query('SELECT g.slug FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = $1 ORDER BY g.slug', [id]),
    getPool().query('SELECT c.code FROM movie_countries mc JOIN countries c ON c.id = mc.country_id WHERE mc.movie_id = $1 ORDER BY c.code', [id]),
    getPool().query('SELECT title FROM alternate_titles WHERE movie_id = $1 ORDER BY title', [id]),
    getPool().query('SELECT collection_id, sort_order FROM collection_movies WHERE movie_id = $1', [id]),
    getPool().query('SELECT id, image_type, url, width, height FROM movie_images WHERE movie_id = $1 ORDER BY priority, created_at', [id]),
    getPool().query('SELECT id, video_type, url FROM movie_videos WHERE movie_id = $1 ORDER BY priority, created_at', [id]),
    getPool().query(
      `SELECT p.field_name, p.origin, s.name AS source_name
       FROM catalog_field_provenance p
       LEFT JOIN catalog_sources s ON s.id = p.catalog_source_id
       WHERE p.movie_id = $1
       ORDER BY p.field_name`,
      [id],
    ),
    getPool().query(
      `SELECT s.slug AS source, e.external_id
       FROM external_identifiers e
       JOIN catalog_sources s ON s.id = e.catalog_source_id
       WHERE e.movie_id = $1
       ORDER BY s.slug`,
      [id],
    ),
    getPool().query(
      `SELECT p.name, c.department, c.job, c.character_name
       FROM movie_credits c
       JOIN people p ON p.id = c.person_id
       WHERE c.movie_id = $1
       ORDER BY c.department, c.billing_order NULLS LAST, p.name
       LIMIT 40`,
      [id],
    ),
    getPool().query(
      `SELECT id, media_type, quality, status, availability_status, rights_status
       FROM media_references
       WHERE movie_id = $1
       ORDER BY created_at
       LIMIT 20`,
      [id],
    ),
  ]);
  const row = movie.rows[0];
  return {
    id: row.id,
    title: row.canonical_title,
    originalTitle: row.original_title,
    slug: row.slug,
    synopsis: row.synopsis,
    tagline: row.tagline,
    releaseDate: row.release_date,
    runtimeMinutes: row.runtime_minutes,
    status: row.status,
    published: row.status === 'active',
    languageCode: row.language_code,
    genreSlugs: genres.rows.map((item) => item.slug),
    countryCodes: countries.rows.map((item) => item.code),
    alternateTitles: titles.rows.map((item) => item.title),
    collectionId: collection.rows[0]?.collection_id ?? null,
    images: images.rows.map((item) => ({
      id: item.id,
      type: item.image_type,
      url: item.url,
      width: item.width,
      height: item.height,
      usable: typeof item.url === 'string' && item.url.startsWith('https://') && item.width > 0 && item.height > 0,
    })),
    videos: videos.rows.map((item) => ({ id: item.id, type: item.video_type, url: item.url })),
    identifiers: identifiers.rows.map((item) => ({ source: item.source, externalId: item.external_id })),
    curatedFields: curated.rows.filter((item) => item.origin === 'manual').map((item) => item.field_name),
    provenance: curated.rows.map((item) => ({
      field: item.field_name,
      source: item.origin === 'manual' ? 'Manual override' : (item.source_name || 'External metadata provider'),
    })),
    cast: credits.rows.filter((item) => item.department === 'Acting').map((item) => ({
      name: item.name,
      character: item.character_name,
    })),
    crew: credits.rows.filter((item) => item.department !== 'Acting').map((item) => ({
      name: item.name,
      job: item.job,
    })),
    media: media.rows.map((item) => ({
      id: item.id,
      type: item.media_type,
      quality: item.quality,
      status: item.status,
      availability: item.availability_status,
      rights: item.rights_status,
    })),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function updateMovie(actorId, id, patch) {
  const slugValue = await withTransaction(async (client) => {
    const current = await client.query('SELECT id, slug FROM movies WHERE id = $1', [id]);
    if (!current.rowCount) throw notFound('Movie not found');
    const sets = [];
    const params = [id];
    const curated = [];
    const assign = (column, field, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
      curated.push(field);
    };
    if (patch.canonicalTitle !== undefined) assign('canonical_title', 'canonical_title', patch.canonicalTitle);
    if (patch.originalTitle !== undefined) assign('original_title', 'original_title', patch.originalTitle);
    if (patch.synopsis !== undefined) assign('synopsis', 'synopsis', patch.synopsis);
    if (patch.tagline !== undefined) assign('tagline', 'tagline', patch.tagline);
    if (patch.runtimeMinutes !== undefined) assign('runtime_minutes', 'runtime_minutes', patch.runtimeMinutes);
    if (patch.releaseDate !== undefined) {
      params.push(patch.releaseDate);
      const dateIndex = params.length;
      params.push(patch.releaseDate ? Number(patch.releaseDate.slice(0, 4)) : null);
      sets.push(`release_date = $${dateIndex}`, `release_year = $${params.length}`);
      curated.push('release_date', 'release_year');
    }
    if (patch.languageCode !== undefined) {
      let languageId = null;
      if (patch.languageCode) {
        const language = await client.query('SELECT id FROM languages WHERE code = $1', [patch.languageCode]);
        if (!language.rowCount) {
          throw new AppError('Unknown language', { status: 400, code: 'VALIDATION_ERROR' });
        }
        languageId = language.rows[0].id;
      }
      assign('original_language_id', 'original_language_id', languageId);
    }
    if (sets.length) {
      await client.query(`UPDATE movies SET ${sets.join(', ')} WHERE id = $1`, params);
      for (const field of curated) await curate(client, id, field);
    }
    if (patch.genreSlugs) {
      const genres = await client.query('SELECT id, slug FROM genres WHERE slug = ANY($1::text[]) AND archived_at IS NULL', [patch.genreSlugs]);
      if (genres.rowCount !== new Set(patch.genreSlugs).size) {
        throw new AppError('Unknown genre', { status: 400, code: 'VALIDATION_ERROR' });
      }
      await client.query('DELETE FROM movie_genres WHERE movie_id = $1', [id]);
      for (const genre of genres.rows) {
        await client.query('INSERT INTO movie_genres (movie_id, genre_id) VALUES ($1, $2)', [id, genre.id]);
      }
    }
    if (patch.countryCodes) {
      const countries = await client.query('SELECT id, code FROM countries WHERE code = ANY($1::text[])', [patch.countryCodes]);
      if (countries.rowCount !== new Set(patch.countryCodes).size) {
        throw new AppError('Unknown country', { status: 400, code: 'VALIDATION_ERROR' });
      }
      await client.query('DELETE FROM movie_countries WHERE movie_id = $1', [id]);
      for (const country of countries.rows) {
        await client.query('INSERT INTO movie_countries (movie_id, country_id) VALUES ($1, $2)', [id, country.id]);
      }
    }
    if (patch.alternateTitles) {
      await client.query('DELETE FROM alternate_titles WHERE movie_id = $1', [id]);
      for (const title of patch.alternateTitles) {
        await client.query(
          'INSERT INTO alternate_titles (movie_id, title, catalog_source_id) VALUES ($1, $2, $3)',
          [id, title, MANUAL_SOURCE_ID],
        );
      }
    }
    if (patch.collectionId !== undefined) {
      await client.query('DELETE FROM collection_movies WHERE movie_id = $1', [id]);
      if (patch.collectionId) {
        const collection = await client.query('SELECT id FROM collections WHERE id = $1', [patch.collectionId]);
        if (!collection.rowCount) throw notFound('Collection not found');
        const order = await client.query('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collection_movies WHERE collection_id = $1', [patch.collectionId]);
        await client.query(
          'INSERT INTO collection_movies (collection_id, movie_id, sort_order) VALUES ($1, $2, $3)',
          [patch.collectionId, id, order.rows[0].next],
        );
      }
    }
    await recordAudit(client, {
      actorId, action: 'MOVIE_UPDATED', targetType: 'movie', targetId: id, metadata: { fields: Object.keys(patch) },
    });
    return current.rows[0].slug;
  });
  await invalidateCatalogCache({ slug: slugValue });
  await upsertMovieDocuments([id]);
  return getMovie(id);
}

async function setMovieStatus(actorId, id, status, action) {
  const row = await getPool().query(
    `UPDATE movies
     SET status = $2,
         archived_at = CASE WHEN $2 = 'archived' THEN COALESCE(archived_at, NOW()) ELSE NULL END
     WHERE id = $1
     RETURNING slug`,
    [id, status],
  );
  if (!row.rowCount) throw notFound('Movie not found');
  await recordAudit(null, {
    actorId,
    action,
    targetType: 'movie',
    targetId: id,
  });
  await invalidateCatalogCache({ slug: row.rows[0].slug });
  await upsertMovieDocuments([id]);
  const catalogEvent = status === 'active'
    ? 'CATALOG_PUBLISHED'
    : status === 'archived'
      ? 'CATALOG_ARCHIVED'
      : '';
  if (catalogEvent) {
    recordAnalytics({ name: catalogEvent, subject: row.rows[0].slug, outcome: 'success' });
  }
  return getMovie(id);
}

async function movieStatus(id) {
  const current = await getPool().query('SELECT status FROM movies WHERE id = $1', [id]);
  if (!current.rowCount) throw notFound('Movie not found');
  return current.rows[0].status;
}

async function moveMovie(actorId, id, from, to, action, conflict) {
  if (await movieStatus(id) !== from) {
    throw new AppError(conflict, { status: 409, code: 'CONFLICT' });
  }
  return setMovieStatus(actorId, id, to, action);
}

export function submitMovie(actorId, id) {
  return moveMovie(actorId, id, 'draft', 'review', 'MOVIE_SUBMITTED', 'Only a draft can be submitted for review');
}

export function approveMovie(actorId, id) {
  return moveMovie(actorId, id, 'review', 'approved', 'MOVIE_APPROVED', 'Only a movie in review can be approved');
}

export async function publishMovie(actorId, id) {
  const ready = await getPool().query(
    `SELECT m.content_type_id,
            EXISTS (SELECT 1 FROM movie_countries mc WHERE mc.movie_id = m.id) AS has_country
     FROM movies m
     WHERE m.id = $1`,
    [id],
  );
  if (!ready.rowCount) throw notFound('Movie not found');
  if (!ready.rows[0].content_type_id || !ready.rows[0].has_country) {
    throw new AppError('Country and content type must be resolved before publication', {
      status: 409,
      code: 'CLASSIFICATION_REQUIRED',
    });
  }
  return moveMovie(actorId, id, 'approved', 'active', 'MOVIE_PUBLISHED', 'Only an approved movie can be published');
}

export async function archiveMovie(actorId, id) {
  if (await movieStatus(id) === 'archived') {
    throw new AppError('This movie is already archived', { status: 409, code: 'CONFLICT' });
  }
  return setMovieStatus(actorId, id, 'archived', 'MOVIE_ARCHIVED');
}

export async function unpublishMovie(actorId, id) {
  return moveMovie(actorId, id, 'active', 'approved', 'MOVIE_UNPUBLISHED', 'Only a published movie can be unpublished');
}

export async function restoreMovie(actorId, id) {
  if (await movieStatus(id) !== 'archived') {
    throw new AppError('Only an archived movie can be restored', { status: 409, code: 'CONFLICT' });
  }
  return setMovieStatus(actorId, id, 'draft', 'MOVIE_RESTORED');
}

async function touchMovie(actorId, movieId, action, metadata) {
  const slugRow = await getPool().query('SELECT slug FROM movies WHERE id = $1', [movieId]);
  if (!slugRow.rowCount) throw notFound('Movie not found');
  await recordAudit(null, {
    actorId, action, targetType: 'movie', targetId: movieId, metadata,
  });
  await invalidateCatalogCache({ slug: slugRow.rows[0].slug });
  await upsertMovieDocuments([movieId]);
}

async function assignGenre(actorId, movieId, genreSlug) {
  const genre = await getPool().query(
    'SELECT id FROM genres WHERE slug = $1 AND archived_at IS NULL',
    [genreSlug],
  );
  if (!genre.rowCount) throw notFound('Genre not found');
  await getPool().query(
    'INSERT INTO movie_genres (movie_id, genre_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [movieId, genre.rows[0].id],
  );
  await touchMovie(actorId, movieId, 'MOVIE_GENRE_ASSIGNED', { genreSlug });
}

async function assignCountry(actorId, movieId, countryCode) {
  const country = await getPool().query('SELECT id FROM countries WHERE code = $1 AND active = TRUE', [countryCode]);
  if (!country.rowCount) throw notFound('Country not found');
  await getPool().query(
    'INSERT INTO movie_countries (movie_id, country_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [movieId, country.rows[0].id],
  );
  await touchMovie(actorId, movieId, 'MOVIE_COUNTRY_ASSIGNED', { countryCode });
}

async function assignCollection(actorId, movieId, collectionId) {
  const collection = await getPool().query('SELECT id FROM collections WHERE id = $1', [collectionId]);
  if (!collection.rowCount) throw notFound('Collection not found');
  await withTransaction(async (client) => {
    await client.query('DELETE FROM collection_movies WHERE movie_id = $1', [movieId]);
    const order = await client.query(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM collection_movies WHERE collection_id = $1',
      [collectionId],
    );
    await client.query(
      'INSERT INTO collection_movies (collection_id, movie_id, sort_order) VALUES ($1, $2, $3)',
      [collectionId, movieId, order.rows[0].next],
    );
  });
  await touchMovie(actorId, movieId, 'MOVIE_COLLECTION_ASSIGNED', { collectionId });
}

export async function createMovie(actorId, { canonicalTitle }) {
  const base = slugify(canonicalTitle);
  if (!base) throw new AppError('Title needs letters or numbers', { status: 400, code: 'VALIDATION_ERROR' });
  let slugValue = base;
  for (let attempt = 2; attempt < 30; attempt += 1) {
    const existing = await getPool().query('SELECT 1 FROM movies WHERE slug = $1', [slugValue]);
    if (!existing.rowCount) break;
    slugValue = `${base}-${attempt}`;
  }
  const created = await withTransaction(async (client) => {
    const row = await client.query(
      `INSERT INTO movies (canonical_title, slug, status) VALUES ($1, $2, 'draft') RETURNING id`,
      [canonicalTitle, slugValue],
    );
    await curate(client, row.rows[0].id, 'canonical_title');
    await recordAudit(client, {
      actorId,
      action: 'MOVIE_CREATED',
      targetType: 'movie',
      targetId: row.rows[0].id,
    });
    return row.rows[0].id;
  });
  recordAnalytics({ name: 'CATALOG_ADDED', subject: slugValue, outcome: 'success' });
  return getMovie(created);
}

export async function queueBulk(actorId, { action, ids, genreSlug, countryCode, collectionId }) {
  if (action === 'assignGenre' && !genreSlug) {
    throw new AppError('Choose a genre', { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (action === 'assignCountry' && !countryCode) {
    throw new AppError('Choose a country', { status: 400, code: 'VALIDATION_ERROR' });
  }
  if (action === 'assignCollection' && !collectionId) {
    throw new AppError('Choose a collection', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const created = await getPool().query(
    `INSERT INTO admin_operations (actor_user_id, action, total_count, metadata)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, action, status, total_count, processed_count`,
    [actorId, action, ids.length, JSON.stringify({ movieIds: ids, genreSlug, countryCode, collectionId })],
  );
  const operation = created.rows[0];
  await recordAudit(null, {
    actorId,
    action: 'BULK_QUEUED',
    targetType: 'operation',
    targetId: operation.id,
    metadata: { action, count: ids.length },
  });
  setImmediate(() => {
    processAdminOperation(operation.id).catch((error) => {
      loggerSafe(error);
    });
  });
  return {
    id: operation.id,
    action: operation.action,
    status: operation.status,
    total: operation.total_count,
    processed: operation.processed_count,
  };
}

function loggerSafe(error) {
  import('../logger/index.js').then(({ logger }) => {
    logger.error({ event: 'ADMIN_OPERATION_FAILED', code: error?.code || 'ADMIN_UNAVAILABLE' }, 'ADMIN_OPERATION_FAILED');
  }).catch(() => {});
}

export async function processAdminOperation(id) {
  const claimed = await getPool().query(
    `UPDATE admin_operations SET status = 'processing'
     WHERE id = $1 AND status = 'pending'
     RETURNING id, actor_user_id, action, metadata`,
    [id],
  );
  if (!claimed.rowCount) return null;
  const operation = claimed.rows[0];
  const ids = operation.metadata.movieIds || [];
  let processed = 0;
  try {
    for (const movieId of ids) {
      if (operation.action === 'publish') {
        if (await movieStatus(movieId) !== 'approved') continue;
        await publishMovie(operation.actor_user_id, movieId);
      } else if (operation.action === 'unpublish') {
        if (await movieStatus(movieId) !== 'active') continue;
        await unpublishMovie(operation.actor_user_id, movieId);
      } else if (operation.action === 'archive') await archiveMovie(operation.actor_user_id, movieId);
      else if (operation.action === 'assignGenre') await assignGenre(operation.actor_user_id, movieId, operation.metadata.genreSlug);
      else if (operation.action === 'assignCountry') await assignCountry(operation.actor_user_id, movieId, operation.metadata.countryCode);
      else if (operation.action === 'assignCollection') await assignCollection(operation.actor_user_id, movieId, operation.metadata.collectionId);
      else await upsertMovieDocuments([movieId]);
      processed += 1;
      await getPool().query('UPDATE admin_operations SET processed_count = $2 WHERE id = $1', [id, processed]);
    }
    await getPool().query(
      `UPDATE admin_operations SET status = 'completed', completed_at = NOW(), processed_count = $2 WHERE id = $1`,
      [id, processed],
    );
    return { id, processed };
  } catch (error) {
    await getPool().query(
      `UPDATE admin_operations SET status = 'failed', completed_at = NOW(), processed_count = $2 WHERE id = $1`,
      [id, processed],
    );
    throw error;
  }
}

export async function listGenres() {
  const rows = await getPool().query(
    `SELECT g.id, g.name, g.slug, g.archived_at IS NOT NULL AS archived,
            COUNT(mg.movie_id)::int AS movie_count
     FROM genres g
     LEFT JOIN movie_genres mg ON mg.genre_id = g.id
     GROUP BY g.id
     ORDER BY g.name`,
  );
  return rows.rows.map((row) => ({
    id: row.id, name: row.name, slug: row.slug, archived: row.archived, movieCount: row.movie_count,
  }));
}

export async function createGenre(actorId, { name, slug: requested }) {
  const value = requested || slugify(name);
  if (!SLUG_PATTERN.test(value)) throw new AppError('Genre slug is invalid', { status: 400, code: 'VALIDATION_ERROR' });
  try {
    const row = await getPool().query(
      'INSERT INTO genres (name, slug) VALUES ($1, $2) RETURNING id, name, slug',
      [name, value],
    );
    await recordAudit(null, { actorId, action: 'GENRE_CREATED', targetType: 'genre', targetId: row.rows[0].id });
    return row.rows[0];
  } catch (error) {
    if (error.code === '23505') {
      throw new AppError('Genre slug already exists', { status: 409, code: 'CONFLICT' });
    }
    throw error;
  }
}

export async function updateGenre(actorId, id, { name }) {
  const row = await getPool().query('UPDATE genres SET name = $2 WHERE id = $1 RETURNING id, name, slug', [id, name]);
  if (!row.rowCount) throw notFound('Genre not found');
  await recordAudit(null, { actorId, action: 'GENRE_UPDATED', targetType: 'genre', targetId: id });
  await invalidateCatalogCache();
  return row.rows[0];
}

export async function archiveGenre(actorId, id) {
  const row = await getPool().query(
    'UPDATE genres SET archived_at = COALESCE(archived_at, NOW()) WHERE id = $1 RETURNING id',
    [id],
  );
  if (!row.rowCount) throw notFound('Genre not found');
  await recordAudit(null, { actorId, action: 'GENRE_ARCHIVED', targetType: 'genre', targetId: id });
  await invalidateCatalogCache();
  return { id, archived: true };
}

export async function mergeGenre(actorId, sourceId, targetId) {
  if (sourceId === targetId) {
    throw new AppError('Choose a different genre', { status: 400, code: 'VALIDATION_ERROR' });
  }
  await withTransaction(async (client) => {
    const genres = await client.query('SELECT id FROM genres WHERE id = ANY($1::uuid[])', [[sourceId, targetId]]);
    if (genres.rowCount !== 2) throw notFound('Genre not found');
    await client.query(
      `INSERT INTO movie_genres (movie_id, genre_id)
       SELECT movie_id, $2 FROM movie_genres WHERE genre_id = $1
       ON CONFLICT DO NOTHING`,
      [sourceId, targetId],
    );
    await client.query('DELETE FROM movie_genres WHERE genre_id = $1', [sourceId]);
    await client.query('UPDATE genres SET archived_at = COALESCE(archived_at, NOW()) WHERE id = $1', [sourceId]);
    await recordAudit(client, {
      actorId,
      action: 'GENRE_MERGED',
      targetType: 'genre',
      targetId: sourceId,
      metadata: { targetId },
    });
  });
  await invalidateCatalogCache();
  return { id: sourceId, archived: true, targetId };
}

export async function listCollections() {
  const rows = await getPool().query(
    `SELECT c.id, c.name, c.slug, c.description, c.archived_at IS NULL AS published,
            COALESCE(
              json_agg(
                json_build_object('id', m.id, 'title', m.canonical_title, 'sortOrder', cm.sort_order)
                ORDER BY cm.sort_order, m.canonical_title
              ) FILTER (WHERE m.id IS NOT NULL),
              '[]'::json
            ) AS movies
     FROM collections c
     LEFT JOIN collection_movies cm ON cm.collection_id = c.id
     LEFT JOIN movies m ON m.id = cm.movie_id
     GROUP BY c.id
     ORDER BY c.name`,
  );
  return rows.rows.map((row) => {
    let movies = row.movies;
    if (typeof movies === 'string') {
      try { movies = JSON.parse(movies); } catch { movies = []; }
    }
    if (!Array.isArray(movies)) movies = [];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      published: row.published,
      movieCount: movies.length,
      movies,
    };
  });
}

export async function createCollection(actorId, input) {
  const value = input.slug || slugify(input.name);
  if (!SLUG_PATTERN.test(value)) throw new AppError('Collection slug is invalid', { status: 400, code: 'VALIDATION_ERROR' });
  try {
    const row = await getPool().query(
      `INSERT INTO collections (name, slug, description) VALUES ($1, $2, $3)
       RETURNING id, name, slug`,
      [input.name, value, input.description ?? null],
    );
    await recordAudit(null, { actorId, action: 'COLLECTION_CREATED', targetType: 'collection', targetId: row.rows[0].id });
    return row.rows[0];
  } catch (error) {
    if (error.code === '23505') throw new AppError('Collection slug already exists', { status: 409, code: 'CONFLICT' });
    throw error;
  }
}

export async function updateCollection(actorId, id, patch) {
  const row = await getPool().query(
    `UPDATE collections
     SET name = COALESCE($2, name), description = COALESCE($3, description)
     WHERE id = $1
     RETURNING id, name, slug, description`,
    [id, patch.name ?? null, patch.description ?? null],
  );
  if (!row.rowCount) throw notFound('Collection not found');
  await recordAudit(null, { actorId, action: 'COLLECTION_UPDATED', targetType: 'collection', targetId: id });
  await invalidateCatalogCache();
  return row.rows[0];
}

export async function setCollectionPublished(actorId, id, published) {
  const row = await getPool().query(
    `UPDATE collections SET archived_at = CASE WHEN $2 THEN NULL ELSE COALESCE(archived_at, NOW()) END
     WHERE id = $1 RETURNING id`,
    [id, published],
  );
  if (!row.rowCount) throw notFound('Collection not found');
  await recordAudit(null, {
    actorId,
    action: published ? 'COLLECTION_PUBLISHED' : 'COLLECTION_ARCHIVED',
    targetType: 'collection',
    targetId: id,
  });
  await invalidateCatalogCache();
  return { id, published };
}

export async function orderCollection(actorId, id, movieIds) {
  await withTransaction(async (client) => {
    const collection = await client.query('SELECT id FROM collections WHERE id = $1', [id]);
    if (!collection.rowCount) throw notFound('Collection not found');
    const members = await client.query('SELECT movie_id FROM collection_movies WHERE collection_id = $1', [id]);
    const known = new Set(members.rows.map((row) => row.movie_id));
    if (movieIds.length !== known.size || movieIds.some((movieId) => !known.has(movieId))) {
      throw new AppError('Order must include every movie in the collection', { status: 400, code: 'VALIDATION_ERROR' });
    }
    for (let index = 0; index < movieIds.length; index += 1) {
      await client.query(
        'UPDATE collection_movies SET sort_order = $3 WHERE collection_id = $1 AND movie_id = $2',
        [id, movieIds[index], index],
      );
    }
    await recordAudit(client, { actorId, action: 'COLLECTION_REORDERED', targetType: 'collection', targetId: id });
  });
  return { id, movieIds };
}

export async function listPeople({ q, department } = {}) {
  const rows = await getPool().query(
    `SELECT p.id, p.name, p.archived_at IS NOT NULL AS archived,
            COALESCE(array_agg(DISTINCT c.department) FILTER (WHERE c.department IS NOT NULL), ARRAY[]::text[]) AS departments
     FROM people p
     LEFT JOIN movie_credits c ON c.person_id = p.id
     WHERE ($1::text IS NULL OR p.name ILIKE $1)
       AND ($2::text IS NULL OR c.department = $2)
     GROUP BY p.id
     ORDER BY p.name
     LIMIT 100`,
    [likeTerm(q), department ?? null],
  );
  return rows.rows.map((row) => ({
    id: row.id, name: row.name, archived: row.archived, departments: row.departments,
  }));
}

export async function listMedia() {
  const rows = await getPool().query(
    `SELECT r.id, m.canonical_title AS movie, p.slug AS provider, r.media_type, r.quality,
            r.availability_status, r.status, r.rights_status, r.last_checked_at
     FROM media_references r
     JOIN movies m ON m.id = r.movie_id
     JOIN providers p ON p.id = r.provider_id
     ORDER BY m.canonical_title, p.slug
     LIMIT 100`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    movie: row.movie,
    provider: row.provider,
    mediaType: row.media_type,
    quality: row.quality,
    availability: row.availability_status,
    rights: row.rights_status,
    status: row.status,
    lastCheckedAt: row.last_checked_at,
  }));
}

async function setMedia(actorId, id, status, action) {
  if (status === 'available') {
    const rights = await getPool().query('SELECT rights_status FROM media_references WHERE id = $1', [id]);
    if (!rights.rowCount) throw notFound('Media reference not found');
    if (rights.rows[0].rights_status !== 'AUTHORIZED') {
      throw new AppError('Unauthorized media cannot be marked available', { status: 409, code: 'CONFLICT' });
    }
  }
  const row = await getPool().query(
    `UPDATE media_references
     SET status = $2,
         availability_status = CASE WHEN $2 = 'available' THEN 'available' ELSE 'unavailable' END,
         last_checked_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id, status],
  );
  if (!row.rowCount) throw notFound('Media reference not found');
  await recordAudit(null, { actorId, action, targetType: 'media_reference', targetId: id });
  return { id, status };
}

export function disableMedia(actorId, id) {
  return setMedia(actorId, id, 'unavailable', 'MEDIA_DISABLED');
}

export function enableMedia(actorId, id) {
  return setMedia(actorId, id, 'available', 'MEDIA_ENABLED');
}

export function archiveMedia(actorId, id) {
  return setMedia(actorId, id, 'archived', 'MEDIA_ARCHIVED');
}

export async function validateMedia(actorId, id) {
  const row = await getPool().query(
    `SELECT r.id, r.external_reference, r.media_type, r.quality, p.slug
     FROM media_references r
     JOIN providers p ON p.id = r.provider_id
     WHERE r.id = $1`,
    [id],
  );
  if (!row.rowCount) throw notFound('Media reference not found');
  const rights = await getPool().query('SELECT rights_status FROM media_references WHERE id = $1', [id]);
  const adapter = getMediaAdapter(row.rows[0].slug);
  let availability = 'unknown';
  if (adapter) {
    const status = await adapter.getFileStatus(row.rows[0]);
    availability = status.availability === 'available' ? 'available' : 'unavailable';
  }
  if (availability === 'available' && rights.rows[0]?.rights_status !== 'AUTHORIZED') {
    availability = 'unavailable';
  }
  await getPool().query(
    `UPDATE media_references
     SET availability_status = $2, last_checked_at = NOW(),
         status = CASE WHEN $2 = 'available' THEN 'available' ELSE status END
     WHERE id = $1`,
    [id, availability === 'unknown' ? 'unknown' : availability],
  );
  await recordAudit(null, {
    actorId, action: 'MEDIA_VALIDATED', targetType: 'media_reference', targetId: id, metadata: { availability },
  });
  return { id, availability };
}

export async function listProviders() {
  const enabled = new Set(config.mediaProviders);
  const rows = await getPool().query(
    `SELECT p.id, p.name, p.slug, p.status, p.capabilities, h.status AS health,
            h.last_success_at, h.last_checked_at, h.last_error_code
     FROM providers p
     LEFT JOIN provider_health h ON h.provider_id = p.id
     ORDER BY p.slug`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    status: row.status,
    health: row.health || 'unknown',
    lastSuccessAt: row.last_success_at,
    lastCheckedAt: row.last_checked_at,
    lastFailure: row.last_error_code,
    mediaTypes: row.capabilities?.media_types || [],
    credentials: enabled.has(row.slug) ? 'Configured' : 'Not configured',
  }));
}

export async function setProviderStatus(actorId, id, status) {
  const row = await getPool().query(
    `UPDATE providers
     SET status = $2, archived_at = CASE WHEN $2 = 'archived' THEN COALESCE(archived_at, NOW()) ELSE NULL END
     WHERE id = $1
     RETURNING id, slug`,
    [id, status],
  );
  if (!row.rowCount) throw notFound('Provider not found');
  await recordAudit(null, {
    actorId,
    action: status === 'active' ? 'PROVIDER_ENABLED' : 'PROVIDER_DISABLED',
    targetType: 'provider',
    targetId: id,
  });
  return { id, status };
}

export async function checkProvider(actorId, id) {
  const row = await getPool().query('SELECT id, slug FROM providers WHERE id = $1', [id]);
  if (!row.rowCount) throw notFound('Provider not found');
  const adapter = getMediaAdapter(row.rows[0].slug);
  let health = 'unavailable';
  let errorCode = adapter ? null : 'NO_ADAPTER';
  if (adapter) {
    try {
      const result = await adapter.healthCheck();
      health = result.status === 'available' ? 'available' : 'degraded';
    } catch {
      health = 'unavailable';
      errorCode = 'HEALTH_FAILED';
    }
  }
  await recordProviderHealth(id, health, errorCode);
  await recordAudit(null, {
    actorId, action: 'PROVIDER_HEALTH_CHECKED', targetType: 'provider', targetId: id, metadata: { health },
  });
  return { id, health };
}

export async function retryIngestion(actorId, id) {
  const row = await getPool().query(
    `UPDATE ingestion_jobs
     SET status = 'pending',
         available_at = NOW(),
         completed_at = NULL,
         max_attempts = LEAST(10, GREATEST(max_attempts, attempt_count + 1))
     WHERE id = $1 AND status IN ('failed', 'dead_letter')
     RETURNING id, status, attempt_count, max_attempts, last_error_code`,
    [id],
  );
  if (!row.rowCount) throw new AppError('Only a failed job can be retried', { status: 409, code: 'CONFLICT' });
  await recordAudit(null, { actorId, action: 'INGESTION_RETRIED', targetType: 'ingestion_job', targetId: id });
  return {
    id: row.rows[0].id,
    status: row.rows[0].status,
    attemptCount: row.rows[0].attempt_count,
    maxAttempts: row.rows[0].max_attempts,
    errorCode: row.rows[0].last_error_code,
  };
}

export async function searchStatus() {
  const rows = await getPool().query(
    `SELECT
       (SELECT version FROM search_index_versions WHERE status = 'active' LIMIT 1) AS version,
       (SELECT status FROM search_index_versions WHERE status IN ('active', 'building') ORDER BY version DESC LIMIT 1) AS index_status,
       (SELECT COUNT(*)::int FROM search_documents d
         JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
         WHERE d.status = 'active') AS indexed,
       (SELECT COUNT(*)::int FROM search_index_events WHERE consumed_at IS NULL) AS pending,
       (SELECT COUNT(*)::int FROM search_index_events WHERE last_error_code IS NOT NULL) AS failed,
       (SELECT status FROM search_reindex_jobs ORDER BY created_at DESC LIMIT 1) AS reindex_status,
       (SELECT processed FROM search_reindex_jobs ORDER BY created_at DESC LIMIT 1) AS reindex_processed`,
  );
  const row = rows.rows[0];
  return {
    version: row.version,
    indexStatus: row.index_status || 'missing',
    indexedMovies: row.indexed,
    pendingUpdates: row.pending,
    failedUpdates: row.failed,
    reindexStatus: row.reindex_status,
    reindexProcessed: row.reindex_processed,
  };
}

export async function reindexMovie(actorId, id) {
  const movie = await getPool().query('SELECT id FROM movies WHERE id = $1', [id]);
  if (!movie.rowCount) throw notFound('Movie not found');
  await upsertMovieDocuments([id]);
  await recordAudit(null, { actorId, action: 'SEARCH_REINDEX_STARTED', targetType: 'movie', targetId: id });
  return { id, status: 'indexed' };
}

export async function reindexCollection(actorId, id) {
  const collection = await getPool().query('SELECT id FROM collections WHERE id = $1', [id]);
  if (!collection.rowCount) throw notFound('Collection not found');
  const movies = await getPool().query('SELECT movie_id FROM collection_movies WHERE collection_id = $1', [id]);
  const ids = movies.rows.map((row) => row.movie_id);
  await recordAudit(null, {
    actorId,
    action: 'SEARCH_REINDEX_STARTED',
    targetType: 'collection',
    targetId: id,
    metadata: { count: ids.length },
  });
  if (ids.length) {
    setImmediate(() => {
      upsertMovieDocuments(ids).catch((error) => loggerSafe(error));
    });
  }
  return { id, queued: ids.length };
}

export async function reindexBatch(actorId, ids) {
  return queueBulk(actorId, { action: 'reindex', ids });
}

export async function startFullReindex(actorId) {
  const queued = await enqueueReindex();
  await recordAudit(null, {
    actorId,
    action: 'SEARCH_REINDEX_STARTED',
    targetType: 'search_index',
    targetId: queued.job.id,
  });
  return { id: queued.job.id, status: queued.job.status, processed: queued.job.processed, created: queued.created };
}

export async function listUsers(query = '') {
  const term = query.trim().slice(0, 80).replace(/[%_\\]/g, '');
  const rows = await getPool().query(
    `SELECT u.id, u.email, u.display_name, u.account_status, u.created_at, u.last_login_at,
            COALESCE(array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL), ARRAY[]::text[]) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.deleted_at IS NULL
       AND ($1 = '' OR u.email ILIKE '%' || $1 || '%' OR u.display_name ILIKE '%' || $1 || '%')
     GROUP BY u.id
     ORDER BY u.created_at DESC
     LIMIT 100`,
    [term],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    accountStatus: row.account_status,
    roles: row.roles,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
  }));
}

export async function setUserStatus(actorId, id, accountStatus) {
  if (actorId === id && accountStatus !== 'active') {
    throw new AppError('You cannot deactivate your own account', { status: 409, code: 'CONFLICT' });
  }
  const row = await getPool().query(
    `UPDATE users SET account_status = $2 WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, accountStatus],
  );
  if (!row.rowCount) throw notFound('User not found');
  await recordAudit(null, {
    actorId, action: 'USER_STATUS_CHANGED', targetType: 'user', targetId: id, metadata: { accountStatus },
  });
  return { id, accountStatus };
}

export async function setUserRoles(actorId, id, roles) {
  if (actorId === id) {
    throw new AppError('You cannot change your own roles', { status: 409, code: 'CONFLICT' });
  }
  await withTransaction(async (client) => {
    const user = await client.query('SELECT id FROM users WHERE id = $1 AND deleted_at IS NULL', [id]);
    if (!user.rowCount) throw notFound('User not found');
    await client.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE slug = ANY($2::text[])`,
      [id, roles],
    );
    await recordAudit(client, {
      actorId, action: 'USER_ROLE_CHANGED', targetType: 'user', targetId: id, metadata: { roles: roles.join(',') },
    });
  });
  return { id, roles };
}

export async function systemStatus() {
  const metrics = await dashboard();
  const settings = await getPool().query(`SELECT key, value, updated_at FROM platform_settings ORDER BY key`);
  const databaseStatus = metrics.system.database === 'HEALTHY' ? 'ok' : 'unavailable';
  const operations = await operationalSnapshot(databaseStatus);
  const maintenance = await maintenanceState();
  return {
    release: release.label,
    ...metrics.system,
    maintenance,
    flags: {
      ingestion: await flagEnabled('ingestion'),
      searchIndexing: await flagEnabled('searchIndexing'),
      advertising: await flagEnabled('advertising'),
    },
    checks: operations.checks,
    alerts: operations.alerts,
    databaseBytes: operations.databaseBytes,
    pwa: {
      name: 'BeezMovies',
      display: 'standalone',
      startUrl: '/',
      themeColor: '#0B0D0F',
      backgroundColor: '#0B0D0F',
      assets: pwaAssetReport(),
      removal: 'Required startup assets cannot be removed from this screen.',
    },
    settings: settings.rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedAt: row.updated_at,
    })),
  };
}

export async function updateSettings(actorId, { opsNote }) {
  const row = await getPool().query(
    `UPDATE platform_settings
     SET value = $2::jsonb, updated_at = NOW(), updated_by = $3
     WHERE key = 'ops_note'
     RETURNING key, value`,
    ['ops_note', JSON.stringify({ text: opsNote }), actorId],
  );
  await recordAudit(null, { actorId, action: 'SETTINGS_UPDATED', targetType: 'setting', targetId: 'ops_note' });
  return row.rows[0];
}

export { listAudit };
