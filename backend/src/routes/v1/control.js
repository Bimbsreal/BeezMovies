import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../middleware/async-handler.js';
import { requireAdmin, requirePermission } from '../../middleware/authorize.js';
import { validate } from '../../middleware/validate.js';
import { publicAdminError } from '../../admin/audit.js';
import { listRails, railPatchSchema, updateRail } from '../../discovery/rails.js';
import {
  archiveGenre,
  archiveMedia,
  archiveMovie,
  createMovie,
  mergeGenre,
  movieCreateSchema,
  genreMergeSchema,
  reindexCollection,
  restoreMovie,
  unpublishMovie,
  batchReindexSchema,
  bulkSchema,
  checkProvider,
  collectionCreateSchema,
  collectionOrderSchema,
  collectionPatchSchema,
  confirmSchema,
  createCollection,
  createGenre,
  dashboard,
  disableMedia,
  fullReindexSchema,
  enableMedia,
  genreCreateSchema,
  genrePatchSchema,
  getMovie,
  listAudit,
  listCollections,
  listGenres,
  listMedia,
  listMovies,
  listPeople,
  listProviders,
  listUsers,
  movieIdSchema,
  movieListSchema,
  moviePatchSchema,
  orderCollection,
  approveMovie,
  publishMovie,
  submitMovie,
  queueBulk,
  reindexBatch,
  reindexMovie,
  retryIngestion,
  searchStatus,
  setCollectionPublished,
  setProviderStatus,
  setUserRoles,
  setUserStatus,
  settingsSchema,
  startFullReindex,
  systemStatus,
  updateCollection,
  updateGenre,
  updateMovie,
  updateSettings,
  userRolesSchema,
  userStatusSchema,
  validateMedia,
} from '../../admin/control.js';
import { operationsSchema, updateOperations } from '../../ops/controls.js';
import { getPool } from '../../db/pool.js';
import { operationsBoard } from '../../ops/board.js';
import {
  createIncident,
  incidentCreateSchema,
  incidentUpdateSchema,
  listIncidents,
  syncOperationalIncidents,
  updateIncident,
} from '../../ops/incidents.js';
import { queueCatalogCorrections } from '../../ops/quality.js';
import {
  localizationBoard,
  setAlternateTitleStatus,
  titleStatusSchema,
} from '../../catalog/localization.js';
import {
  addCountryAlias,
  countryAliasSchema,
  countryPatchSchema,
  countryQuality,
  countrySeedReport,
  listCountries,
  setCountryActive,
} from '../../catalog/countries.js';
import {
  classificationReport,
  contentTypePatchSchema,
  industryLabelSchema,
  listClassificationReviews,
  listContentTypes,
  listIndustryLabels,
  setContentTypeActive,
  setIndustryLabel,
} from '../../catalog/industries.js';
import { adminSeriesBoard } from '../../catalog/episodes.js';
import {
  catalogHealth,
  decideReview,
  listReviews,
  mergeMovies,
  queueMovieRefresh,
  validateMovie,
} from '../../catalog/quality.js';

export const controlRouter = Router();

controlRouter.use(requireAdmin);

function guard(work) {
  return asyncHandler(async (req, res) => {
    try {
      await work(req, res);
    } catch (error) {
      throw publicAdminError(error);
    }
  });
}

const catalog = requirePermission('admin.catalog');
const users = requirePermission('admin.users');
const roles = requirePermission('admin.roles');

controlRouter.get('/catalog-health', guard(async (_req, res) => {
  res.json({ data: await catalogHealth() });
}));

controlRouter.get('/review', guard(async (_req, res) => {
  res.json({ data: await listReviews() });
}));

