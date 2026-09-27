import { catalogQuery } from '../db.js';

export async function listImagesForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT mi.image_type, mi.url, mi.width, mi.height, mi.priority,
            l.code AS language_code, l.name AS language_name
     FROM movie_images mi
     LEFT JOIN languages l ON l.id = mi.language_id
     WHERE mi.movie_id = $1
     ORDER BY mi.image_type ASC, mi.priority ASC, mi.created_at ASC`,
    [movieId],
  );
  return result.rows;
}

export async function listVideosForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT mv.video_type, mv.host_name, mv.external_id, mv.url, mv.official,
            mv.duration_seconds, mv.priority,
            l.code AS language_code, l.name AS language_name
     FROM movie_videos mv
     LEFT JOIN languages l ON l.id = mv.language_id
     WHERE mv.movie_id = $1 AND mv.available = TRUE
     ORDER BY mv.priority ASC, mv.created_at ASC`,
    [movieId],
  );
  return result.rows;
}

export async function listRatingsForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT r.label, r.value, r.scale, r.vote_count, s.slug AS source_slug, s.name AS source_name
     FROM movie_ratings r
     LEFT JOIN catalog_sources s ON s.id = r.catalog_source_id
     WHERE r.movie_id = $1
     ORDER BY r.label ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    label: row.label,
    value: Number(row.value),
    scale: Number(row.scale),
    voteCount: row.vote_count,
    source: row.source_slug ? { slug: row.source_slug, name: row.source_name } : null,
  }));
}

export async function listExternalIdentifiers(movieId) {
  const result = await catalogQuery(
    `SELECT s.slug AS source_slug, s.name AS source_name, e.external_id
     FROM external_identifiers e
     JOIN catalog_sources s ON s.id = e.catalog_source_id
     WHERE e.movie_id = $1
     ORDER BY s.slug ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    source: { slug: row.source_slug, name: row.source_name },
    externalId: row.external_id,
  }));
}

export async function listAvailableMedia(movieId) {
  const result = await catalogQuery(
    `SELECT mr.media_type, mr.quality, mr.availability_status, mr.duration_seconds,
            mr.external_reference, p.slug AS provider_slug, p.name AS provider_name
     FROM media_references mr
     JOIN providers p ON p.id = mr.provider_id
     WHERE mr.movie_id = $1
       AND mr.status = 'available'
       AND p.status = 'active'
       AND p.archived_at IS NULL
     ORDER BY p.slug ASC, mr.quality ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    mediaType: row.media_type,
    quality: row.quality,
    availability: row.availability_status,
    durationSeconds: row.duration_seconds,
    provider: { slug: row.provider_slug, name: row.provider_name },
  }));
}

export async function listMediaSignals(movieId) {
  const result = await catalogQuery(
    `SELECT mr.media_type, mr.status, mr.availability_status, mr.rights_status, mr.metadata,
            p.status AS provider_status, COALESCE(h.status, 'unknown') AS health
     FROM media_references mr
     JOIN providers p ON p.id = mr.provider_id
     LEFT JOIN provider_health h ON h.provider_id = p.id
     WHERE mr.movie_id = $1
       AND p.archived_at IS NULL`,
    [movieId],
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

export async function listDownloadCandidates(movieId) {
  const result = await catalogQuery(
    `SELECT mr.id, mr.media_type, mr.quality, mr.external_reference
     FROM media_references mr
     JOIN providers p ON p.id = mr.provider_id
     WHERE mr.movie_id = $1
       AND mr.status = 'available'
       AND mr.availability_status = 'available'
       AND mr.media_type IN ('download', 'stream')
       AND p.status = 'active'
       AND p.archived_at IS NULL
     ORDER BY CASE mr.media_type WHEN 'download' THEN 0 ELSE 1 END,
              mr.quality DESC NULLS LAST,
              mr.created_at ASC`,
    [movieId],
  );
  return result.rows;
}

export async function markMediaChecked(referenceId) {
  await catalogQuery(
    `UPDATE media_references
     SET last_checked_at = NOW()
     WHERE id = $1 AND status = 'available'`,
    [referenceId],
  );
}
