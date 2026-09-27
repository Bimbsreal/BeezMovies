import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAdmin } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';
import { config } from '../../config/index.js';
import {
  createComplaint,
  createComplaintSchema,
  listComplaints,
  updateComplaint,
  updateComplaintSchema,
} from '../../compliance/complaints.js';

export const complaintsRouter = Router();

complaintsRouter.post(
  '/',
  createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: config.isProduction ? 10 : 40,
  }),
  validate(createComplaintSchema),
  asyncHandler(async (req, res) => {
    const created = await createComplaint(req.validated.body);
    res.status(201).json({ data: created });
  }),
);

export const complaintsAdminRouter = Router();

complaintsAdminRouter.use(requireAdmin);

complaintsAdminRouter.get('/', asyncHandler(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await listComplaints() });
}));

complaintsAdminRouter.post('/:id', validate(updateComplaintSchema), asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  const updated = await updateComplaint(req.auth.user.id, req.validated.params.id, req.validated.body);
  res.json({ data: updated });
}));