controlRouter.post('/review/:id', catalog, validate(z.object({
  body: z.object({
    action: z.enum(['approve', 'reject']),
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
})), guard(async (req, res) => {
  res.json({ data: await decideReview(req.auth.user.id, req.validated.params.id, req.validated.body.action) });
}));

controlRouter.post('/movies/:id/refresh', catalog, validate(z.object({
  body: z.object({ confirm: z.literal(true) }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
})), guard(async (req, res) => {
  res.status(202).json({ data: await queueMovieRefresh(req.validated.params.id) });
}));

controlRouter.post('/movies/:id/validate', catalog, validate(movieIdSchema), guard(async (req, res) => {
  res.json({ data: await validateMovie(req.validated.params.id) });
}));

controlRouter.post('/movies/:id/merge', catalog, validate(z.object({
  body: z.object({
    sourceId: z.string().uuid(),
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
})), guard(async (req, res) => {
  res.json({ data: await mergeMovies(req.auth.user.id, req.validated.params.id, req.validated.body.sourceId) });
}));

controlRouter.get('/dashboard', guard(async (_req, res) => {
  res.json({ data: await dashboard() });
}));

controlRouter.get('/audit', guard(async (_req, res) => {
  res.json({ data: await listAudit({ limit: 40 }) });
}));

controlRouter.get('/system', guard(async (_req, res) => {
  res.json({ data: await systemStatus() });
}));

controlRouter.patch('/settings', catalog, validate(settingsSchema), guard(async (req, res) => {
  res.json({ data: await updateSettings(req.auth.user.id, req.validated.body) });
}));

controlRouter.patch('/operations', catalog, validate(operationsSchema), guard(async (req, res) => {
  res.json({ data: await updateOperations(req.auth.user.id, req.validated.body) });
}));

const confirmOnlySchema = z.object({
  body: z.object({ confirm: z.literal(true) }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

controlRouter.get('/operations', guard(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  let databaseStatus = 'unavailable';
  try {
    await getPool().query('SELECT 1');
    databaseStatus = 'ok';
  } catch {
    databaseStatus = 'unavailable';
  }
  res.json({ data: await operationsBoard(databaseStatus) });
}));

controlRouter.get('/operations/incidents', guard(async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({ data: await listIncidents() });
}));

controlRouter.post('/operations/incidents', catalog, validate(incidentCreateSchema), guard(async (req, res) => {
  res.status(201).json({ data: await createIncident(req.auth.user.id, req.validated.body) });
}));

controlRouter.post('/operations/incidents/scan', catalog, validate(confirmOnlySchema), guard(async (_req, res) => {
  let databaseStatus = 'ok';
  try {
    await getPool().query('SELECT 1');
  } catch {
    databaseStatus = 'unavailable';
  }
  res.json({ data: await syncOperationalIncidents(databaseStatus) });
}));

controlRouter.post('/operations/incidents/:id', catalog, validate(incidentUpdateSchema), guard(async (req, res) => {
  res.json({ data: await updateIncident(req.auth.user.id, req.validated.params.id, req.validated.body) });
}));

controlRouter.post('/operations/quality', catalog, validate(confirmOnlySchema), guard(async (_req, res) => {
  res.status(202).json({ data: await queueCatalogCorrections() });
}));

controlRouter.get('/movies', validate(movieListSchema), guard(async (req, res) => {
  res.json(await listMovies(req.validated.query));
}));

controlRouter.get('/movies/:id', validate(movieIdSchema), guard(async (req, res) => {
  res.json({ data: await getMovie(req.validated.params.id) });
}));

controlRouter.patch('/movies/:id', catalog, validate(moviePatchSchema), guard(async (req, res) => {
  res.json({ data: await updateMovie(req.auth.user.id, req.validated.params.id, req.validated.body) });
}));

controlRouter.post('/movies/bulk', catalog, validate(bulkSchema), guard(async (req, res) => {
  res.status(202).json({ data: await queueBulk(req.auth.user.id, req.validated.body) });
}));

controlRouter.get('/editorial', guard(async (_req, res) => {
  const { editorialQueue } = await import('../../admin/editorial.js');
  res.json({ data: await editorialQueue() });
}));

controlRouter.post('/movies/:id/submit', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await submitMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/movies/:id/approve', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await approveMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/movies/:id/publish', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await publishMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/movies/:id/archive', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await archiveMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/movies', catalog, validate(movieCreateSchema), guard(async (req, res) => {
  res.status(201).json({ data: await createMovie(req.auth.user.id, req.validated.body) });
}));

controlRouter.post('/movies/:id/unpublish', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await unpublishMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/movies/:id/restore', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await restoreMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.get('/localization', guard(async (_req, res) => {
  res.json({ data: await localizationBoard() });
}));

controlRouter.post('/localization/titles/:id', catalog, validate(titleStatusSchema), guard(async (req, res) => {
  res.json({ data: await setAlternateTitleStatus(req.validated.params.id, req.validated.body.status) });
}));

controlRouter.get('/countries', guard(async (_req, res) => {
  res.json({
    data: await listCountries(),
    quality: await countryQuality(),
    report: await countrySeedReport(),
  });
}));

controlRouter.patch('/countries/:id', catalog, validate(countryPatchSchema), guard(async (req, res) => {
  res.json({ data: await setCountryActive(req.validated.params.id, req.validated.body.active) });
}));

controlRouter.post('/countries/:id/aliases', catalog, validate(countryAliasSchema), guard(async (req, res) => {
  res.status(201).json({ data: await addCountryAlias(req.validated.params.id, req.validated.body.alias) });
}));

controlRouter.get('/series', guard(async (_req, res) => {
  res.json({ data: await adminSeriesBoard() });
}));

controlRouter.get('/content-types', guard(async (_req, res) => {
  res.json({
    data: await listContentTypes(),
    labels: await listIndustryLabels(),
    report: await classificationReport(),
    reviews: await listClassificationReviews(),
    series: await adminSeriesBoard(),
  });
}));

controlRouter.post('/content-types/:id', catalog, validate(contentTypePatchSchema), guard(async (req, res) => {
  res.json({ data: await setContentTypeActive(req.validated.params.id, req.validated.body.active) });
}));

controlRouter.post('/industry-labels/:id', catalog, validate(industryLabelSchema), guard(async (req, res) => {
  res.json({ data: await setIndustryLabel(req.validated.params.id, req.validated.body.label) });
}));

controlRouter.get('/genres', guard(async (_req, res) => {
  res.json({ data: await listGenres() });
}));

controlRouter.post('/genres', catalog, validate(genreCreateSchema), guard(async (req, res) => {
  res.status(201).json({ data: await createGenre(req.auth.user.id, req.validated.body) });
}));

controlRouter.patch('/genres/:id', catalog, validate(genrePatchSchema), guard(async (req, res) => {
  res.json({ data: await updateGenre(req.auth.user.id, req.validated.params.id, req.validated.body) });
}));

controlRouter.post('/genres/:id/archive', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await archiveGenre(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/genres/:id/merge', catalog, validate(genreMergeSchema), guard(async (req, res) => {
  res.json({ data: await mergeGenre(req.auth.user.id, req.validated.params.id, req.validated.body.targetId) });
}));

controlRouter.get('/collections', guard(async (_req, res) => {
  res.json({ data: await listCollections() });
}));

controlRouter.post('/collections', catalog, validate(collectionCreateSchema), guard(async (req, res) => {
  res.status(201).json({ data: await createCollection(req.auth.user.id, req.validated.body) });
}));

controlRouter.patch('/collections/:id', catalog, validate(collectionPatchSchema), guard(async (req, res) => {
  res.json({ data: await updateCollection(req.auth.user.id, req.validated.params.id, req.validated.body) });
}));

controlRouter.post('/collections/:id/publish', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await setCollectionPublished(req.auth.user.id, req.validated.params.id, true) });
}));

