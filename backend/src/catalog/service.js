import { AppError } from '../errors/app-error.js';
import { PUBLIC_MOVIE_STATUS } from './constants.js';
import { findSlugRedirect } from './quality.js';
import { catalogCache, catalogCacheKeys } from './cache.js';
import { classifyMedia } from '../media/availability.js';
import { industryLabelsForMovie } from './industries.js';
import {
  findMovieById,
  findMovieBySlug,
  listMovies,
  listMoviesForCollection,
} from './repositories/movies.js';
import {
  findGenreBySlug,
  listAlternateTitles,
  listCountriesForMovie,
  listGenres,
  listGenresForMovie,
  listLanguagesForMovie,
  listTagsForMovie,
  listVerifiedSynopses,
} from './repositories/genres.js';
import {
  findCollectionBySlug,
  findCollectionForMovie,
  listCollections,
} from './repositories/collections.js';
import { findPersonById, listCreditsForMovie } from './repositories/people.js';
import {
  listAvailableMedia,
  listMediaSignals,
  listExternalIdentifiers,
  listImagesForMovie,
  listRatingsForMovie,
  listVideosForMovie,
} from './repositories/media.js';
import {
  pagination,
  serializeCollectionSummary,
  serializeGenre,
  serializeMovieDetail,
  serializeMovieSummary,
  serializePerson,
} from './serializers.js';

function notFound(message) {
  return new AppError(message, { status: 404, code: 'NOT_FOUND' });
}

function isAdmin(viewer) {
  return Boolean(viewer?.permissions?.includes('admin.access'));
}

function statusesFor(query, viewer) {
  if (!query.status || query.status === PUBLIC_MOVIE_STATUS) {
    return [PUBLIC_MOVIE_STATUS];
  }
  if (!isAdmin(viewer)) {
    throw new AppError('You do not have access to this resource', {
      status: 403,
      code: 'FORBIDDEN',
    });
  }
  return [query.status];
}

function assertDateRange(query) {
  if (query.releasedFrom && query.releasedTo && query.releasedFrom > query.releasedTo) {
    throw new AppError('releasedFrom must be on or before releasedTo', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
}

function listFilters(query, viewer, extra = {}) {
  assertDateRange(query);
  return {
    statuses: statusesFor(query, viewer),
    year: query.year,
    releasedFrom: query.releasedFrom,
    releasedTo: query.releasedTo,
    genre: extra.genre || query.genre,
    language: query.language,
    country: query.country,
    contentType: query.type || 'movie',
    collection: query.collection,
    personId: extra.personId,
    q: query.q,
    sort: query.sort,
    order: query.order,
    limit: query.limit,
    offset: (query.page - 1) * query.limit,
    page: query.page,
  };
}

async function pageOfMovies(query, viewer, extra) {
  const filters = listFilters(query, viewer, extra);
  const result = await listMovies(filters);
  return {
    data: result.rows.map(serializeMovieSummary),
    pagination: pagination(filters.page, filters.limit, result.total),
  };
}

async function assembleMovie(row, { includeId = false } = {}) {
  const movieId = row.id;
  const [genres, languages, countries, alternateTitles, synopses, images, videos, credits, collection, externalIdentifiers, ratings, media, tags, signals, industryLabels] = await Promise.all([
    listGenresForMovie(movieId),
    listLanguagesForMovie(movieId),
    listCountriesForMovie(movieId),
    listAlternateTitles(movieId),
    listVerifiedSynopses(movieId),
    listImagesForMovie(movieId),
    listVideosForMovie(movieId),
    listCreditsForMovie(movieId),
    findCollectionForMovie(movieId),
    listExternalIdentifiers(movieId),
    listRatingsForMovie(movieId),
    listAvailableMedia(movieId),
    listTagsForMovie(movieId),
    listMediaSignals(movieId),
    industryLabelsForMovie(movieId),
  ]);

  return serializeMovieDetail(row, {
    genres,
    languages,
    countries,
    industryLabels,
    alternateTitles,
    synopses,
    images,
    videos,
    credits,
    collection,
    externalIdentifiers,
    ratings,
    media,
    tags,
    mediaState: classifyMedia(signals),
  }, { includeId });
}

function canView(row, viewer) {
  return row.status === PUBLIC_MOVIE_STATUS || isAdmin(viewer);
}

export async function getMovieList(query, viewer) {
  return pageOfMovies(query, viewer);
}

export async function getMovieBySlug(slug, viewer) {
  const cacheKey = catalogCacheKeys.movieSlug(slug);
  if (!isAdmin(viewer)) {
    const cached = await catalogCache.get(cacheKey);
    if (cached) return cached;
  }

  const row = await findMovieBySlug(slug);
  if (!row) {
    const canonical = await findSlugRedirect(slug);
    if (canonical && canonical !== slug) {
      throw new AppError('This movie has a newer address', {
        status: 301,
        code: 'SLUG_MOVED',
        details: { slug: canonical },
      });
    }
  }
  if (!row || !canView(row, viewer) || row.content_type_code === 'series') throw notFound('Movie not found');

  const detail = await assembleMovie(row);
  if (row.status === PUBLIC_MOVIE_STATUS) {
    await catalogCache.set(cacheKey, detail);
  }
  return detail;
}

export async function getMovieById(id, viewer) {
  const row = await findMovieById(id);
  if (!row || !canView(row, viewer)) throw notFound('Movie not found');
  return assembleMovie(row, { includeId: true });
}

export async function getGenres() {
  const cacheKey = catalogCacheKeys.genres();
  const cached = await catalogCache.get(cacheKey);
  if (cached) return cached;
  const data = (await listGenres()).map(serializeGenre);
  await catalogCache.set(cacheKey, data);
  return data;
}

export async function getGenreMovies(slug, query, viewer) {
  const genre = await findGenreBySlug(slug);
  if (!genre) throw notFound('Genre not found');
  const page = await pageOfMovies(query, viewer, { genre: slug });
  return { genre: serializeGenre(genre), ...page };
}

export async function getCollections() {
  const cacheKey = catalogCacheKeys.collections();
  const cached = await catalogCache.get(cacheKey);
  if (cached) return cached;
  const data = (await listCollections()).map(serializeCollectionSummary);
  await catalogCache.set(cacheKey, data);
  return data;
}

export async function getCollection(slug) {
  const collection = await findCollectionBySlug(slug);
  if (!collection) throw notFound('Collection not found');
  const movies = await listMoviesForCollection(collection.id);
  return {
    ...serializeCollectionSummary(collection),
    movies: movies.map((row) => ({
      sortOrder: row.sort_order,
      ...serializeMovieSummary(row),
    })),
  };
}

export async function getPerson(id) {
  const person = await findPersonById(id);
  if (!person) throw notFound('Person not found');
  return serializePerson(person);
}

export async function getPersonMovies(id, query, viewer) {
  const person = await getPerson(id);
  const page = await pageOfMovies(query, viewer, { personId: id });
  return {
    person: { id: person.id, name: person.name },
    ...page,
  };
}
