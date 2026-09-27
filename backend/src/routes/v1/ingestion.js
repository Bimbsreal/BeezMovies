import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAdmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { z } from 'zod';
import {
  advanceDryRun,
  bootstrapStatus,
  cancelDryRun,
  pauseDryRun,
  refuseProductionSeed,
  resumeDryRun,
  retryDryRun,
  startDryRun,
} from '../../ingestion/bootstrap.js';
import {
  cancelIngestionJob,
  cancelIngestionSchema,
  createIngestionJobSchema,
  getIngestionJob,
  ingestionBatchSchema,
  ingestionJobSchema,
  ingestionMetrics,
  ingestionQueueSchema,
  listIngestionJobs,
  listIngestionJobsSchema,
  listIngestionSources,
  requestIngestion,
  requestIngestionBatch,
  retryFailedIngestion,
  reindexIngestionMovie,
  setIngestionQueue,
  validateIngestionMovie,
  ingestionActionSchema,
} from '../../ingestion/admin-service.js';
import {
  cancelSync,
  pauseSync,
  resumeSync,
  retryFailedSync,
  startSync,
  syncBoard,
  syncRunSchema,
  syncStartSchema,
} from '../../ingestion/sync.js';

const dryRunSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    batchSize: z.number().int().min(1).max(25).optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

const runSchema = z.object({
  body: z.object({ confirm: z.literal(true) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

export const ingestionRouter = Router();

ingestionRouter.use(requireAdmin);

ingestionRouter.get('/sync', asyncHandler(async (_req, res) => {
  res.json({ data: await syncBoard() });
}));

ingestionRouter.post('/sync', validate(syncStartSchema), asyncHandler(async (req, res) => {
  res.status(202).json({
    data: await startSync(req.auth.user.id, {
      sourceSlug: req.validated.body.source,
      mode: req.validated.body.mode,
    }),
  });
}));

ingestionRouter.post('/sync/:id/pause', validate(syncRunSchema), asyncHandler(async (req, res) => {
  res.json({ data: await pauseSync(req.validated.params.id) });
}));

ingestionRouter.post('/sync/:id/resume', validate(syncRunSchema), asyncHandler(async (req, res) => {
  res.json({ data: await resumeSync(req.validated.params.id) });
}));

ingestionRouter.post('/sync/:id/cancel', validate(syncRunSchema), asyncHandler(async (req, res) => {
  res.json({ data: await cancelSync(req.validated.params.id) });
}));

ingestionRouter.post('/sync/retry', validate(ingestionActionSchema), asyncHandler(async (req, res) => {
  res.json({ data: await retryFailedSync(req.auth.user.id) });
}));

ingestionRouter.get('/sources', asyncHandler(async (_req, res) => {
  res.json({ data: await listIngestionSources() });
}));

ingestionRouter.get('/jobs', validate(listIngestionJobsSchema), asyncHandler(async (req, res) => {
  const jobs = await listIngestionJobs({
    status: req.validated.query.status,
    limit: req.validated.query.limit ?? 20,
  });
  res.json({ data: jobs });
}));

ingestionRouter.get('/jobs/:id', validate(ingestionJobSchema), asyncHandler(async (req, res) => {
  res.json({ data: await getIngestionJob(req.validated.params.id) });
}));

ingestionRouter.get('/activity', asyncHandler(async (_req, res) => {
  res.json({ data: await listIngestionJobs({ limit: 20 }) });
}));

ingestionRouter.get('/metrics', asyncHandler(async (_req, res) => {
  res.json({ data: await ingestionMetrics() });
}));

ingestionRouter.get('/bootstrap', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await bootstrapStatus() });
}));

ingestionRouter.post('/bootstrap/dry-run', validate(dryRunSchema), asyncHandler(async (req, res) => {
  res.status(201).json({ data: await startDryRun(req.auth.user.id, { batchSize: req.validated.body.batchSize }) });
}));

ingestionRouter.post('/bootstrap/:id/advance', validate(runSchema), asyncHandler(async (req, res) => {
  res.json({ data: await advanceDryRun(req.validated.params.id) });
}));

ingestionRouter.post('/bootstrap/:id/pause', validate(runSchema), asyncHandler(async (req, res) => {
  res.json({ data: await pauseDryRun(req.validated.params.id) });
}));

ingestionRouter.post('/bootstrap/:id/resume', validate(runSchema), asyncHandler(async (req, res) => {
  res.json({ data: await resumeDryRun(req.validated.params.id) });
}));

ingestionRouter.post('/bootstrap/:id/cancel', validate(runSchema), asyncHandler(async (req, res) => {
  res.json({ data: await cancelDryRun(req.validated.params.id) });
}));

ingestionRouter.post('/bootstrap/:id/retry', validate(runSchema), asyncHandler(async (req, res) => {
  res.json({ data: await retryDryRun(req.validated.params.id) });
}));

ingestionRouter.post('/bootstrap/apply', validate(dryRunSchema), asyncHandler(async () => {
  await refuseProductionSeed();
}));

ingestionRouter.post('/queue', validate(ingestionQueueSchema), asyncHandler(async (req, res) => {
  res.json({ data: await setIngestionQueue(req.auth.user.id, req.validated.body.enabled) });
}));

ingestionRouter.post('/batches', validate(ingestionBatchSchema), asyncHandler(async (req, res) => {
  const summary = await requestIngestionBatch(
    req.auth.user.id,
    req.validated.body.source,
    req.validated.body.externalIds,
  );
  res.status(202).json({ data: summary });
}));

ingestionRouter.post('/jobs/:id/cancel', validate(cancelIngestionSchema), asyncHandler(async (req, res) => {
  res.json({ data: await cancelIngestionJob(req.auth.user.id, req.validated.params.id) });
}));

ingestionRouter.post('/retry-failed', validate(ingestionActionSchema), asyncHandler(async (req, res) => {
  res.json({ data: await retryFailedIngestion(req.auth.user.id) });
}));

ingestionRouter.post('/validate', validate(ingestionActionSchema), asyncHandler(async (req, res) => {
  if (!req.validated.body.movieId) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A movie id is required' } });
    return;
  }
  res.json({ data: await validateIngestionMovie(req.validated.body.movieId) });
}));

ingestionRouter.post('/reindex', validate(ingestionActionSchema), asyncHandler(async (req, res) => {
  if (!req.validated.body.movieId) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'A movie id is required' } });
    return;
  }
  res.json({ data: await reindexIngestionMovie(req.auth.user.id, req.validated.body.movieId) });
}));

ingestionRouter.post('/jobs', validate(createIngestionJobSchema), asyncHandler(async (req, res) => {
  const job = await requestIngestion(req.validated.body);
  res.status(job.created ? 201 : 200).json({ data: job });
}));
