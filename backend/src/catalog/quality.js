import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { withTransaction } from '../db/transaction.js';
import { recordAudit } from '../admin/audit.js';
import { invalidateCatalogCache } from './admin.js';
import { enqueueIngestion } from '../ingestion/pipeline.js';
import { upsertMovieDocuments } from '../search/indexer.js';

export function publicationIssues(movie) {
  const issues = [];
  if (!movie.title) issues.push('title');
  if (!movie.releaseYear && !movie.releaseDate) issues.push('release');
  if (!movie.synopsis) issues.push('synopsis');
  if (!movie.genreCount) issues.push('genre');
  if (!movie.posterCount) issues.push('poster');
  return issues;
}

export async function catalogHealth() {
  const result = await getPool().query(`
    SELECT
      (SELECT COUNT(*)::int FROM movies) AS total,
      (SELECT COUNT(*)::int FROM movies WHERE status = 'active') AS published,
      (SELECT COUNT(*)::int FROM movies WHERE status = 'draft') AS draft,
      (SELECT COUNT(*)::int FROM movies WHERE status = 'archived') AS archived,
      (SELECT COUNT(*)::int FROM movies m WHERE m.status = 'active' AND (m.synopsis IS NULL OR btrim(m.synopsis) = '')) AS missing_synopsis,
      (SELECT COUNT(*)::int FROM movies m WHERE m.status = 'active' AND m.release_year IS NULL AND m.release_date IS NULL) AS missing_release,
      (SELECT COUNT(*)::int FROM movies m WHERE m.status = 'active' AND NOT EXISTS (SELECT 1 FROM movie_genres g WHERE g.movie_id = m.id)) AS missing_genre,
      (SELECT COUNT(*)::int FROM movies m WHERE m.status = 'active' AND NOT EXISTS (SELECT 1 FROM movie_countries mc WHERE mc.movie_id = m.id)) AS missing_country,
      (SELECT COUNT(*)::int FROM ingestion_reviews WHERE status = 'pending') AS duplicate_candidates,
      (SELECT COUNT(*)::int FROM movies m WHERE m.status = 'active' AND NOT EXISTS (
         SELECT 1 FROM movie_images i WHERE i.movie_id = m.id AND i.image_type = 'poster')) AS missing_posters,
      (SELECT COUNT(*)::int FROM movies m WHERE m.status = 'active' AND NOT EXISTS (
         SELECT 1 FROM movie_images i WHERE i.movie_id = m.id AND i.image_type = 'backdrop')) AS missing_backdrops,
      (SELECT COUNT(*)::int FROM media_references WHERE status = 'available' AND availability_status = 'available') AS media_available,
      (SELECT COUNT(*)::int FROM media_references WHERE status = 'unavailable' OR availability_status = 'unavailable') AS media_unavailable,
      (SELECT COUNT(*)::int FROM media_references WHERE last_checked_at IS NULL OR last_checked_at < NOW() - INTERVAL '7 days') AS media_stale,
      (SELECT COUNT(*)::int FROM search_documents d
         JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
         WHERE d.status = 'active') AS indexed,
      (SELECT COUNT(*)::int FROM search_index_events WHERE consumed_at IS NULL) AS index_pending,
      (SELECT COUNT(*)::int FROM search_index_events WHERE last_error_code IS NOT NULL AND consumed_at IS NOT NULL) AS index_failed
  `);
  const row = result.rows[0];
  return {
    catalog: {
      total: row.total,
      published: row.published,
      draft: row.draft,
      archived: row.archived,
      pendingReview: row.duplicate_candidates,
    },
    metadata: {
      missingSynopsis: row.missing_synopsis,
      missingRelease: row.missing_release,
      missingGenre: row.missing_genre,
      missingCountry: row.missing_country,
      duplicateCandidates: row.duplicate_candidates,
    },
    artwork: {
      missingPosters: row.missing_posters,
      missingBackdrops: row.missing_backdrops,
    },
    media: {
      available: row.media_available,
      unavailable: row.media_unavailable,
      stale: row.media_stale,
    },
    search: {
      indexed: row.indexed,
      pending: row.index_pending,
      failed: row.index_failed,
    },
  };
}

export async function validateMovie(id) {
  const result = await getPool().query(
    `SELECT m.canonical_title AS title, m.synopsis, m.release_year, m.release_date, m.status,
            (SELECT COUNT(*)::int FROM movie_genres g WHERE g.movie_id = m.id) AS genre_count,
            (SELECT COUNT(*)::int FROM movie_images i WHERE i.movie_id = m.id AND i.image_type = 'poster') AS poster_count
     FROM movies m WHERE m.id = $1`,
    [id],
  );
  if (!result.rowCount) throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
  const row = result.rows[0];
  const issues = publicationIssues({
    title: row.title,
    synopsis: row.synopsis,
    releaseYear: row.release_year,
    releaseDate: row.release_date,
    genreCount: row.genre_count,
    posterCount: row.poster_count,
  });
  return { id, status: row.status, issues, ready: issues.length === 0 };
}

