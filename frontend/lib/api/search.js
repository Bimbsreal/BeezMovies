import { api } from './client.js';
import { toCatalogQuery } from './catalog.js';

export function searchMovies(params) {
  return api(`/search${toCatalogQuery(params)}`);
}

export function getSearchSuggestions(q) {
  return api(`/search/suggestions${toCatalogQuery({ q })}`);
}

export function getHome() {
  return api('/discovery/home');
}

export function getTrending() {
  return api('/discovery/trending');
}

export function getPopular() {
  return api('/discovery/popular');
}

export function getRecent() {
  return api('/discovery/recent');
}
