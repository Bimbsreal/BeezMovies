import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAdmin } from '../../middleware/authorize.js';
import { enqueueReindex } from '../../search/indexer.js';

export const searchAdminRouter = Router();

searchAdminRouter.use(requireAdmin);

searchAdminRouter.post('/reindex', asyncHandler(async (_req, res) => {
  const queued = await enqueueReindex();
  res.status(queued.created ? 202 : 200).json({
    data: {
      id: queued.job.id,
      status: queued.job.status,
      created: queued.created,
    },
  });
}));
