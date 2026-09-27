import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { invalidateCatalogCache } from './admin.js';
import { listMovies } from './repositories/movies.js';
import { pagination, serializeMovieSummary } from './serializers.js';

const MOVIE_TYPE_ID = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';

export function sourceContentType(value) {
  if (typeof value?.contentType === 'string' && value.contentType.trim()) {
    return value.contentType.trim();
  }
  const identifiers = value?.crossIdentifiers || [];
  if (identifiers.some((item) => String(item?.externalId || '').startsWith('dev-seed:movie:'))) {
    return 'movie';
  }
  return null;
}

export async function contentTypeIdForCode(client, code) {
  if (!code) return null;
  const result = await client.query(
    'SELECT id FROM content_types WHERE code = $1 AND active = TRUE',
    [code],
  );
  return result.rows[0]?.id || null;
}

export async function queueClassification(client, { movieId = null, field, rawValue = null, reason }) {
  await client.query(
    `INSERT INTO classification_reviews (movie_id, field, raw_value, reason)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM classification_reviews
       WHERE status = 'pending'
         AND field = $2
         AND reason = $4
         AND movie_id IS NOT DISTINCT FROM $1
         AND raw_value IS NOT DISTINCT FROM $3
     )`,
    [movieId, field, rawValue, reason],
  );
}

export async function noteClassification(client, movieId, normalized, resolvedTypeId) {
  if (!normalized.countries?.length) {
    await queueClassification(client, { movieId, field: 'country', reason: 'missing' });
  }
  if (!normalized.contentType) {
    await queueClassification(client, { movieId, field: 'content_type', reason: 'missing' });
  } else if (!resolvedTypeId) {
    await queueClassification(client, {
      movieId,
      field: 'content_type',
      rawValue: normalized.contentType,
      reason: 'unknown',
    });
  }
  const stems = await client.query(
    `SELECT COUNT(DISTINCT s.route_slug)::int AS total
     FROM movie_countries mc
     JOIN industry_stems s ON s.country_id = mc.country_id
     WHERE mc.movie_id = $1`,
    [movieId],
  );
  if (stems.rows[0].total > 1) {
    await queueClassification(client, { movieId, field: 'industry_label', reason: 'ambiguous' });
  }
}

export async function listContentTypes() {
  const result = await getPool().query(
    `SELECT t.id, t.code, t.name, t.plural_name, t.route_prefix, t.active, t.sort_order,
            COUNT(m.id) FILTER (WHERE m.status = 'active' AND m.archived_at IS NULL)::int AS published_count
     FROM content_types t
     LEFT JOIN movies m ON m.content_type_id = t.id
     GROUP BY t.id
     ORDER BY t.sort_order ASC, t.code ASC`,
  );
  return result.rows.map(serializeType);
}

export async function classificationReport() {
  const result = await getPool().query(
    `SELECT c.code, c.display_name, c.slug AS country_slug,
            t.code AS type_code, t.plural_name,
            COUNT(m.id) FILTER (WHERE m.status = 'active' AND m.archived_at IS NULL)::int AS published
     FROM countries c
     CROSS JOIN content_types t
     LEFT JOIN movie_countries mc ON mc.country_id = c.id
     LEFT JOIN movies m ON m.id = mc.movie_id AND m.content_type_id = t.id
     WHERE c.active = TRUE
     GROUP BY c.code, c.display_name, c.slug, t.code, t.plural_name, c.priority
     ORDER BY c.priority DESC, c.display_name ASC, t.code ASC`,
  );
  const grouped = new Map();
  for (const row of result.rows) {
    const current = grouped.get(row.code) || {
      country: row.display_name,
      code: row.code,
      slug: row.country_slug,
      types: [],
    };
    current.types.push({
      code: row.type_code,
      name: row.plural_name,
      published: row.published,
    });
    grouped.set(row.code, current);
  }
  return {
    countries: [...grouped.values()],
    sourceNote: 'Series counts are published series records. Seasons and episodes are not seeded.',
  };
}

