import { getHomepage } from '../discovery/home.js';
import { relatedForSlug } from '../discovery/related.js';
import {
  getDiscoveryCollections,
  getDiscoveryGenres,
  getPopular,
  getRecent,
  getTrending,
  searchCatalog,
  suggestCatalog,
} from './service.js';

function cacheable(req) {
  return !req.headers.cookie;
}

export async function search(req, res) {
  const body = await searchCatalog(req.validated.query, { useCache: cacheable(req) });
  res.json(body);
}

export async function suggestions(req, res) {
  res.json(await suggestCatalog(req.validated.query.q));
}

export async function homepage(_req, res) {
  res.json(await getHomepage());
}

export async function movieRelated(req, res) {
  res.json(await relatedForSlug(req.validated.params.slug));
}

export async function trending(_req, res) {
  res.json(await getTrending());
}

export async function popular(_req, res) {
  res.json(await getPopular());
}

export async function recent(_req, res) {
  res.json(await getRecent());
}

export async function genres(_req, res) {
  res.json(await getDiscoveryGenres());
}

export async function collections(_req, res) {
  res.json(await getDiscoveryCollections());
}
