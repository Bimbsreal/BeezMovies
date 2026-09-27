import { Router } from 'express';
import { createDownloadLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { optionalAuth, requireAuth } from '../../middleware/authenticate.js';
import { requireAdmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import {
  collectionListSchema,
  collectionSlugSchema,
  countryListSchema,
  countryMoviesSchema,
  countrySlugSchema,
  languageListSchema,
  languageMoviesSchema,
  genreListSchema,
  genreMoviesSchema,
  movieIdSchema,
  movieListSchema,
  industrySchema,
  movieSlugSchema,
  movieDownloadSchema,
  personMoviesSchema,
  personSchema,
} from '../../catalog/schemas.js';
import {
  listCollections,
  listCountries,
  listCountryMovies,
  showCountry,
  listLanguages,
  listLanguageMovies,
  listGenreMovies,
  listGenres,
  listContentTypeRows,
  showIndustry,
  listMovies,
  listPersonMovies,
  showCollection,
  showMovie,
  showMovieById,
  showPerson,
  downloadMovie,
} from '../../catalog/controller.js';
import { movieRelated } from '../../search/controller.js';
import {
  downloadEpisode,
  episodeSchema,
  getEpisode,
  getSeason,
  getSeries,
  seasonSchema,
  seriesSlugSchema,
} from '../../catalog/episodes.js';

function catalogCacheHeader(req, res, next) {
  if (req.headers.cookie) {
    res.set('Cache-Control', 'private, no-store');
  } else {
    res.set('Cache-Control', 'public, max-age=60');
  }
  next();
}

export const moviesRouter = Router();
export const genresRouter = Router();
export const collectionsRouter = Router();
export const peopleRouter = Router();
export const countriesRouter = Router();
export const languagesRouter = Router();
export const contentTypesRouter = Router();
export const industriesRouter = Router();
export const showsRouter = Router();

moviesRouter.use(catalogCacheHeader);
genresRouter.use(catalogCacheHeader);
collectionsRouter.use(catalogCacheHeader);
peopleRouter.use(catalogCacheHeader);
countriesRouter.use(catalogCacheHeader);
languagesRouter.use(catalogCacheHeader);
contentTypesRouter.use(catalogCacheHeader);
industriesRouter.use(catalogCacheHeader);
showsRouter.use(catalogCacheHeader);

// GET /me/watchlist is reserved for a later phase and will use requireAuth.

moviesRouter.get('/', optionalAuth, validate(movieListSchema), asyncHandler(listMovies));
moviesRouter.get('/id/:id', requireAuth, requireAdmin, validate(movieIdSchema), asyncHandler(showMovieById));
moviesRouter.post('/:slug/download', optionalAuth, createDownloadLimiter(), (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, validate(movieDownloadSchema), asyncHandler(downloadMovie));
moviesRouter.get('/:slug/related', optionalAuth, validate(movieSlugSchema), asyncHandler(movieRelated));
moviesRouter.get('/:slug', optionalAuth, validate(movieSlugSchema), asyncHandler(showMovie));

genresRouter.get('/', validate(genreListSchema), asyncHandler(listGenres));
genresRouter.get('/:slug/movies', optionalAuth, validate(genreMoviesSchema), asyncHandler(listGenreMovies));

collectionsRouter.get('/', validate(collectionListSchema), asyncHandler(listCollections));
collectionsRouter.get('/:slug', validate(collectionSlugSchema), asyncHandler(showCollection));

languagesRouter.get('/', validate(languageListSchema), asyncHandler(listLanguages));
languagesRouter.get('/:code/movies', optionalAuth, validate(languageMoviesSchema), asyncHandler(listLanguageMovies));

countriesRouter.get('/', validate(countryListSchema), asyncHandler(listCountries));
countriesRouter.get('/:slug/movies', optionalAuth, validate(countryMoviesSchema), asyncHandler(listCountryMovies));
countriesRouter.get('/:slug', validate(countrySlugSchema), asyncHandler(showCountry));

showsRouter.get('/:slug', optionalAuth, validate(seriesSlugSchema), asyncHandler(async (req, res) => {
  res.json({ data: await getSeries(req.validated.params.slug) });
}));
showsRouter.get('/:slug/seasons/:season', optionalAuth, validate(seasonSchema), asyncHandler(async (req, res) => {
  res.json(await getSeason(req.validated.params.slug, req.validated.params.season, req.validated.query));
}));
showsRouter.get('/:slug/seasons/:season/episodes/:episode', optionalAuth, validate(episodeSchema), asyncHandler(async (req, res) => {
  res.json({ data: await getEpisode(req.validated.params.slug, req.validated.params.season, req.validated.params.episode) });
}));
showsRouter.post('/:slug/seasons/:season/episodes/:episode/download', optionalAuth, createDownloadLimiter(), (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, validate(episodeSchema), asyncHandler(async (req, res) => {
  res.json({ data: await downloadEpisode(req.validated.params.slug, req.validated.params.season, req.validated.params.episode) });
}));

contentTypesRouter.get('/', asyncHandler(listContentTypeRows));
industriesRouter.get('/:slug', optionalAuth, validate(industrySchema), asyncHandler(showIndustry));

peopleRouter.get('/:id', validate(personSchema), asyncHandler(showPerson));
peopleRouter.get('/:id/movies', optionalAuth, validate(personMoviesSchema), asyncHandler(listPersonMovies));
