import { Router } from 'express';
import { z } from 'zod';
import { acceptClientEvents } from '../../analytics/record.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { validate } from '../../middleware/validate.js';
import { AppError } from '../../errors/app-error.js';

const uuid = z.string().uuid();
const eventSchema = z.object({
  id: uuid,
  name: z.string().trim().min(3).max(40),
  subject: z.string().trim().max(80).optional(),
  query: z.string().trim().max(80).optional(),
  durationMs: z.number().int().min(0).max(120000).optional(),
}).strict();

export const analyticsIngestSchema = z.object({
  body: z.object({
    events: z.array(eventSchema).min(1).max(8),
    visitorKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const analyticsRouter = Router();

analyticsRouter.post('/events', validate(analyticsIngestSchema), asyncHandler(async (req, res) => {
  try {
    const result = await acceptClientEvents(req.validated.body.events, req.validated.body.visitorKey);
    res.status(202).json({ data: result });
  } catch (error) {
    if (error instanceof AppError) throw error;
    res.status(202).json({ data: { accepted: 0, unavailable: true } });
  }
}));
