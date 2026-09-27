import { Router } from 'express';
import { recordAdminAccess } from '../../auth/service.js';
import { clientIp, clientUserAgent } from '../../auth/events.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAuth } from '../../middleware/authenticate.js';
import { requireAdmin } from '../../middleware/authorize.js';
import { privateCache } from '../../middleware/private-cache.js';
import { ingestionRouter } from './ingestion.js';
import { searchAdminRouter } from './search-admin.js';
import { controlRouter } from './control.js';
import { analyticsAdminRouter } from './analytics-admin.js';
import { monetizationAdminRouter } from './monetization-admin.js';
import { complaintsAdminRouter } from './complaints.js';

export const adminRouter = Router();

adminRouter.use(privateCache);
adminRouter.use(requireAuth);
adminRouter.use('/analytics', analyticsAdminRouter);
adminRouter.use('/complaints', complaintsAdminRouter);
adminRouter.use(controlRouter);
adminRouter.use('/monetization', monetizationAdminRouter);
adminRouter.use('/ingestion', ingestionRouter);
adminRouter.use('/search', searchAdminRouter);

adminRouter.get('/me', requireAdmin, asyncHandler(async (req, res) => {
  await recordAdminAccess({
    userId: req.auth.user.id,
    ip: clientIp(req),
    userAgent: clientUserAgent(req),
  });
  res.json({ user: req.auth.user });
}));
