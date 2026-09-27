import { getPool } from '../db/pool.js';
import { classificationReport } from '../catalog/industries.js';
import { seedSafety } from './bootstrap.js';
import { getAdapter } from './registry.js';

const FOCUS = ['NG', 'GH', 'ZA', 'GB', 'US', 'RU', 'CN', 'TR'];

export async function productionCatalogStatus() {
  const [safety, report, totals, gaps, sources, batch, constraints, countryRows] = await Promise.all([
    seedSafety(),
    classificationReport(),
    getPool().query(
      `SELECT
         (SELECT COUNT(*)::int FROM movies m
           JOIN content_types t ON t.id = m.content_type_id AND t.code = 'movie'
           WHERE m.status = 'active' AND m.archived_at IS NULL) AS movies,
         (SELECT COUNT(*)::int FROM movies m
           JOIN content_types t ON t.id = m.content_type_id AND t.code = 'series'
           WHERE m.status = 'active' AND m.archived_at IS NULL) AS series,
         (SELECT COUNT(*)::int FROM seasons) AS seasons,
         (SELECT COUNT(*)::int FROM episodes) AS episodes,
         (SELECT COUNT(*)::int FROM ingestion_reviews WHERE status = 'pending') AS duplicates,
         (SELECT COUNT(*)::int FROM classification_reviews WHERE status = 'pending') AS review_required`,
    ),
    getPool().query(
      `SELECT
         (SELECT COUNT(*)::int FROM movies m
           WHERE m.archived_at IS NULL AND m.content_type_id IS NULL) AS missing_type,
         (SELECT COUNT(*)::int FROM movies m
           WHERE m.archived_at IS NULL AND m.status = 'active'
             AND NOT EXISTS (SELECT 1 FROM movie_countries mc WHERE mc.movie_id = m.id)) AS missing_country,
         (SELECT COUNT(*)::int FROM classification_reviews WHERE status = 'pending' AND field = 'content_type') AS type_conflicts,
         (SELECT COUNT(*)::int FROM country_reviews WHERE status = 'pending') AS country_reviews`,
    ),
    getPool().query(
      `SELECT s.name, s.slug, s.status, s.last_synchronized_at,
              r.health_status, r.requests_per_minute, r.concurrency_limit, r.min_interval_ms,
              r.last_success_at, r.success_count, r.error_count
       FROM catalog_sources s
       LEFT JOIN catalog_source_runtime r ON r.catalog_source_id = s.id
       WHERE s.archived_at IS NULL
       ORDER BY s.slug`,
    ),
    getPool().query(
      `SELECT id, source_slug, status, processed, valid_count, duplicate_count, review_count,
              invalid_count, failed_count, published_count, started_at, finished_at
       FROM catalog_seed_runs
       ORDER BY started_at DESC
       LIMIT 1`,
    ),
    getPool().query(
      `SELECT conname
       FROM pg_constraint
       WHERE conname IN (
         'movies_slug_key',
         'seasons_number_key',
         'episodes_number_key',
         'episodes_slug_key',
         'movies_active_classification_check'
       )
       ORDER BY conname`,
    ),
    getPool().query(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE active = TRUE)::int AS active
       FROM countries`,
    ),
  ]);
  const row = totals.rows[0];
  const gap = gaps.rows[0];
  const countries = report.countries.map((country) => ({
    ...country,
    focus: FOCUS.includes(country.code),
    published: country.types.reduce((sum, type) => sum + type.published, 0),
  }));
  return {
    seeding: {
      applyAllowed: safety.applyAllowed,
      backup: safety.backup,
      reasons: safety.reasons,
      batch: batch.rows[0] ? {
        id: batch.rows[0].id,
        source: batch.rows[0].source_slug,
        status: batch.rows[0].status,
        processed: batch.rows[0].processed,
        valid: batch.rows[0].valid_count,
        duplicates: batch.rows[0].duplicate_count,
        review: batch.rows[0].review_count,
        rejected: batch.rows[0].invalid_count,
        failed: batch.rows[0].failed_count,
        published: batch.rows[0].published_count,
        startedAt: batch.rows[0].started_at,
        finishedAt: batch.rows[0].finished_at,
      } : null,
    },
    totals: {
      movies: row.movies,
      series: row.series,
      seasons: row.seasons,
      episodes: row.episodes,
    },
    duplicates: row.duplicates,
    reviewRequired: row.review_required,
    gaps: {
      missingContentType: gap.missing_type,
      missingCountry: gap.missing_country,
      contentTypeConflicts: gap.type_conflicts,
      countryReviews: gap.country_reviews,
    },
    contentTypes: [...new Set(countries.flatMap((country) => country.types.map((type) => type.code)))],
    countryRows: countryRows.rows[0],
    countries,
    sources: sources.rows.map((source) => {
      const adapter = getAdapter(source.slug);
      return {
        name: source.name,
        identifier: source.slug,
        status: source.status,
        health: source.health_status,
        authentication: adapter?.descriptor?.authentication || 'not-configured',
        requestsPerMinute: source.requests_per_minute,
        concurrency: source.concurrency_limit,
        minIntervalMs: source.min_interval_ms,
        lastSuccessAt: source.last_success_at,
        lastSynchronizedAt: source.last_synchronized_at,
        successCount: Number(source.success_count) || 0,
        errorCount: Number(source.error_count) || 0,
        records: adapter ? 'local-adapter' : 'none',
      };
    }),
    constraints: constraints.rows.map((item) => item.conname),
    sourceNote: report.sourceNote,
  };
}
