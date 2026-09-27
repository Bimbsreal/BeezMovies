import { getCollection, getMovieBySlug, getMovieList } from '../catalog/service.js';
import { discoveryCacheGet, discoveryCacheSet } from './cache.js';
import { rankRelated } from './select.js';

async function candidatesFor(movie) {
  const genres = movie.genres || [];
  const pages = await Promise.all(genres.map((genre) => getMovieList({
    page: 1,
    limit: 24,
    genre: genre.slug,
    sort: 'title',
    order: 'asc',
  }, null)));
  const shared = new Map();
  pages.forEach((page) => {
    for (const item of page.data || []) {
      const current = shared.get(item.slug) || { ...item, sharedGenres: 0, sharedCountries: 0 };
      current.sharedGenres += 1;
      if (!current.originalLanguage && item.originalLanguage) current.originalLanguage = item.originalLanguage;
      shared.set(item.slug, current);
    }
  });
  const countryPages = await Promise.all((movie.countries || [])
    .filter((country) => country.code)
    .map((country) => getMovieList({
      page: 1,
      limit: 24,
      country: country.code,
      sort: 'popularity',
      order: 'desc',
    }, null)));
  countryPages.forEach((page) => {
    for (const item of page.data || []) {
      const current = shared.get(item.slug) || { ...item, sharedGenres: 0, sharedCountries: 0 };
      current.sharedCountries = (current.sharedCountries || 0) + 1;
      shared.set(item.slug, current);
    }
  });
  let collectionSlugs = [];
  if (movie.collection?.slug) {
    const collection = await getCollection(movie.collection.slug);
    collectionSlugs = (collection.movies || []).map((item) => item.slug);
    for (const item of collection.movies || []) {
      if (!shared.has(item.slug)) shared.set(item.slug, { ...item, sharedGenres: 0, sharedCountries: 0 });
    }
  }
  return rankRelated(movie, [...shared.values()], { collectionSlugs });
}

export async function relatedForSlug(slug) {
  const cached = await discoveryCacheGet(`related:${slug}`);
  if (cached) return cached;
  const movie = await getMovieBySlug(slug, null);
  const ranked = await candidatesFor(movie);
  const rails = [];
  if (ranked.length) {
    rails.push({
      slug: 'more-like-this',
      title: 'More like this',
      reason: 'Shared genre, country, language, period, or collection',
      items: ranked.slice(0, 12),
    });
  }
  const primary = movie.genres?.[0];
  if (primary) {
    const page = await getMovieList({
      page: 1,
      limit: 12,
      genre: primary.slug,
      sort: 'title',
      order: 'asc',
    }, null);
    const items = (page.data || []).filter((item) => item.slug !== movie.slug);
    const same = items.map((item) => item.slug).join('|') === ranked.slice(0, items.length).map((item) => item.slug).join('|');
    if (items.length && !same) {
      rails.push({
        slug: primary.slug,
        title: `More ${primary.name}`,
        reason: 'Movies in this genre',
        href: `/genre/${primary.slug}`,
        items,
      });
    }
  }
  const body = { data: rails };
  await discoveryCacheSet(`related:${slug}`, body, 60);
  return body;
}
