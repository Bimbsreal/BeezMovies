import { Router } from 'express';
import { z } from 'zod';
import { resolveMovieDownload } from '../../catalog/download.js';
import { openDownloadHandoff } from '../../media/resolution.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { optionalAuth } from '../../middleware/authenticate.js';
import { createDownloadLimiter } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';

const handoffSchema = z.object({
  body: z.object({}).strict().optional().default({}),
  query: z.object({}).strict(),
  params: z.object({
    token: z.string().regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  }).strict(),
});

const resolveSchema = z.object({
  body: z.object({
    slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const mediaRouter = Router();

mediaRouter.post('/resolve', optionalAuth, createDownloadLimiter(), (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, validate(resolveSchema), asyncHandler(async (req, res) => {
  const data = await resolveMovieDownload(req.validated.body.slug);
  res.set('Cache-Control', 'no-store');
  res.json({ data });
}));

mediaRouter.get('/handoff/:token', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
}, validate(handoffSchema), asyncHandler(async (req, res) => {
  const file = await openDownloadHandoff(req.validated.params.token);
  res.set('Cache-Control', 'no-store');
  res.set('Content-Type', file.contentType);
  res.set('Content-Disposition', `attachment; filename="${file.filename}"`);
  res.set('X-Content-Type-Options', 'nosniff');
  res.send(file.body);
}));