export async function listIndustryLabels() {
  const result = await getPool().query(
    `SELECT l.id, l.label, l.origin, l.active,
            c.code AS country_code, c.display_name, c.slug AS country_slug,
            s.stem, s.route_slug,
            t.code AS type_code, t.name AS type_name, t.plural_name, t.route_prefix,
            COUNT(m.id) FILTER (WHERE m.status = 'active' AND m.archived_at IS NULL)::int AS published
     FROM industry_labels l
     JOIN countries c ON c.id = l.country_id
     JOIN industry_stems s ON s.country_id = l.country_id
     JOIN content_types t ON t.id = l.content_type_id
     LEFT JOIN movie_countries mc ON mc.country_id = c.id
     LEFT JOIN movies m ON m.id = mc.movie_id AND m.content_type_id = t.id
     GROUP BY l.id, c.code, c.display_name, c.slug, s.stem, s.route_slug, t.code, t.name, t.plural_name, t.route_prefix, t.sort_order
     ORDER BY c.display_name ASC, t.sort_order ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    label: row.label,
    origin: row.origin,
    active: row.active,
    published: row.published,
    country: { code: row.country_code, displayName: row.display_name, slug: row.country_slug },
    contentType: { code: row.type_code, name: row.type_name, pluralName: row.plural_name, routePrefix: row.route_prefix },
    stem: row.stem,
    routeSlug: row.route_slug,
    href: `/${row.route_prefix}/${row.route_slug}`,
  }));
}

export async function listClassificationReviews() {
  const result = await getPool().query(
    `SELECT r.field, r.reason, r.raw_value AS raw, m.slug
     FROM classification_reviews r
     LEFT JOIN movies m ON m.id = r.movie_id
     WHERE r.status = 'pending'
     ORDER BY r.created_at DESC
     LIMIT 20`,
  );
  return result.rows;
}

export async function setContentTypeActive(id, active) {
  const result = await getPool().query(
    `UPDATE content_types SET active = $2 WHERE id = $1 RETURNING code`,
    [id, active],
  );
  if (!result.rowCount) throw new AppError('Content type not found', { status: 404, code: 'NOT_FOUND' });
  await invalidateCatalogCache();
  const types = await listContentTypes();
  return types.find((item) => item.id === id);
}

export async function setIndustryLabel(id, label) {
  const next = label.trim();
  if (next.includes('<') || next.includes('>')) {
    throw new AppError('Label must be plain text', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const result = await getPool().query(
    `UPDATE industry_labels
     SET label = $2, origin = 'override', updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [id, next],
  );
  if (!result.rowCount) throw new AppError('Industry label not found', { status: 404, code: 'NOT_FOUND' });
  await invalidateCatalogCache();
  const labels = await listIndustryLabels();
  return labels.find((item) => item.id === id);
}

export async function industryLabelsForMovie(movieId) {
  const result = await getPool().query(
    `SELECT l.label, s.route_slug, t.route_prefix, c.code
     FROM movies m
     JOIN content_types t ON t.id = m.content_type_id AND t.active = TRUE
     JOIN movie_countries mc ON mc.movie_id = m.id
     JOIN countries c ON c.id = mc.country_id AND c.active = TRUE
     JOIN industry_stems s ON s.country_id = c.id
     JOIN industry_labels l ON l.country_id = c.id AND l.content_type_id = t.id AND l.active = TRUE
     WHERE m.id = $1
     ORDER BY c.display_name ASC`,
    [movieId],
  );
  return result.rows.map((row) => ({
    label: row.label,
    href: `/${row.route_prefix}/${row.route_slug}`,
    countryCode: row.code,
  }));
}

