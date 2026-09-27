import { Router } from 'express';
import { z } from 'zod';
import { analyticsCsv, analyticsReport } from '../../analytics/report.js';
import { publicAdminError } from '../../admin/audit.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAdmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';

const period = z.enum(['today', '7d', '30d', '90d', 'custom']).optional();

export const analyticsQuerySchema = z.object({
  body: z.object({}).strict(),
  params: z.object({}).strict(),
  query: z.object({
    period,
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }).strict(),
});

export const analyticsAdminRouter = Router();

analyticsAdminRouter.use(requireAdmin);

function guard(work) {
  return asyncHandler(async (req, res) => {
    try {
      await work(req, res);
    } catch (error) {
      if (error.status && error.status < 500) throw error;
      throw publicAdminError(error);
    }
  });
}

analyticsAdminRouter.get('/', validate(analyticsQuerySchema), guard(async (req, res) => {
  res.json({ data: await analyticsReport(req.validated.query) });
}));

analyticsAdminRouter.get('/movies', validate(analyticsQuerySchema), guard(async (req, res) => {
  const report = await analyticsReport(req.validated.query);
  res.json({ data: { period: report.period, movies: report.movies } });
}));

analyticsAdminRouter.get('/search', validate(analyticsQuerySchema), guard(async (req, res) => {
  const report = await analyticsReport(req.validated.query);
  res.json({ data: { period: report.period, search: report.search } });
}));

analyticsAdminRouter.get('/providers', validate(analyticsQuerySchema), guard(async (req, res) => {
  const report = await analyticsReport(req.validated.query);
  res.json({ data: { period: report.period, providers: report.providers } });
}));

analyticsAdminRouter.get('/export', validate(analyticsQuerySchema), guard(async (req, res) => {
  const csv = await analyticsCsv(req.validated.query);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="beezmovies-analytics.csv"');
  res.send(csv);
}));
