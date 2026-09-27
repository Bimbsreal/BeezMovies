import { getPool } from '../db/pool.js';
import { listCountries } from '../catalog/countries.js';
import { getCollection, getCollections, getGenres, getMovieList } from '../catalog/service.js';
import { discoveryCacheGet, discoveryCacheSet } from './cache.js';
import { omitDuplicateMovieRails } from './select.js';
import { industryRails } from '../catalog/industries.js';

const TRENDING_DAYS = 14;

async function movies({ sort, order = 'desc', limit, genre, collection, country }) {
  const page = await getMovieList({
    page: 1,
    limit,
    sort,
    order,
    genre,
    collection,
    country,
  }, null);
  return page.data || [];
}

function viewedCard(row) {
  return {
    slug: row.slug,
    title: row.canonical_title,
    synopsis: row.synopsis,
    releaseYear: row.release_year,
    popularity: row.popularity == null ? null : Number(row.popularity),
    poster: row.poster_url ? { url: row.poster_url } : null,
    originalLanguage: row.language_code ? { code: row.language_code, name: row.language_name } : null,
    contentType: row.content_type_code ? { code: row.content_type_code, name: row.content_type_name } : null,
  };
}

async function trendingMovies(limit) {
  const result = await getPool().query(
    `SELECT m.slug, m.canonical_title, m.synopsis, m.release_year, m.popularity,
            l.code AS language_code, l.name AS language_name,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster_url
     FROM user_recent_views viewed
     JOIN movies m ON m.id = viewed.movie_id
     LEFT JOIN languages l ON l.id = m.original_language_id
     WHERE m.status = 'active'
       AND viewed.viewed_at > NOW() - ($2::int * INTERVAL '1 day')
     GROUP BY m.id, l.code, l.name
     ORDER BY COUNT(DISTINCT viewed.user_id) DESC, MAX(viewed.viewed_at) DESC, m.slug ASC
     LIMIT $1`,
    [limit, TRENDING_DAYS],
  );
  return result.rows.map(viewedCard);
}

async function countryRails(limit) {
  const result = await getPool().query(
    `SELECT c.slug AS country_slug, c.rail_title, c.display_name,
            m.slug, m.canonical_title, m.synopsis, m.release_year, m.popularity,
            l.code AS language_code, l.name AS language_name,
            ct.code AS content_type_code, ct.name AS content_type_name,
            (
              SELECT mi.url FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster_url
     FROM countries c
     JOIN movie_countries mc ON mc.country_id = c.id
     JOIN movies m ON m.id = mc.movie_id AND m.status = 'active' AND m.archived_at IS NULL
     JOIN content_types ct ON ct.id = m.content_type_id AND ct.code = 'movie'
     LEFT JOIN languages l ON l.id = m.original_language_id
     WHERE c.active = TRUE
     ORDER BY c.display_name ASC, COALESCE(m.popularity, 0) DESC, m.created_at DESC, m.slug ASC`,
  );
  const groups = new Map();
  for (const row of result.rows) {
    const current = groups.get(row.country_slug) || {
      slug: row.country_slug,
      title: row.rail_title,
      items: [],
    };
    if (current.items.length < limit) current.items.push(viewedCard(row));
    groups.set(row.country_slug, current);
  }
  return [...groups.values()]
    .filter((group) => group.items.length > 0)
    .sort((left, right) => right.items.length - left.items.length || left.title.localeCompare(right.title))
    .map((group) => ({
      slug: group.slug,
      title: group.title,
      source: 'countries',
      reason: 'Published movies ordered by editorial popularity',
      href: `/movies/${group.slug}`,
      kind: 'movies',
      items: group.items,
    }));
}

function movieRail(config, items, extra = {}) {
  return {
    slug: extra.slug || config.slug,
    title: extra.title || config.title,
    source: config.source_type,
    reason: extra.reason,
    href: extra.href || null,
    kind: 'movies',
    items,
  };
}

async function railsFor(config) {
  const limit = config.item_limit;
  if (config.source_type === 'featured') {
    const items = (await movies({ sort: 'popularity', limit: 24 })).filter((movie) => movie.popularity != null).slice(0, limit);
    return [movieRail(config, items, {
      reason: 'Editorial ranking',
      href: '/movies?sort=release_date&order=desc',
    })];
  }
  if (config.source_type === 'recent') {
    return [movieRail(config, await movies({ sort: 'created_at', limit }), {
      reason: 'Newest published movies',
      href: '/movies?sort=created_at&order=desc',
    })];
  }
  if (config.source_type === 'trending') {
    return [movieRail(config, await trendingMovies(limit), {
      reason: 'Watched by signed-in members in the last 14 days',
      href: '/movies',
    })];
  }
  if (config.source_type === 'genres') {
    const genres = await getGenres();
    const rails = [];
    for (const genre of genres.filter((item) => item.movieCount > 0)) {
      rails.push(movieRail(config, await movies({ sort: 'title', order: 'asc', limit, genre: genre.slug }), {
        slug: genre.slug,
        title: genre.name,
        reason: 'Movies in this genre',
        href: `/genre/${genre.slug}`,
      }));
    }
    return rails;
  }
  if (config.source_type === 'countries') {
    const countries = await countryRails(limit);
    return [...countries, ...await industryRails(limit, countries)];
  }
  if (config.source_type === 'collections') {
    const items = (await getCollections()).slice(0, limit);
    return [{
      slug: config.slug,
      title: config.title,
      source: config.source_type,
      reason: 'Curated collections',
      href: '/collections',
      kind: 'collections',
      items,
    }];
  }
  if (config.source_type === 'collection') {
    try {
      const collection = await getCollection(config.source_slug);
      return [movieRail(config, (collection.movies || []).slice(0, limit), {
        reason: 'Curated collection',
        href: `/collection/${collection.slug}`,
      })];
    } catch {
      return [];
    }
  }
  return [];
}

export async function buildHomepage() {
  const configs = await getPool().query(
    `SELECT slug, title, source_type, source_slug, sort_order, item_limit, cache_seconds
     FROM homepage_rails
     WHERE enabled = TRUE
     ORDER BY sort_order ASC, slug ASC`,
  );
  const rails = [];
  for (const config of configs.rows) {
    rails.push(...await railsFor(config));
  }
  const visible = omitDuplicateMovieRails(rails);
  const featured = visible.find((rail) => rail.source === 'featured' && rail.kind === 'movies');
  const fallback = visible.find((rail) => rail.kind === 'movies');
  const countries = (await listCountries({ activeOnly: true }))
    .filter((country) => country.priority)
    .map((country) => ({
      slug: country.slug,
      displayName: country.displayName,
      railTitle: country.railTitle,
      region: country.region,
      movieCount: country.movieCount,
    }));
  return {
    data: {
      featured: featured?.items?.[0] || fallback?.items?.[0] || null,
      rails: visible,
      countries,
    },
  };
}

export async function getHomepage() {
  const cached = await discoveryCacheGet('home');
  if (cached) return cached;
  const body = await buildHomepage();
  const ttl = 60;
  await discoveryCacheSet('home', body, ttl);
  return body;
}

export async function getTrendingList() {
  return { data: await trendingMovies(12) };
}

export async function getRecentList() {
  return { data: await movies({ sort: 'created_at', limit: 12 }) };
}
