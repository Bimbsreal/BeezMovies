import { Router } from 'express';
import { config } from '../../config/index.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { createRateLimiter, ipKeyGenerator } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { searchSchema, suggestionSchema } from '../../search/schemas.js';
import { search, suggestions } from '../../search/controller.js';
import {
  collections,
  genres,
  homepage,
  popular,
  recent,
  trending,
} from '../../search/controller.js';

function searchCacheHeader(req, res, next) {
  if (req.headers.cookie) {
    res.set('Cache-Control', 'private, no-store');
  } else {
    res.set('Cache-Control', 'public, max-age=30');
  }
  next();
}

export const searchRouter = Router();
export const discoveryRouter = Router();

const searchLimiter = createRateLimiter({
  windowMs: 60_000,
  limit: config.isProduction ? 60 : 240,
  keyGenerator: (req) => ipKeyGenerator(req.ip || ''),
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many search requests',
    },
  },
});

searchRouter.use(searchLimiter);
searchRouter.use(searchCacheHeader);
discoveryRouter.use(searchCacheHeader);

searchRouter.get('/suggestions', validate(suggestionSchema), asyncHandler(suggestions));
searchRouter.get('/', validate(searchSchema), asyncHandler(search));

discoveryRouter.get('/home', asyncHandler(homepage));
discoveryRouter.get('/trending', asyncHandler(trending));
discoveryRouter.get('/popular', asyncHandler(popular));
discoveryRouter.get('/recent', asyncHandler(recent));
discoveryRouter.get('/genres', asyncHandler(genres));
discoveryRouter.get('/collections', asyncHandler(collections));
