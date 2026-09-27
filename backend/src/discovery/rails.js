import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { invalidateDiscoveryCache } from './cache.js';

export const railPatchSchema = z.object({
  body: z.object({
    title: z.string().trim().min(1).max(80),
    enabled: z.boolean(),
    sortOrder: z.number().int().min(0).max(1000),
    itemLimit: z.number().int().min(1).max(24),
    confirm: z.literal(true),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

export async function listRails() {
  const result = await getPool().query(
    `SELECT id, slug, title, source_type, source_slug, sort_order, item_limit, enabled, cache_seconds
     FROM homepage_rails
     ORDER BY sort_order ASC, slug ASC`,
  );
  return result.rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    source: row.source_type,
    sourceSlug: row.source_slug,
    sortOrder: row.sort_order,
    itemLimit: row.item_limit,
    enabled: row.enabled,
    cacheSeconds: row.cache_seconds,
  }));
}

export async function updateRail(id, input) {
  const result = await getPool().query(
    `UPDATE homepage_rails
     SET title = $2, enabled = $3, sort_order = $4, item_limit = $5
     WHERE id = $1
     RETURNING id`,
    [id, input.title, input.enabled, input.sortOrder, input.itemLimit],
  );
  if (!result.rowCount) throw new AppError('Rail not found', { status: 404, code: 'NOT_FOUND' });
  invalidateDiscoveryCache();
  return (await listRails()).find((rail) => rail.id === id);
}
