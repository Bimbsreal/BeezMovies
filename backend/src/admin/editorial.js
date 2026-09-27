import { getPool } from '../db/pool.js';
import { catalogReconciliation } from '../ingestion/reconcile.js';

async function rows(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

export async function editorialQueue() {
  const [metadata, countries, duplicates, languages, artwork, media, takedowns, classification] = await Promise.all([
    rows(
      `SELECT m.slug, m.canonical_title AS title
       FROM movies m
       WHERE m.status = 'active'
         AND (
           m.synopsis IS NULL OR btrim(m.synopsis) = ''
           OR NOT EXISTS (SELECT 1 FROM movie_genres g WHERE g.movie_id = m.id)
           OR NOT EXISTS (SELECT 1 FROM movie_countries c WHERE c.movie_id = m.id)
         )
       ORDER BY m.canonical_title
       LIMIT 20`,
    ),
    rows(
      `SELECT raw_code AS code, reason, status
       FROM country_reviews
       WHERE status = 'pending'
       ORDER BY created_at DESC
       LIMIT 20`,
    ),
    rows(
      `SELECT r.external_id AS externalId, m.slug
       FROM ingestion_reviews r
       JOIN movies m ON m.id = r.candidate_movie_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 20`,
    ),
    rows(
      `SELECT slug, canonical_title AS title
       FROM movies
       WHERE status = 'active' AND original_language_id IS NULL
       ORDER BY canonical_title
       LIMIT 20`,
    ),
    rows(
      `SELECT m.slug, m.canonical_title AS title
       FROM movies m
       WHERE m.status = 'active'
         AND (
           NOT EXISTS (
             SELECT 1 FROM movie_images i
             WHERE i.movie_id = m.id AND i.image_type = 'poster' AND i.url LIKE 'https://%'
           )
           OR EXISTS (
             SELECT 1 FROM movie_images i
             WHERE i.movie_id = m.id AND i.image_type = 'poster'
               AND (i.width IS NULL OR i.height IS NULL OR i.width < 1 OR i.height < 1)
           )
         )
       ORDER BY m.canonical_title
       LIMIT 20`,
    ),
    rows(
      `SELECT m.slug, mr.rights_status AS rights, mr.availability_status AS availability
       FROM media_references mr
       JOIN movies m ON m.id = mr.movie_id
       WHERE mr.rights_status IN ('PENDING_REVIEW', 'UNAVAILABLE', 'REMOVED')
          OR mr.availability_status = 'unavailable'
       ORDER BY m.slug
       LIMIT 20`,
    ),
    rows(
      `SELECT c.case_code AS caseCode, c.status, m.slug
       FROM content_complaints c
       JOIN movies m ON m.id = c.movie_id
       WHERE c.status NOT IN ('RESOLVED', 'REJECTED')
       ORDER BY c.created_at DESC
       LIMIT 20`,
    ),
    rows(
      `SELECT r.field, r.reason, r.raw_value AS raw, m.slug
       FROM classification_reviews r
       LEFT JOIN movies m ON m.id = r.movie_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 20`,
    ),
  ]);

  const reconciliation = await catalogReconciliation();
  return {
    reconciliation,
    missingMetadata: metadata,
    countryConflicts: countries,
    duplicateCandidates: duplicates,
    languageConflicts: languages,
    artwork: artwork,
    providerFailures: media,
    takedowns,
    classification,
  };
}
