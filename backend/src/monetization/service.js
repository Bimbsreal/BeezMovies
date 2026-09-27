import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { recordAudit } from '../admin/audit.js';
import { PLACEMENTS } from './constants.js';
import { flagEnabled } from '../ops/flags.js';

const placementSlug = z.enum(PLACEMENTS);
const confirm = z.literal(true);

export const publicEventSchema = z.object({
  body: z.object({
    type: z.enum(['impression', 'click', 'completion', 'failure']),
    placement: placementSlug,
    sessionId: z.string().uuid(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const providerPatchSchema = z.object({
  body: z.object({
    status: z.enum(['enabled', 'disabled']),
    priority: z.number().int().min(0).max(100).optional(),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) }).strict(),
});

export const placementPatchSchema = z.object({
  body: z.object({
    enabled: z.boolean(),
    desktopEnabled: z.boolean(),
    mobileEnabled: z.boolean(),
    providerSlug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    priority: z.number().int().min(0).max(100),
    frequencyLimit: z.number().int().min(0).max(5),
    minIntervalSeconds: z.number().int().min(60).max(86400),
    pageLimit: z.number().int().min(0).max(3),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ slug: placementSlug }).strict(),
});

export const creativeSchema = z.object({
  body: z.object({
    placement: placementSlug,
    headline: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(180),
    href: z.string().trim().url().max(300).regex(/^https:\/\//).optional(),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const affiliateEventSchema = z.object({
  body: z.object({
    provider: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    campaign: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/),
    placement: placementSlug,
    conversionReference: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    confirm,
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

function presentProvider(row) {
  return {
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    status: row.status,
    integrationStatus: row.integration_status,
    placementTypes: row.placement_types,
    geographicTargeting: row.supports_geo === null ? 'Unverified' : (row.supports_geo ? 'Supported' : 'Not used'),
    deviceTargeting: row.supports_device === null ? 'Unverified' : (row.supports_device ? 'Supported' : 'Not used'),
    priority: row.priority,
    credentials: row.credentials_status === 'not_required' ? 'Not required' : (
      row.credentials_status === 'configured' ? 'Configured' : 'Not configured'
    ),
    publicDelivery: row.status === 'enabled' && row.integration_status === 'ready' ? 'active' : 'inactive',
  };
}

function presentPlacement(row, creative) {
  const deliverable = row.enabled
    && row.provider_status === 'enabled'
    && row.integration_status === 'ready'
    && creative;
  return {
    slug: row.slug,
    enabled: row.enabled,
    desktopEnabled: row.desktop_enabled,
    mobileEnabled: row.mobile_enabled,
    providerSlug: row.provider_slug,
    priority: row.priority,
    frequencyLimit: row.frequency_limit,
    minIntervalSeconds: row.min_interval_seconds,
    pageLimit: row.page_limit,
    mode: deliverable ? 'house' : 'collapse',
    creative: deliverable ? {
      id: creative.id,
      headline: creative.headline,
      body: creative.body,
      href: creative.href,
      label: 'Sponsored',
    } : null,
  };
}

async function loadRows() {
  const [providers, placements, creatives, settings] = await Promise.all([
    getPool().query('SELECT * FROM monetization_providers ORDER BY priority DESC, slug'),
    getPool().query(
      `SELECT p.*, r.status AS provider_status, r.integration_status
       FROM monetization_placements p
       LEFT JOIN monetization_providers r ON r.slug = p.provider_slug
       ORDER BY p.priority DESC, p.slug`,
    ),
    getPool().query(
      `SELECT DISTINCT ON (placement_slug) id, placement_slug, headline, body, href
       FROM monetization_creatives
       WHERE active = TRUE
       ORDER BY placement_slug, created_at DESC`,
    ),
    getPool().query('SELECT consent_required FROM monetization_settings WHERE id = TRUE'),
  ]);
  const creativeByPlacement = new Map(creatives.rows.map((row) => [row.placement_slug, row]));
  return {
    providers: providers.rows.map(presentProvider),
    placements: placements.rows.map((row) => presentPlacement(row, creativeByPlacement.get(row.slug))),
    consentRequired: Boolean(settings.rows[0]?.consent_required),
  };
}

export async function publicConfig() {
  if (!(await flagEnabled('advertising'))) {
    return { consentRequired: false, timeoutMs: 1500, placements: [] };
  }
  const state = await loadRows();
  return {
    consentRequired: state.consentRequired,
    timeoutMs: 1500,
    placements: state.placements
      .filter((placement) => placement.mode === 'house')
      .map((placement) => ({
        slug: placement.slug,
        desktopEnabled: placement.desktopEnabled,
        mobileEnabled: placement.mobileEnabled,
        priority: placement.priority,
        frequencyLimit: placement.frequencyLimit,
        minIntervalSeconds: placement.minIntervalSeconds,
        pageLimit: placement.pageLimit,
        mode: placement.mode,
        creative: placement.creative,
      })),
  };
}

export async function adminOverview() {
  const state = await loadRows();
  const counts = await getPool().query(
    `SELECT event_type, COUNT(*)::int AS count
     FROM monetization_events
     GROUP BY event_type`,
  );
  const tally = Object.fromEntries(counts.rows.map((row) => [row.event_type, row.count]));
  return {
    ...state,
    recorded: {
      impressions: tally.impression || 0,
      clicks: tally.click || 0,
      completions: tally.completion || 0,
      failures: tally.failure || 0,
      affiliateEvents: tally.affiliate || 0,
    },
    estimatedRevenue: 'Not available',
  };
}

export async function updateProvider(actorId, slug, patch) {
  const row = await getPool().query(
    `UPDATE monetization_providers
     SET status = $2, priority = COALESCE($3, priority), updated_at = NOW()
     WHERE slug = $1
     RETURNING slug, status, integration_status`,
    [slug, patch.status, patch.priority ?? null],
  );
  if (!row.rowCount) throw new AppError('Provider not found', { status: 404, code: 'NOT_FOUND' });
  await recordAudit(null, {
    actorId,
    action: 'MONETIZATION_PROVIDER_UPDATED',
    targetType: 'monetization_provider',
    targetId: slug,
    metadata: { status: patch.status },
  });
  return {
    slug,
    status: row.rows[0].status,
    publicDelivery: row.rows[0].status === 'enabled' && row.rows[0].integration_status === 'ready' ? 'active' : 'inactive',
  };
}

export async function updatePlacement(actorId, slug, patch) {
  const provider = await getPool().query(
    'SELECT slug, kind, placement_types FROM monetization_providers WHERE slug = $1',
    [patch.providerSlug],
  );
  if (!provider.rowCount) throw new AppError('Provider not found', { status: 400, code: 'VALIDATION_ERROR' });
  const allowed = provider.rows[0].placement_types || [];
  if (provider.rows[0].kind !== 'advertising' || !allowed.includes(slug)) {
    throw new AppError('Provider does not support this placement', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const row = await getPool().query(
    `UPDATE monetization_placements
     SET enabled = $2, desktop_enabled = $3, mobile_enabled = $4, provider_slug = $5,
         priority = $6, frequency_limit = $7, min_interval_seconds = $8, page_limit = $9, updated_at = NOW()
     WHERE slug = $1
     RETURNING slug, enabled`,
    [
      slug, patch.enabled, patch.desktopEnabled, patch.mobileEnabled, patch.providerSlug,
      patch.priority, patch.frequencyLimit, patch.minIntervalSeconds, patch.pageLimit,
    ],
  );
  if (!row.rowCount) throw new AppError('Placement not found', { status: 404, code: 'NOT_FOUND' });
  await recordAudit(null, {
    actorId,
    action: 'MONETIZATION_PLACEMENT_UPDATED',
    targetType: 'monetization_placement',
    targetId: slug,
    metadata: { enabled: patch.enabled },
  });
  return { slug, enabled: row.rows[0].enabled };
}

export async function createCreative(actorId, input) {
  if (input.href && (input.href.includes('/download') || input.href.includes('@'))) {
    throw new AppError('Creative link is not allowed', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const row = await getPool().query(
    `INSERT INTO monetization_creatives (placement_slug, headline, body, href)
     VALUES ($1, $2, $3, $4)
     RETURNING id, placement_slug`,
    [input.placement, input.headline, input.body, input.href ?? null],
  );
  await recordAudit(null, {
    actorId,
    action: 'MONETIZATION_CREATIVE_SAVED',
    targetType: 'monetization_creative',
    targetId: row.rows[0].id,
  });
  return { id: row.rows[0].id, placement: row.rows[0].placement_slug };
}

async function frequencyAllows(placement, sessionId) {
  const recent = await getPool().query(
    `SELECT COUNT(*)::int AS count,
            MAX(created_at) AS latest
     FROM monetization_events
     WHERE session_id = $1 AND placement_slug = $2 AND event_type = 'impression'`,
    [sessionId, placement.slug],
  );
  const count = recent.rows[0].count;
  if (count >= placement.page_limit || count >= placement.frequency_limit) return false;
  const latest = recent.rows[0].latest ? new Date(recent.rows[0].latest).getTime() : 0;
  if (latest && Date.now() - latest < placement.min_interval_seconds * 1000) return false;
  return true;
}

export async function recordPublicEvent({ type, placement, sessionId }) {
  const rows = await getPool().query(
    `SELECT p.slug, p.enabled, p.frequency_limit, p.min_interval_seconds, p.page_limit, p.provider_slug,
            r.status AS provider_status, r.integration_status
     FROM monetization_placements p
     JOIN monetization_providers r ON r.slug = p.provider_slug
     WHERE p.slug = $1`,
    [placement],
  );
  const current = rows.rows[0];
  if (!current || !current.enabled || current.provider_status !== 'enabled' || current.integration_status !== 'ready') {
    return { accepted: false };
  }
  if (type === 'impression' && !(await frequencyAllows(current, sessionId))) {
    return { accepted: false, reason: 'frequency' };
  }
  await getPool().query(
    `INSERT INTO monetization_events (event_type, provider_slug, placement_slug, session_id)
     VALUES ($1, $2, $3, $4)`,
    [type, current.provider_slug, placement, sessionId],
  );
  return { accepted: true };
}

export async function recordAffiliateEvent(actorId, input) {
  const provider = await getPool().query(
    'SELECT slug, kind FROM monetization_providers WHERE slug = $1',
    [input.provider],
  );
  if (!provider.rowCount || provider.rows[0].kind !== 'affiliate') {
    throw new AppError('Unknown affiliate provider', { status: 400, code: 'VALIDATION_ERROR' });
  }
  const row = await getPool().query(
    `INSERT INTO monetization_events (
       event_type, provider_slug, placement_slug, campaign, conversion_reference
     ) VALUES ('affiliate', $1, $2, $3, $4)
     RETURNING id`,
    [input.provider, input.placement, input.campaign, input.conversionReference],
  );
  await recordAudit(null, {
    actorId,
    action: 'AFFILIATE_EVENT_RECORDED',
    targetType: 'monetization_event',
    targetId: row.rows[0].id,
    metadata: { provider: input.provider },
  });
  return { id: row.rows[0].id, accepted: true };
}

export async function listEvents() {
  const rows = await getPool().query(
    `SELECT id, event_type, provider_slug, placement_slug, campaign, created_at
     FROM monetization_events
     ORDER BY created_at DESC
     LIMIT 50`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    type: row.event_type,
    provider: row.provider_slug,
    placement: row.placement_slug,
    campaign: row.campaign,
    createdAt: row.created_at,
  }));
}
