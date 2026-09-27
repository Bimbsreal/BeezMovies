import { countryMovies, getCountryBySlug, listCountries as listCountryRows } from './countries.js';
import { getIndustryPage, listContentTypes } from './industries.js';
import { languageMovies, listLanguages as listLanguageRows } from './localization.js';
import { resolveMovieDownload } from './download.js';
import {
  getCollection,
  getCollections,
  getGenreMovies,
  getGenres,
  getMovieById,
  getMovieBySlug,
  getMovieList,
  getPerson,
  getPersonMovies,
} from './service.js';

function viewer(req) {
  return req.auth || null;
}

export async function listContentTypeRows(_req, res) {
  res.json({ data: await listContentTypes() });
}

export async function showIndustry(req, res) {
  const page = await getIndustryPage(req.validated.params.slug, req.validated.query);
  res.json(page);
}

export async function listMovies(req, res) {
  const result = await getMovieList(req.validated.query, viewer(req));
  res.json(result);
}

export async function showMovie(req, res) {
  const data = await getMovieBySlug(req.validated.params.slug, viewer(req));
  res.json({ data });
}

export async function downloadMovie(req, res) {
  const data = await resolveMovieDownload(req.validated.params.slug);
  res.set('Cache-Control', 'no-store');
  res.json({ data });
}

export async function showMovieById(req, res) {
  const data = await getMovieById(req.validated.params.id, viewer(req));
  res.json({ data });
}

export async function listCountries(_req, res) {
  res.json({ data: await listCountryRows({ activeOnly: true }) });
}

export async function showCountry(req, res) {
  res.json({ data: await getCountryBySlug(req.validated.params.slug) });
}

export async function listCountryMovies(req, res) {
  res.json(await countryMovies(req.validated.params.slug, req.validated.query));
}

export async function listLanguages(_req, res) {
  res.json({ data: await listLanguageRows() });
}

export async function listLanguageMovies(req, res) {
  res.json(await languageMovies(req.validated.params.code, req.validated.query));
}

export async function listGenres(_req, res) {
  res.json({ data: await getGenres() });
}

export async function listGenreMovies(req, res) {
  const result = await getGenreMovies(req.validated.params.slug, req.validated.query, viewer(req));
  res.json(result);
}

export async function listCollections(_req, res) {
  res.json({ data: await getCollections() });
}

export async function showCollection(req, res) {
  res.json({ data: await getCollection(req.validated.params.slug) });
}

export async function showPerson(req, res) {
  res.json({ data: await getPerson(req.validated.params.id) });
}

export async function listPersonMovies(req, res) {
  const result = await getPersonMovies(req.validated.params.id, req.validated.query, viewer(req));
  res.json(result);
}
