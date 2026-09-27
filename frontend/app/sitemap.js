import { allowIndexing, publicConfig } from '../lib/config';

const staticRoutes = [
  { path: '/', changeFrequency: 'weekly', priority: 1 },
  { path: '/movies', changeFrequency: 'daily', priority: 0.8 },
  { path: '/genres', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/countries', changeFrequency: 'weekly', priority: 0.6 },
  { path: '/languages', changeFrequency: 'weekly', priority: 0.5 },
  { path: '/collections', changeFrequency: 'weekly', priority: 0.6 },
];

async function publishedCountries() {
  try {
    const response = await fetch(`${publicConfig.apiUrl}/countries`, {
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];
    const body = await response.json();
    return (body.data || [])
      .filter((country) => country.movieCount > 0 && typeof country.slug === 'string')
      .map((country) => ({
        url: `${publicConfig.siteUrl}/movies/${country.slug}`,
        changeFrequency: 'weekly',
        priority: 0.6,
      }));
  } catch {
    return [];
  }
}

async function publishedLanguages() {
  try {
    const response = await fetch(`${publicConfig.apiUrl}/languages`, {
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];
    const body = await response.json();
    return (body.data || [])
      .filter((language) => language.movieCount > 0 && typeof language.code === 'string')
      .map((language) => ({
        url: `${publicConfig.siteUrl}/languages/${language.code}`,
        changeFrequency: 'weekly',
        priority: 0.5,
      }));
  } catch {
    return [];
  }
}

async function publishedMovies() {
  try {
    const response = await fetch(`${publicConfig.apiUrl}/movies?limit=50`, {
      next: { revalidate: 3600 },
    });
    if (!response.ok) return [];
    const body = await response.json();
    return (body.data || [])
      .filter((movie) => typeof movie?.slug === 'string' && movie.slug.length > 0)
      .map((movie) => ({
        url: `${publicConfig.siteUrl}/movie/${movie.slug}`,
        changeFrequency: 'weekly',
        priority: 0.7,
      }));
  } catch {
    return [];
  }
}

export default async function sitemap() {
  if (!allowIndexing()) return [];
  const movies = await publishedMovies();
  const countryPages = await publishedCountries();
  const languagePages = await publishedLanguages();
  return [
    ...staticRoutes.map((route) => ({
      url: route.path === '/' ? publicConfig.siteUrl : `${publicConfig.siteUrl}${route.path}`,
      changeFrequency: route.changeFrequency,
      priority: route.priority,
    })),
    ...countryPages,
    ...languagePages,
    ...movies,
  ];
}
