import { catalogQuery } from '../catalog/db.js';
import { logger } from '../logger/index.js';

export async function listResolutionCandidates(movieId, options = {}) {
  const episodeId = options.episodeId || null;
  const result = await catalogQuery(
    `SELECT mr.id, mr.movie_id, mr.provider_id, mr.external_reference, mr.media_type,
            mr.quality, mr.file_size_bytes, mr.duration_seconds, mr.availability_status,
            mr.metadata, m.slug AS movie_slug,
            p.slug AS provider_slug, p.status AS provider_status,
            COALESCE((p.capabilities->>'priority')::int, 0) AS priority,
            h.status AS health, h.last_success_at, h.last_checked_at, h.last_error_code
     FROM media_references mr
     JOIN movies m ON m.id = mr.movie_id
     JOIN providers p ON p.id = mr.provider_id
     LEFT JOIN provider_health h ON h.provider_id = p.id
     WHERE mr.movie_id = $1
       AND mr.status = 'available'
       AND mr.availability_status = 'available'
       AND mr.rights_status = 'AUTHORIZED'
       AND p.archived_at IS NULL
       AND (($2::uuid IS NULL AND mr.episode_id IS NULL) OR mr.episode_id = $2::uuid)
     ORDER BY p.slug ASC`,
    [movieId, episodeId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    movieId: row.movie_id,
    movieSlug: row.movie_slug,
    providerId: row.provider_id,
    providerSlug: row.provider_slug,
    providerStatus: row.provider_status,
    external_reference: row.external_reference,
    mediaType: row.media_type,
    quality: row.quality,
    format: row.metadata?.format || null,
    fileSizeBytes: row.file_size_bytes,
    durationSeconds: row.duration_seconds,
    availability: row.availability_status,
    priority: row.priority,
    health: row.health || 'unknown',
    lastSuccessAt: row.last_success_at,
    lastCheckedAt: row.last_checked_at,
    lastErrorCode: row.last_error_code,
  }));
}

export async function findResolutionReference(id) {
  const result = await catalogQuery(
    `SELECT mr.id, mr.movie_id, mr.provider_id, mr.external_reference, mr.media_type,
            mr.quality, mr.status, mr.availability_status, m.slug AS movie_slug,
            p.slug AS provider_slug, p.status AS provider_status
     FROM media_references mr
     JOIN movies m ON m.id = mr.movie_id
     JOIN providers p ON p.id = mr.provider_id
     WHERE mr.id = $1 AND p.archived_at IS NULL`,
    [id],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    movieId: row.movie_id,
    movieSlug: row.movie_slug,
    providerId: row.provider_id,
    providerSlug: row.provider_slug,
    providerStatus: row.provider_status,
    external_reference: row.external_reference,
    mediaType: row.media_type,
    quality: row.quality,
    status: row.status,
    availability: row.availability_status,
  };
}

export async function recordDownloadEvent(event) {
  try {
    await catalogQuery(
      `INSERT INTO download_events (
         movie_id, media_reference_id, provider_id, result, failure_category, duration_ms
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        event.movieId,
        event.mediaReferenceId || null,
        event.providerId || null,
        event.result,
        event.failureCategory || null,
        Number.isInteger(event.durationMs) && event.durationMs >= 0 ? event.durationMs : null,
      ],
    );
  } catch (error) {
    logger.warn({ event: 'DOWNLOAD_EVENT_SKIPPED', code: error.code }, 'DOWNLOAD_EVENT_SKIPPED');
  }
}

export async function recordProviderHealth(providerId, status, errorCode = null) {
  try {
    await catalogQuery(
      `INSERT INTO provider_health (
         provider_id, status, last_checked_at, last_success_at, last_error_code
       ) VALUES ($1, $2, NOW(), CASE WHEN $2 = 'available' THEN NOW() ELSE NULL END, $3)
       ON CONFLICT (provider_id) DO UPDATE SET
         status = EXCLUDED.status,
         last_checked_at = NOW(),
         last_success_at = CASE
           WHEN EXCLUDED.status = 'available' THEN NOW()
           ELSE provider_health.last_success_at
         END,
         last_error_code = EXCLUDED.last_error_code`,
      [providerId, status, errorCode],
    );
  } catch (error) {
    logger.warn({ event: 'PROVIDER_HEALTH_SKIPPED', code: error.code }, 'PROVIDER_HEALTH_SKIPPED');
  }
}