controlRouter.post('/collections/:id/reindex', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.status(202).json({ data: await reindexCollection(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/collections/:id/archive', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await setCollectionPublished(req.auth.user.id, req.validated.params.id, false) });
}));

controlRouter.post('/collections/:id/order', catalog, validate(collectionOrderSchema), guard(async (req, res) => {
  res.json({ data: await orderCollection(req.auth.user.id, req.validated.params.id, req.validated.body.movieIds) });
}));

controlRouter.get('/people', guard(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : undefined;
  const department = typeof req.query.department === 'string' ? req.query.department.slice(0, 40) : undefined;
  res.json({ data: await listPeople({ q, department }) });
}));

controlRouter.get('/media', guard(async (_req, res) => {
  res.json({ data: await listMedia() });
}));

controlRouter.post('/media/:id/disable', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await disableMedia(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/media/:id/enable', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await enableMedia(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/media/:id/archive', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await archiveMedia(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/media/:id/validate', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await validateMedia(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.get('/providers', guard(async (_req, res) => {
  res.json({ data: await listProviders() });
}));

controlRouter.post('/providers/:id/enable', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await setProviderStatus(req.auth.user.id, req.validated.params.id, 'active') });
}));

controlRouter.post('/providers/:id/disable', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await setProviderStatus(req.auth.user.id, req.validated.params.id, 'inactive') });
}));

controlRouter.post('/providers/:id/health-check', catalog, validate(confirmSchema), guard(async (req, res) => {
  res.json({ data: await checkProvider(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.get('/rails', catalog, guard(async (_req, res) => {
  res.json({ data: await listRails() });
}));

controlRouter.patch('/rails/:id', catalog, validate(railPatchSchema), guard(async (req, res) => {
  res.json({ data: await updateRail(req.validated.params.id, req.validated.body) });
}));

controlRouter.get('/users', users, guard(async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q : '';
  res.json({ data: await listUsers(q) });
}));

controlRouter.patch('/users/:id', users, validate(userStatusSchema), guard(async (req, res) => {
  res.json({ data: await setUserStatus(req.auth.user.id, req.validated.params.id, req.validated.body.accountStatus) });
}));

controlRouter.post('/users/:id/roles', roles, validate(userRolesSchema), guard(async (req, res) => {
  res.json({ data: await setUserRoles(req.auth.user.id, req.validated.params.id, req.validated.body.roles) });
}));

controlRouter.get('/search/status', guard(async (_req, res) => {
  res.json({ data: await searchStatus() });
}));

controlRouter.post('/search/movies/:id/reindex', catalog, validate(movieIdSchema), guard(async (req, res) => {
  res.status(202).json({ data: await reindexMovie(req.auth.user.id, req.validated.params.id) });
}));

controlRouter.post('/search/reindex/batch', catalog, validate(batchReindexSchema), guard(async (req, res) => {
  res.status(202).json({ data: await reindexBatch(req.auth.user.id, req.validated.body.ids) });
}));

controlRouter.post('/search/reindex/full', catalog, validate(fullReindexSchema), guard(async (req, res) => {
  res.status(202).json({ data: await startFullReindex(req.auth.user.id) });
}));

controlRouter.post('/ingestion/jobs/:id/retry', catalog, validate(movieIdSchema), guard(async (req, res) => {
  res.json({ data: await retryIngestion(req.auth.user.id, req.validated.params.id) });
}));
