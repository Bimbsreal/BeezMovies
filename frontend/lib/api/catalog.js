import { api } from './client.js';

export function toCatalogQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}

export function getMovies(params) {
  return api(`/movies${toCatalogQuery(params)}`);
}

export function getRelatedMovies(slug) {
  return api(`/movies/${encodeURIComponent(slug)}/related`);
}

export function getMovieBySlug(slug) {
  return api(`/movies/${encodeURIComponent(slug)}`);
}

export function requestDownload(slug) {
  return api(`/movies/${encodeURIComponent(slug)}/download`, {
    method: 'POST',
    body: {},
    signal: AbortSignal.timeout(8000),
  });
}

export function getGenres() {
  return api('/genres');
}

export function getGenreMovies(slug, params) {
  return api(`/genres/${encodeURIComponent(slug)}/movies${toCatalogQuery(params)}`);
}

export function getContentTypes() {
  return api('/content-types');
}

export function getShow(slug) {
  return api(`/shows/${encodeURIComponent(slug)}`);
}

export function getSeason(slug, season, params) {
  return api(`/shows/${encodeURIComponent(slug)}/seasons/${season}${toCatalogQuery(params)}`);
}

export function getEpisode(slug, season, episode) {
  return api(`/shows/${encodeURIComponent(slug)}/seasons/${season}/episodes/${episode}`);
}

export function requestEpisodeDownload(slug, season, episode) {
  return api(`/shows/${encodeURIComponent(slug)}/seasons/${season}/episodes/${episode}/download`, {
    method: 'POST',
    body: {},
    signal: AbortSignal.timeout(8000),
  });
}

export function getIndustry(slug, params) {
  return api(`/industries/${encodeURIComponent(slug)}${toCatalogQuery(params)}`);
}

export function getCountries() {
  return api('/countries');
}

export function getCountry(slug) {
  return api(`/countries/${encodeURIComponent(slug)}`);
}

export function getCountryMovies(slug, params) {
  return api(`/countries/${encodeURIComponent(slug)}/movies${toCatalogQuery(params)}`);
}

export function getLanguages() {
  return api('/languages');
}

export function getLanguageMovies(code, params) {
  return api(`/languages/${encodeURIComponent(code)}/movies${toCatalogQuery(params)}`);
}

export function getCollections() {
  return api('/collections');
}

export function getCollection(slug) {
  return api(`/collections/${encodeURIComponent(slug)}`);
}

export function getPerson(id) {
  return api(`/people/${encodeURIComponent(id)}`);
}

export function getPersonMovies(id, params) {
  return api(`/people/${encodeURIComponent(id)}/movies${toCatalogQuery(params)}`);
}
