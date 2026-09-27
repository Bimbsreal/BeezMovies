import { Router } from 'express';
import { health, ready } from './system.js';
import { authRouter } from './auth.js';
import { libraryRouter } from './library.js';
import { adminRouter } from './admin.js';
import {
  collectionsRouter,
  contentTypesRouter,
  countriesRouter,
  industriesRouter,
  showsRouter,
  genresRouter,
  languagesRouter,
  moviesRouter,
  peopleRouter,
} from './catalog.js';
import { discoveryRouter, searchRouter } from './search.js';
import { mediaRouter } from './media.js';
import { monetizationRouter } from './monetization.js';
import { analyticsRouter } from './analytics.js';
import { complaintsRouter } from './complaints.js';
import { recordAnalytics } from '../../analytics/record.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireBrowserRequestHeader } from '../../middleware/csrf.js';
import { apiRateLimiter } from '../../middleware/rate-limit.js';
import { maintenanceGate } from '../../middleware/maintenance.js';
import { publicCacheHints } from '../../middleware/public-cache.js';

export const v1Router = Router();

v1Router.use(apiRateLimiter);
v1Router.use(publicCacheHints);
v1Router.use(requireBrowserRequestHeader);
v1Router.use(maintenanceGate);
v1Router.use((req, res, next) => {
  const method = req.method;
  const path = req.path;
  const started = Date.now();
  res.on('finish', () => {
    const metric = latencyMetric(method, path);
    if (!metric) return;
    const durationMs = Math.min(Math.max(Date.now() - started, 0), 120000);
    recordAnalytics({
      name: 'API_LATENCY',
      subject: metric,
      durationMs,
      outcome: res.statusCode < 400 ? 'success' : 'failed',
    });
  });
  next();
});
v1Router.get('/health', health);
v1Router.get('/ready', asyncHandler(ready));
v1Router.use('/auth', authRouter);
v1Router.use('/me', libraryRouter);
v1Router.use('/admin', adminRouter);
v1Router.use('/movies', moviesRouter);
v1Router.use('/genres', genresRouter);
v1Router.use('/countries', countriesRouter);
v1Router.use('/content-types', contentTypesRouter);
v1Router.use('/industries', industriesRouter);
v1Router.use('/shows', showsRouter);
v1Router.use('/languages', languagesRouter);
v1Router.use('/collections', collectionsRouter);
v1Router.use('/people', peopleRouter);
v1Router.use('/media', mediaRouter);
v1Router.use('/monetization', monetizationRouter);
v1Router.use('/search', searchRouter);
v1Router.use('/discovery', discoveryRouter);
v1Router.use('/analytics', analyticsRouter);
v1Router.use('/complaints', complaintsRouter);

function latencyMetric(method, path) {
  if (method === 'GET' && path === '/search') return 'search';
  if (method === 'GET' && /^\/movies\/[^/]+$/.test(path)) return 'movie';
  if (method === 'POST' && (/^\/movies\/[^/]+\/download$/.test(path) || path === '/media/resolve')) return 'download';
  return '';
}
