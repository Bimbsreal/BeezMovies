import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { invalidateCatalogCache } from './admin.js';
import { getMovieList } from './service.js';

const uuid = z.string().uuid();
const aliasText = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(?:[ -][a-z0-9]+)*$/).max(80);

const COUNTRY_SELECT = `
  c.id, c.code, c.name, c.slug, c.display_name, c.rail_title, c.region, c.active, c.priority,
  (
    SELECT COUNT(*)::int
    FROM movie_countries mc
    JOIN movies m ON m.id = mc.movie_id
    WHERE mc.country_id = c.id AND m.status = 'active' AND m.archived_at IS NULL
  ) AS movie_count
`;

function present(row, aliases = [], genres = undefined) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    slug: row.slug,
    displayName: row.display_name,
    railTitle: row.rail_title,
    region: row.region,
    active: row.active,
    priority: row.priority,
    movieCount: row.movie_count,
    aliases,
    ...(genres ? { genres } : {}),
  };
}

async function genresForCountry(countryId) {
  const result = await getPool().query(
    `SELECT g.slug, g.name, COUNT(DISTINCT m.id)::int AS movie_count
     FROM genres g
     JOIN movie_genres mg ON mg.genre_id = g.id
     JOIN movies m ON m.id = mg.movie_id AND m.status = 'active' AND m.archived_at IS NULL
     JOIN movie_countries mc ON mc.movie_id = m.id AND mc.country_id = $1
     GROUP BY g.id, g.slug, g.name
     HAVING COUNT(DISTINCT m.id) > 0
     ORDER BY g.name ASC`,
    [countryId],
  );
  return result.rows.map((row) => ({
    slug: row.slug,
    name: row.name,
    movieCount: row.movie_count,
  }));
}

export async function listCountries({ activeOnly = false, withMovies = false } = {}) {
  const result = await getPool().query(
    `SELECT ${COUNTRY_SELECT}
     FROM countries c
     WHERE ($1::boolean = FALSE OR c.active = TRUE)
     ORDER BY c.region ASC, c.display_name ASC`,
    [activeOnly],
  );
  const aliasRows = await getPool().query(
    'SELECT country_id, alias FROM country_aliases ORDER BY alias ASC',
  );
  const aliases = new Map();
  for (const row of aliasRows.rows) {
    const list = aliases.get(row.country_id) || [];
    list.push(row.alias);
    aliases.set(row.country_id, list);
  }
  return result.rows
    .map((row) => present(row, aliases.get(row.id) || []))
    .filter((row) => !withMovies || row.movieCount > 0);
}

export async function getCountryBySlug(slug, { activeOnly = true } = {}) {
  const result = await getPool().query(
    `SELECT ${COUNTRY_SELECT}
     FROM countries c
     WHERE c.slug = $1 AND ($2::boolean = FALSE OR c.active = TRUE)`,
    [slug, activeOnly],
  );
  if (!result.rowCount) {
    throw new AppError('Country not found', { status: 404, code: 'NOT_FOUND' });
  }
  const genres = await genresForCountry(result.rows[0].id);
  return present(result.rows[0], [], genres);
}

export async function countryMovies(slug, query) {
  const country = await getCountryBySlug(slug);
  const page = await getMovieList({
    ...query,
    country: country.code,
    status: undefined,
  }, null);
  return { country, ...page };
}

export async function countryQuality() {
  const result = await getPool().query(`
    SELECT
      (SELECT COUNT(*)::int FROM movies m
        WHERE m.status = 'active' AND m.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM movie_countries mc WHERE mc.movie_id = m.id)) AS missing_country,
      (SELECT COUNT(*)::int FROM country_reviews WHERE status = 'pending' AND reason = 'unknown') AS unknown_country,
      (SELECT COUNT(*)::int FROM country_reviews WHERE status = 'pending' AND reason = 'invalid') AS invalid_country,
      (SELECT COUNT(*)::int FROM country_reviews WHERE status = 'pending' AND reason = 'conflict') AS conflicting_country,
      (SELECT COUNT(*)::int FROM (
         SELECT movie_id, country_id FROM movie_countries
         GROUP BY movie_id, country_id
         HAVING COUNT(*) > 1
       ) duplicates) AS duplicate_relationships
  `);
  const row = result.rows[0];
  return {
    missingCountry: row.missing_country,
    unknownCountry: row.unknown_country,
    invalidCountry: row.invalid_country,
    conflictingCountry: row.conflicting_country,
    duplicateRelationships: row.duplicate_relationships,
  };
}

export async function countrySeedReport() {
  const countries = await listCountries();
  const reviews = await getPool().query(
    `SELECT raw_code, reason, COUNT(*)::int AS total
     FROM country_reviews
     WHERE status = 'pending'
     GROUP BY raw_code, reason`,
  );
  const reviewByCode = new Map();
  for (const row of reviews.rows) {
    reviewByCode.set(row.raw_code, (reviewByCode.get(row.raw_code) || 0) + row.total);
  }
  return countries.map((country) => ({
    country: country.displayName,
    code: country.code,
    slug: country.slug,
    discovered: null,
    valid: null,
    duplicate: null,
    published: country.movieCount,
    review: reviewByCode.get(country.code) || 0,
    failed: null,
  }));
}

export async function setCountryActive(id, active) {
  const result = await getPool().query(
    `UPDATE countries SET active = $2 WHERE id = $1 RETURNING slug`,
    [id, active],
  );
  if (!result.rowCount) throw new AppError('Country not found', { status: 404, code: 'NOT_FOUND' });
  await invalidateCatalogCache();
  return getCountryBySlug(result.rows[0].slug, { activeOnly: false });
}

export async function addCountryAlias(id, alias) {
  const country = await getPool().query('SELECT id FROM countries WHERE id = $1', [id]);
  if (!country.rowCount) throw new AppError('Country not found', { status: 404, code: 'NOT_FOUND' });
  try {
    await getPool().query(
      'INSERT INTO country_aliases (country_id, alias) VALUES ($1, $2)',
      [id, alias],
    );
  } catch (error) {
    if (error.code === '23505') {
      throw new AppError('That alias already belongs to a country', { status: 409, code: 'CONFLICT' });
    }
    throw error;
  }
  await invalidateCatalogCache();
  const row = await getPool().query('SELECT slug FROM countries WHERE id = $1', [id]);
  return getCountryBySlug(row.rows[0].slug, { activeOnly: false });
}

export const countryPatchSchema = z.object({
  body: z.object({ active: z.boolean() }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});

export const countryAliasSchema = z.object({
  body: z.object({ alias: aliasText }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: uuid }).strict(),
});
