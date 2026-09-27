import { Router } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAdmin, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { publicAdminError } from '../../admin/audit.js';
import {
  adminOverview,
  affiliateEventSchema,
  createCreative,
  creativeSchema,
  listEvents,
  placementPatchSchema,
  providerPatchSchema,
  recordAffiliateEvent,
  updatePlacement,
  updateProvider,
} from '../../monetization/service.js';

export const monetizationAdminRouter = Router();

monetizationAdminRouter.use(requireAdmin);
const catalog = requirePermission('admin.catalog');

function guard(work) {
  return asyncHandler(async (req, res) => {
    try {
      await work(req, res);
    } catch (error) {
      throw publicAdminError(error);
    }
  });
}

monetizationAdminRouter.get('/', guard(async (_req, res) => {
  res.json({ data: await adminOverview() });
}));

monetizationAdminRouter.get('/events', guard(async (_req, res) => {
  res.json({ data: await listEvents() });
}));

monetizationAdminRouter.get('/revenue', guard(async (_req, res) => {
  const overview = await adminOverview();
  res.json({
    data: {
      recorded: overview.recorded,
      estimatedRevenue: overview.estimatedRevenue,
    },
  });
}));

monetizationAdminRouter.patch('/providers/:slug', catalog, validate(providerPatchSchema), guard(async (req, res) => {
  res.json({ data: await updateProvider(req.auth.user.id, req.validated.params.slug, req.validated.body) });
}));

monetizationAdminRouter.patch('/placements/:slug', catalog, validate(placementPatchSchema), guard(async (req, res) => {
  res.json({ data: await updatePlacement(req.auth.user.id, req.validated.params.slug, req.validated.body) });
}));

monetizationAdminRouter.post('/creatives', catalog, validate(creativeSchema), guard(async (req, res) => {
  res.status(201).json({ data: await createCreative(req.auth.user.id, req.validated.body) });
}));

monetizationAdminRouter.post('/affiliate-events', catalog, validate(affiliateEventSchema), guard(async (req, res) => {
  res.status(201).json({ data: await recordAffiliateEvent(req.auth.user.id, req.validated.body) });
}));