export async function getIndustryPage(slug, query) {
  const stem = await getPool().query(
    `SELECT s.stem, s.route_slug, c.code, c.slug AS country_slug, c.display_name
     FROM industry_stems s
     JOIN countries c ON c.id = s.country_id
     WHERE s.route_slug = $1 AND c.active = TRUE`,
    [slug],
  );
  if (!stem.rowCount) {
    throw new AppError('Industry not found', { status: 404, code: 'NOT_FOUND' });
  }
  const country = stem.rows[0];
  const requested = query.type || 'movie';
  const typeResult = await getPool().query(
    `SELECT id, code, name, plural_name, route_prefix, active
     FROM content_types
     WHERE code = $1`,
    [requested],
  );
  const type = typeResult.rows[0] || null;
  if (!type || !type.active) {
    return {
      data: [],
      pagination: pagination(query.page, query.limit, 0),
      industry: {
        slug: country.route_slug,
        stem: country.stem,
        label: null,
        country: { code: country.code, slug: country.country_slug, displayName: country.display_name },
      },
      contentType: null,
      genres: [],
      note: 'This content type is not in the approved source.',
      indexable: false,
      canonicalPath: `/movies/${country.country_slug}`,
    };
  }
  const labelResult = await getPool().query(
    `SELECT label FROM industry_labels
     WHERE country_id = (SELECT id FROM countries WHERE code = $1)
       AND content_type_id = $2
       AND active = TRUE`,
    [country.code, type.id],
  );
  const filters = {
    statuses: ['active'],
    country: country.code,
    contentType: type.code,
    genre: query.genre,
    year: query.year,
    sort: query.sort || 'popularity',
    order: query.order || 'desc',
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    page: query.page,
  };
  const listed = await listMovies(filters);
  const genres = await getPool().query(
    `SELECT DISTINCT g.slug, g.name
     FROM movies m
     JOIN content_types t ON t.id = m.content_type_id AND t.code = $2
     JOIN movie_countries mc ON mc.movie_id = m.id
     JOIN countries c ON c.id = mc.country_id AND c.code = $1
     JOIN movie_genres mg ON mg.movie_id = m.id
     JOIN genres g ON g.id = mg.genre_id AND g.archived_at IS NULL
     WHERE m.status = 'active' AND m.archived_at IS NULL
     ORDER BY g.name ASC`,
    [country.code, type.code],
  );
  const otherTypes = await getPool().query(
    `SELECT COUNT(DISTINCT t.id)::int AS total
     FROM movies m
     JOIN content_types t ON t.id = m.content_type_id AND t.active = TRUE AND t.code <> $2
     JOIN movie_countries mc ON mc.movie_id = m.id
     JOIN countries c ON c.id = mc.country_id AND c.code = $1
     WHERE m.status = 'active' AND m.archived_at IS NULL`,
    [country.code, type.code],
  );
  const path = `/${type.route_prefix}/${country.route_slug}`;
  const distinct = listed.total > 0 && otherTypes.rows[0].total > 0;
  return {
    data: listed.rows.map(serializeMovieSummary),
    pagination: pagination(query.page, query.limit, listed.total),
    industry: {
      slug: country.route_slug,
      stem: country.stem,
      label: labelResult.rows[0]?.label || `${country.stem} ${type.plural_name}`,
      country: { code: country.code, slug: country.country_slug, displayName: country.display_name },
    },
    contentType: {
      code: type.code,
      name: type.name,
      pluralName: type.plural_name,
      routePrefix: type.route_prefix,
    },
    genres: genres.rows,
    note: null,
    indexable: distinct,
    canonicalPath: distinct ? path : `/movies/${country.country_slug}`,
  };
}

export async function industryRails(limit, countryRails = []) {
  const result = await getPool().query(
    `SELECT s.route_slug, l.label, t.route_prefix,
            m.slug, m.canonical_title, m.synopsis, m.release_year, m.popularity,
            lang.code AS language_code, lang.name AS language_name,
            t.code AS content_type_code, t.name AS content_type_name,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster_url
     FROM industry_labels l
     JOIN industry_stems s ON s.country_id = l.country_id
     JOIN content_types t ON t.id = l.content_type_id AND t.active = TRUE
     JOIN countries c ON c.id = l.country_id AND c.active = TRUE
     JOIN movie_countries mc ON mc.country_id = c.id
     JOIN movies m ON m.id = mc.movie_id AND m.content_type_id = t.id AND m.status = 'active' AND m.archived_at IS NULL
     LEFT JOIN languages lang ON lang.id = m.original_language_id
     WHERE l.active = TRUE
     ORDER BY l.label ASC, COALESCE(m.popularity, 0) DESC, m.slug ASC`,
  );
  const groups = new Map();
  for (const row of result.rows) {
    const current = groups.get(row.route_slug) || {
      slug: row.route_slug,
      title: row.label,
      href: `/${row.route_prefix}/${row.route_slug}`,
      items: [],
    };
    if (current.items.length < limit) {
      current.items.push({
        slug: row.slug,
        title: row.canonical_title,
        synopsis: row.synopsis,
        releaseYear: row.release_year,
        popularity: row.popularity == null ? null : Number(row.popularity),
        poster: row.poster_url ? { url: row.poster_url } : null,
        originalLanguage: row.language_code ? { code: row.language_code, name: row.language_name } : null,
        contentType: { code: row.content_type_code, name: row.content_type_name },
      });
    }
    groups.set(row.route_slug, current);
  }
  const countrySets = new Set(countryRails.map((rail) => rail.items.map((item) => item.slug).sort().join('|')));
  return [...groups.values()]
    .filter((group) => group.items.length > 0)
    .filter((group) => !countrySets.has(group.items.map((item) => item.slug).sort().join('|')))
    .map((group) => ({
      slug: group.slug,
      title: group.title,
      source: 'industry',
      reason: 'Published titles for this country and content type',
      href: group.href,
      kind: 'movies',
      items: group.items,
    }));
}

function serializeType(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    pluralName: row.plural_name,
    routePrefix: row.route_prefix,
    active: row.active,
    published: row.published_count,
  };
}

export const contentTypePatchSchema = z.object({
  body: z.object({
    active: z.boolean(),
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

export const industryLabelSchema = z.object({
  body: z.object({
    label: z.string().trim().min(1).max(80),
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

export { MOVIE_TYPE_ID };
