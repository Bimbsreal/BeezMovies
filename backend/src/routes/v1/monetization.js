import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../errors/app-error.js';
import { publicConfig, publicEventSchema, recordPublicEvent } from '../../monetization/service.js';

export const monetizationRouter = Router();

monetizationRouter.get('/config', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ data: await publicConfig() });
}));

monetizationRouter.post('/events', validate(publicEventSchema), asyncHandler(async (req, res) => {
  try {
    res.json({ data: await recordPublicEvent(req.validated.body) });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('The placement could not be recorded', { status: 503, code: 'MONETIZATION_UNAVAILABLE' });
  }
}));
