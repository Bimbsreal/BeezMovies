import { getPool } from '../db/pool.js';
import { classificationReport } from '../catalog/industries.js';
import { seedSafety } from './bootstrap.js';
import { getAdapter } from './registry.js';

const SOURCE_SLUG = 'development-metadata';

function sameList(left, right) {
  const a = [...(left || [])].map(String).sort();
  const b = [...(right || [])].map(String).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function classifyValue(sourceValue, localValue) {
  const sourceEmpty = sourceValue == null || sourceValue === '' || (Array.isArray(sourceValue) && sourceValue.length === 0);
  const localEmpty = localValue == null || localValue === '' || (Array.isArray(localValue) && localValue.length === 0);
  if (sourceEmpty && localEmpty) return 'MISSING';
  const equal = Array.isArray(sourceValue) || Array.isArray(localValue)
    ? sameList(sourceValue, localValue)
    : String(sourceValue) === String(localValue);
  if (equal) return 'MATCH';
  if (localEmpty) return 'SOURCE_NEWER';
  if (sourceEmpty) return 'LOCAL_NEWER';
  return 'CONFLICT';
}

async function one(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows[0];
}

async function many(text, params = []) {
  const result = await getPool().query(text, params);
  return result.rows;
}

async function localByExternalId(externalId) {
  const result = await getPool().query(
    `SELECT m.id, m.slug, m.canonical_title, m.original_title, m.synopsis,
            m.release_year, m.runtime_minutes, m.status,
            ct.code AS content_type,
            l.code AS language,
            COALESCE((
              SELECT array_agg(c.code ORDER BY c.code)
              FROM movie_countries mc
              JOIN countries c ON c.id = mc.country_id
              WHERE mc.movie_id = m.id
            ), '{}') AS countries,
            COALESCE((
              SELECT array_agg(g.name ORDER BY g.name)
              FROM movie_genres mg
              JOIN genres g ON g.id = mg.genre_id
              WHERE mg.movie_id = m.id
            ), '{}') AS genres,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster,
            COALESCE((
              SELECT array_agg(mv.url ORDER BY mv.url)
              FROM movie_videos mv
              WHERE mv.movie_id = m.id AND mv.video_type = 'trailer' AND mv.available = TRUE
            ), '{}') AS trailers
     FROM external_identifiers e
     JOIN movies m ON m.id = e.movie_id
     LEFT JOIN content_types ct ON ct.id = m.content_type_id
     LEFT JOIN languages l ON l.id = m.original_language_id
     WHERE e.external_id = $1
     LIMIT 1`,
    [externalId],
  );
  return result.rows[0] || null;
}

async function compareSource() {
  const adapter = getAdapter(SOURCE_SLUG);
  if (!adapter) {
    return {
      source: SOURCE_SLUG,
      available: false,
      records: [],
      findings: [{ category: 'Other', code: 'MISSING', subject: SOURCE_SLUG, detail: 'No metadata adapter is registered.' }],
    };
  }
  const page = await adapter.listPage({ limit: 25 });
  const records = [];
  const findings = [];
  for (const item of page.items) {
    const source = await adapter.getMovie(item.externalId);
    const ids = [source.externalId, ...(source.crossIdentifiers || []).map((entry) => entry.externalId)];
    let local = null;
    for (const externalId of ids) {
      local = await localByExternalId(externalId);
      if (local) break;
    }
    if (!local) {
      records.push({ externalId: source.externalId, slug: null, fields: [{ field: 'record', classification: 'MISSING' }] });
      findings.push({
        category: 'Other',
        code: 'MISSING',
        subject: source.externalId,
        detail: 'Source record is not in the catalog and was not inserted.',
      });
      continue;
    }
    const year = source.releaseDate ? Number(String(source.releaseDate).slice(0, 4)) : null;
    const fields = [
      ['title', source.title, local.canonical_title],
      ['originalTitle', source.originalTitle || null, local.original_title],
      ['synopsis', source.synopsis || null, local.synopsis],
      ['year', year, local.release_year],
      ['runtime', source.runtimeMinutes ?? null, local.runtime_minutes],
      ['country', source.countries || [], local.countries],
      ['language', source.originalLanguage || null, local.language],
      ['genre', source.genres || [], local.genres],
      ['artwork', source.images?.find((image) => image.type === 'poster')?.url || null, local.poster],
      ['trailer', (source.videos || []).filter((video) => video.type === 'trailer').map((video) => video.url), local.trailers],
    ].map(([field, sourceValue, localValue]) => ({
      field,
      classification: classifyValue(sourceValue, localValue),
    }));
    if (!source.contentType && local.content_type) {
      fields.push({ field: 'contentType', classification: 'LOCAL_NEWER' });
    } else if (source.contentType && source.contentType !== local.content_type) {
      fields.push({ field: 'contentType', classification: 'CONFLICT' });
      findings.push({
        category: 'Content-Type Conflict',
        code: 'CONFLICT',
        subject: local.slug,
        detail: 'Source content type does not match the stored content type. It was not overwritten.',
      });
    }
    for (const field of fields) {
      if (field.classification === 'CONFLICT' && field.field === 'country') {
        findings.push({
          category: 'Country Conflict',
          code: 'CONFLICT',
          subject: local.slug,
          detail: 'Source country does not match the stored country. It was not overwritten.',
        });
      } else if (field.classification === 'CONFLICT' && field.field === 'artwork') {
        findings.push({
          category: 'Artwork',
          code: 'CONFLICT',
          subject: local.slug,
          detail: 'Source poster does not match the stored poster. It was not overwritten.',
        });
      } else if (field.classification === 'CONFLICT' && (field.field === 'trailer')) {
        findings.push({
          category: 'Media',
          code: 'CONFLICT',
          subject: local.slug,
          detail: 'Source trailer does not match the stored trailer. It was not overwritten.',
        });
      } else if (field.classification === 'CONFLICT') {
        findings.push({
          category: 'Other',
          code: 'CONFLICT',
          subject: local.slug,
          detail: `${field.field} differs between the source and the catalog and was not overwritten.`,
        });
      }
    }
    records.push({ externalId: source.externalId, slug: local.slug, fields });
  }
  return { source: SOURCE_SLUG, available: true, discovered: page.total, records, findings };
}

export async function catalogReconciliation() {
  const safety = await seedSafety();
  const [totals, report, labels, series, movies, search, media, homepage, reviews] = await Promise.all([
    one(
      `SELECT
         (SELECT COUNT(*)::int FROM movies m JOIN content_types t ON t.id = m.content_type_id AND t.code = 'movie' WHERE m.archived_at IS NULL) AS movies,
         (SELECT COUNT(*)::int FROM movies m JOIN content_types t ON t.id = m.content_type_id AND t.code = 'series' WHERE m.archived_at IS NULL) AS series,
         (SELECT COUNT(*)::int FROM seasons) AS seasons,
         (SELECT COUNT(*)::int FROM episodes) AS episodes,
         (SELECT COUNT(*)::int FROM countries) AS countries,
         (SELECT COUNT(*)::int FROM genres) AS genres,
         (SELECT COUNT(*)::int FROM languages) AS languages,
         (SELECT COUNT(*)::int FROM collections) AS collections`,
    ),
    classificationReport(),
    many(
      `SELECT c.code, t.code AS type_code, l.label, l.origin,
              (s.stem || ' ' || t.plural_name) AS expected,
              (l.origin = 'override' OR l.label = s.stem || ' ' || t.plural_name) AS aligned
       FROM industry_labels l
       JOIN industry_stems s ON s.country_id = l.country_id
       JOIN countries c ON c.id = l.country_id
       JOIN content_types t ON t.id = l.content_type_id
       WHERE l.active = TRUE
       ORDER BY c.code, t.code`,
    ),
    one(
      `SELECT
         (SELECT COUNT(*)::int FROM seasons s
           WHERE NOT EXISTS (
             SELECT 1 FROM movies m
             JOIN content_types t ON t.id = m.content_type_id AND t.code = 'series'
             WHERE m.id = s.series_id
           )) AS orphan_seasons,
         (SELECT COUNT(*)::int FROM episodes e
           WHERE NOT EXISTS (SELECT 1 FROM seasons s WHERE s.id = e.season_id)) AS orphan_episodes,
         (SELECT COUNT(*)::int FROM (
            SELECT series_id, season_number FROM seasons GROUP BY series_id, season_number HAVING COUNT(*) > 1
          ) d) AS duplicate_seasons,
         (SELECT COUNT(*)::int FROM (
            SELECT season_id, episode_number FROM episodes GROUP BY season_id, episode_number HAVING COUNT(*) > 1
          ) d) AS duplicate_episodes,
         (SELECT COUNT(*)::int FROM seasons WHERE season_number IS NULL) AS missing_season_numbers,
         0::int AS series_missing_source_episodes`,
    ),
    one(
      `SELECT
         (SELECT COUNT(*)::int FROM (
            SELECT catalog_source_id, external_id FROM external_identifiers
            GROUP BY catalog_source_id, external_id HAVING COUNT(*) > 1
          ) d) AS duplicate_external_ids,
         (SELECT COUNT(*)::int FROM (
            SELECT normalized_title, release_year FROM movies
            WHERE archived_at IS NULL
            GROUP BY normalized_title, release_year HAVING COUNT(*) > 1
          ) d) AS duplicate_titles,
         (SELECT COUNT(*)::int FROM movies WHERE archived_at IS NULL AND btrim(canonical_title) = '') AS missing_titles,
         (SELECT COUNT(*)::int FROM movies WHERE archived_at IS NULL AND release_year IS NOT NULL AND release_year NOT BETWEEN 1888 AND 2100) AS invalid_years,
         (SELECT COUNT(*)::int FROM movies m
           WHERE m.status = 'active' AND m.archived_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM movie_images i
               WHERE i.movie_id = m.id AND i.image_type = 'poster' AND i.url LIKE 'https://%'
             )) AS missing_artwork,
         (SELECT COUNT(*)::int FROM movies m
           WHERE m.archived_at IS NULL AND m.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM movie_countries mc WHERE mc.movie_id = m.id)) AS missing_country,
         (SELECT COUNT(*)::int FROM movies m
           WHERE m.archived_at IS NULL AND m.content_type_id IS NULL) AS missing_content_type`,
    ),
    one(
      `SELECT
         (SELECT COUNT(*)::int FROM movies m
           WHERE m.status = 'active' AND m.archived_at IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM search_documents d
               JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
               WHERE d.movie_id = m.id AND d.status = 'active'
             )) AS missing_index,
         (SELECT COUNT(*)::int FROM search_documents d
           JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
           JOIN movies m ON m.id = d.movie_id
           WHERE d.status = 'active' AND (m.status <> 'active' OR m.archived_at IS NOT NULL)) AS unpublished,
         (SELECT COUNT(*)::int FROM (
            SELECT d.slug FROM search_documents d
            JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
            GROUP BY d.slug HAVING COUNT(*) > 1
          ) d) AS duplicate_documents,
         (SELECT COUNT(*)::int FROM search_documents d
           JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
           JOIN movies m ON m.id = d.movie_id
           WHERE d.title <> m.canonical_title
              OR d.content_type_code IS DISTINCT FROM (
                SELECT t.code FROM content_types t WHERE t.id = m.content_type_id
              )) AS stale`,
    ),
    many(
      `SELECT m.slug, t.code AS content_type,
              (SELECT COUNT(*)::int FROM media_references mr
                WHERE mr.movie_id = m.id AND mr.episode_id IS NULL
                  AND mr.media_type = 'download' AND mr.rights_status = 'AUTHORIZED'
                  AND mr.availability_status = 'available') AS authorized_downloads,
              (SELECT COUNT(*)::int FROM movie_videos mv
                WHERE mv.movie_id = m.id AND mv.video_type = 'trailer' AND mv.available = TRUE) AS trailers,
              m.status = 'active' AS catalog_available
       FROM movies m
       LEFT JOIN content_types t ON t.id = m.content_type_id
       WHERE m.archived_at IS NULL
       ORDER BY m.slug`,
    ),
    one(
      `SELECT COUNT(*)::int AS stale
       FROM homepage_rails r
       JOIN collections c ON c.slug = r.source_slug
       JOIN collection_movies cm ON cm.collection_id = c.id
       JOIN movies m ON m.id = cm.movie_id
       WHERE r.enabled = TRUE AND r.source_type = 'collection'
         AND (m.status <> 'active' OR m.archived_at IS NOT NULL OR m.content_type_id IS NULL)`,
    ),
    one(
      `SELECT
         (SELECT COUNT(*)::int FROM country_reviews WHERE status = 'pending') AS country,
         (SELECT COUNT(*)::int FROM classification_reviews WHERE status = 'pending') AS classification,
         (SELECT COUNT(*)::int FROM ingestion_reviews WHERE status = 'pending') AS duplicates`,
    ),
  ]);
  const source = await compareSource();
  const labelMismatches = labels.filter((row) => row.aligned !== true);
  const findings = [...source.findings];
  if (movies.missing_artwork > 0) {
    findings.push({
      category: 'Artwork',
      code: 'MISSING',
      subject: 'posters',
      detail: `${movies.missing_artwork} published title has no usable poster.`,
    });
  }
  if (search.missing_index > 0 || search.stale > 0 || search.unpublished > 0 || search.duplicate_documents > 0) {
    findings.push({
      category: 'Search',
      code: 'CONFLICT',
      subject: 'search-index',
      detail: 'Search index does not match the catalog. It was not rebuilt because no recovery point is recorded.',
    });
  }
  const conflicts = findings.filter((item) => item.code === 'CONFLICT').length;
  const missing = findings.filter((item) => item.code === 'MISSING').length;
  const fieldRows = source.records.flatMap((record) => record.fields);
  const matches = fieldRows.filter((field) => field.classification === 'MATCH').length;
  return {
    recovery: {
      backup: safety.backup,
      automaticAllowed: safety.backup === 'HEALTHY' && safety.applyAllowed === true,
      updated: 0,
      reason: safety.backup === 'HEALTHY'
        ? 'Production publication remains closed.'
        : 'A verified database backup is not recorded, so no automatic reconciliation ran.',
    },
    totals,
    countries: report.countries,
    contentTypes: [...new Set(report.countries.flatMap((country) => country.types.map((type) => type.code)))],
    industry: {
      checked: labels.length,
      mismatches: labelMismatches.map((row) => ({
        country: row.code,
        type: row.type_code,
        label: row.label,
        expected: row.expected,
        origin: row.origin,
      })),
      labels: labels.map((row) => ({
        country: row.code,
        type: row.type_code,
        label: row.label,
        origin: row.origin,
        aligned: row.aligned === true,
      })),
    },
    seriesIntegrity: series,
    movieIntegrity: movies,
    metadata: source,
    media,
    search,
    homepage: { staleCollectionItems: homepage.stale },
    duplicates: movies.duplicate_external_ids + movies.duplicate_titles + search.duplicate_documents,
    conflicts,
    review: {
      country: reviews.country,
      classification: reviews.classification,
      duplicates: reviews.duplicates,
      computed: findings,
    },
    summary: {
      checked: totals.movies + totals.series + totals.seasons + totals.episodes + (source.discovered || 0),
      matches,
      updated: 0,
      missing,
      duplicates: movies.duplicate_external_ids + movies.duplicate_titles,
      conflicts,
      reviewRequired: findings.length + reviews.country + reviews.classification + reviews.duplicates,
      invalid: movies.missing_titles + movies.invalid_years + movies.missing_country + movies.missing_content_type + series.orphan_seasons + series.orphan_episodes,
      searchMismatches: search.missing_index + search.stale + search.unpublished + search.duplicate_documents,
      mediaMismatches: findings.filter((item) => item.category === 'Media').length,
    },
  };
}