export async function listReviews() {
  const result = await getPool().query(
    `SELECT r.id, r.external_id, r.confidence, r.status, r.signals, r.created_at,
            m.id AS movie_id, m.slug, m.canonical_title, m.release_year
     FROM ingestion_reviews r
     JOIN movies m ON m.id = r.candidate_movie_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at DESC
     LIMIT 50`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    externalId: row.external_id,
    confidence: row.confidence,
    status: row.status,
    signals: row.signals,
    createdAt: row.created_at,
    movie: {
      id: row.movie_id,
      slug: row.slug,
      title: row.canonical_title,
      releaseYear: row.release_year,
    },
  }));
}

export async function decideReview(actorId, id, action) {
  const status = action === 'reject' ? 'rejected' : 'accepted';
  const result = await getPool().query(
    `UPDATE ingestion_reviews SET status = $2
     WHERE id = $1 AND status = 'pending'
     RETURNING id, status`,
    [id, status],
  );
  if (!result.rowCount) throw new AppError('Review not found', { status: 404, code: 'NOT_FOUND' });
  await recordAudit(null, {
    actorId,
    action: status === 'rejected' ? 'REVIEW_REJECTED' : 'REVIEW_ACCEPTED',
    targetType: 'review',
    targetId: id,
  });
  return result.rows[0];
}

export async function queueMovieRefresh(id) {
  const movie = await getPool().query('SELECT id FROM movies WHERE id = $1', [id]);
  if (!movie.rowCount) throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
  const result = await getPool().query(
    `SELECT e.external_id, s.id, s.slug, s.name
     FROM external_identifiers e
     JOIN catalog_sources s ON s.id = e.catalog_source_id
     WHERE e.movie_id = $1 AND s.status = 'active'
     LIMIT 1`,
    [id],
  );
  if (!result.rowCount) {
    throw new AppError('This movie has no source to refresh', { status: 409, code: 'NO_SOURCE' });
  }
  const source = result.rows[0];
  const queued = await enqueueIngestion({
    source: { id: source.id, slug: source.slug, name: source.name },
    externalId: source.external_id,
    operation: 'refresh',
    jobType: 'metadata:fetch',
    payload: { movieId: id },
  });
  return { queued: true, created: queued.created, jobId: queued.job.id };
}

export async function findSlugRedirect(slug) {
  const result = await getPool().query(
    `SELECT m.slug
     FROM movie_slug_redirects r
     JOIN movies m ON m.id = r.movie_id
     WHERE r.slug = $1 AND m.status = 'active'`,
    [slug],
  );
  return result.rows[0]?.slug || null;
}

export async function mergeMovies(actorId, keeperId, sourceId) {
  if (keeperId === sourceId) {
    throw new AppError('Choose two different movies', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const slugs = await withTransaction(async (client) => {
    const rows = await client.query(
      `SELECT id, slug, canonical_title, status FROM movies WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [[keeperId, sourceId]],
    );
    if (rows.rowCount !== 2) throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
    const keeper = rows.rows.find((row) => row.id === keeperId);
    const source = rows.rows.find((row) => row.id === sourceId);
    const retired = `${source.slug}-merged`;
    await client.query(
      `UPDATE external_identifiers SET movie_id = $1
       WHERE movie_id = $2
         AND NOT EXISTS (
           SELECT 1 FROM external_identifiers keeper
           WHERE keeper.movie_id = $1 AND keeper.catalog_source_id = external_identifiers.catalog_source_id
         )`,
      [keeperId, sourceId],
    );
    await client.query(
      `INSERT INTO movie_genres (movie_id, genre_id)
       SELECT $1, genre_id FROM movie_genres WHERE movie_id = $2
       ON CONFLICT DO NOTHING`,
      [keeperId, sourceId],
    );
    await client.query(
      `UPDATE media_references SET movie_id = $1 WHERE movie_id = $2`,
      [keeperId, sourceId],
    );
    await client.query(
      `UPDATE collection_movies SET movie_id = $1
       WHERE movie_id = $2
         AND NOT EXISTS (SELECT 1 FROM collection_movies WHERE movie_id = $1)`,
      [keeperId, sourceId],
    );
    await client.query(
      `UPDATE movies
       SET slug = $2, status = 'archived', archived_at = COALESCE(archived_at, NOW())
       WHERE id = $1`,
      [sourceId, retired],
    );
    await client.query(
      `INSERT INTO movie_slug_redirects (slug, movie_id) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET movie_id = EXCLUDED.movie_id`,
      [source.slug, keeperId],
    );
    await client.query(
      `UPDATE ingestion_reviews SET status = 'rejected'
       WHERE candidate_movie_id = $1 AND status = 'pending'`,
      [sourceId],
    );
    await recordAudit(client, {
      actorId,
      action: 'MOVIE_MERGED',
      targetType: 'movie',
      targetId: keeperId,
      metadata: { sourceId, retiredSlug: retired },
    });
    return { keeper: keeper.slug, source: source.slug };
  });
  await invalidateCatalogCache({ slug: slugs.keeper });
  await invalidateCatalogCache({ slug: slugs.source });
  await upsertMovieDocuments([keeperId, sourceId]);
  return { keeperId, sourceId, redirectFrom: slugs.source, redirectTo: slugs.keeper };
}
