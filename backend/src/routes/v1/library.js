import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { privateCache } from '../../middleware/private-cache.js';
import { validate } from '../../middleware/validate.js';
import {
  addLibrary,
  becauseYouLike,
  becauseYouViewed,
  clearRecent,
  libraryListSchema,
  librarySlugSchema,
  listLibrary,
  preferencesSchema,
  preferredCountryMovies,
  readPreferences,
  removeLibrary,
  savePreferences,
  watchProgress,
} from '../../library/service.js';
import { progressSchema, saveEpisodeProgress } from '../../catalog/episodes.js';

export const libraryRouter = Router();

libraryRouter.use(privateCache);
libraryRouter.use(requireAuth);

function userId(req) {
  return req.auth.user.id;
}

libraryRouter.get('/watchlist', validate(libraryListSchema), asyncHandler(async (req, res) => {
  const page = await listLibrary(userId(req), 'watchlist', req.validated.query);
  res.json({ data: page.items, pagination: page.pagination });
}));

libraryRouter.post('/watchlist/:slug', validate(librarySlugSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await addLibrary(userId(req), 'watchlist', req.validated.params.slug) });
}));

libraryRouter.delete('/watchlist/:slug', validate(librarySlugSchema), asyncHandler(async (req, res) => {
  res.json({ data: await removeLibrary(userId(req), 'watchlist', req.validated.params.slug) });
}));

libraryRouter.get('/favorites', validate(libraryListSchema), asyncHandler(async (req, res) => {
  const page = await listLibrary(userId(req), 'favorites', req.validated.query);
  res.json({ data: page.items, pagination: page.pagination });
}));

libraryRouter.post('/favorites/:slug', validate(librarySlugSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await addLibrary(userId(req), 'favorites', req.validated.params.slug) });
}));

libraryRouter.delete('/favorites/:slug', validate(librarySlugSchema), asyncHandler(async (req, res) => {
  res.json({ data: await removeLibrary(userId(req), 'favorites', req.validated.params.slug) });
}));

libraryRouter.get('/recent', validate(libraryListSchema), asyncHandler(async (req, res) => {
  const page = await listLibrary(userId(req), 'recent', req.validated.query);
  res.json({ data: page.items, pagination: page.pagination });
}));

libraryRouter.post('/recent/:slug', validate(librarySlugSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await addLibrary(userId(req), 'recent', req.validated.params.slug) });
}));

libraryRouter.delete('/recent', asyncHandler(async (req, res) => {
  res.json({ data: await clearRecent(userId(req)) });
}));

libraryRouter.delete('/recent/:slug', validate(librarySlugSchema), asyncHandler(async (req, res) => {
  res.json({ data: await removeLibrary(userId(req), 'recent', req.validated.params.slug) });
}));

libraryRouter.get('/preferences', asyncHandler(async (req, res) => {
  res.json({ data: await readPreferences(userId(req)) });
}));

libraryRouter.put('/preferences', validate(preferencesSchema), asyncHandler(async (req, res) => {
  res.json({ data: await savePreferences(userId(req), req.validated.body.genreSlugs, req.validated.body.countrySlugs) });
}));

libraryRouter.get('/progress', asyncHandler(async (req, res) => {
  res.json({ data: await watchProgress(userId(req)) });
}));

libraryRouter.put('/progress/:id', validate(progressSchema), asyncHandler(async (req, res) => {
  res.json({ data: await saveEpisodeProgress(userId(req), req.validated.params.id, req.validated.body.positionSeconds) });
}));

libraryRouter.get('/country-picks', asyncHandler(async (req, res) => {
  res.json({ data: await preferredCountryMovies(userId(req)) });
}));

libraryRouter.get('/suggestions', asyncHandler(async (req, res) => {
  res.json({ data: await becauseYouLike(userId(req)) });
}));

libraryRouter.get('/continue', asyncHandler(async (req, res) => {
  res.json({ data: await becauseYouViewed(userId(req)) });
}));
