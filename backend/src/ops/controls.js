import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { recordAudit } from '../admin/audit.js';
import { clearOperationsCache } from './flags.js';

const confirm = z.literal(true);

export const operationsSchema = z.object({
  body: z.object({
    confirm,
    maintenance: z.object({
      enabled: z.boolean(),
      message: z.string().trim().max(180),
    }).optional(),
    flags: z.object({
      ingestion: z.boolean(),
      searchIndexing: z.boolean(),
      advertising: z.boolean(),
    }).optional(),
    backup: z.object({
      outcome: z.enum(['success', 'failure']),
      sizeBytes: z.number().int().min(0).max(1_000_000_000_000).optional(),
      restore: z.enum(['passed', 'failed']).optional(),
    }).optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

async function writeSetting(key, value, actorId) {
  await getPool().query(
    `INSERT INTO platform_settings (key, value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, NOW(), $3)
     ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
    [key, JSON.stringify(value), actorId],
  );
}

export async function updateOperations(actorId, input) {
  if (input.maintenance) {
    await writeSetting('maintenance', input.maintenance, actorId);
    await recordAudit(null, {
      actorId,
      action: 'MAINTENANCE_CHANGED',
      targetType: 'setting',
      targetId: 'maintenance',
      metadata: { enabled: input.maintenance.enabled ? 'yes' : 'no' },
    });
  }
  if (input.flags) {
    await writeSetting('feature_flags', input.flags, actorId);
    await recordAudit(null, {
      actorId,
      action: 'FLAGS_CHANGED',
      targetType: 'setting',
      targetId: 'feature_flags',
      metadata: {
        ingestion: input.flags.ingestion ? 'on' : 'off',
        searchIndexing: input.flags.searchIndexing ? 'on' : 'off',
        advertising: input.flags.advertising ? 'on' : 'off',
      },
    });
  }
  if (input.backup) {
    const current = await getPool().query(`SELECT value FROM platform_settings WHERE key = 'backup_status'`);
    const previous = current.rows[0]?.value || {
      maxAgeHours: 26, sizeBytes: null, lastSuccessAt: null, lastFailureAt: null,
    };
    const now = new Date().toISOString();
    const nextSize = input.backup.sizeBytes ?? previous.sizeBytes ?? null;
    const next = {
      maxAgeHours: previous.maxAgeHours || 26,
      sizeBytes: nextSize,
      previousSizeBytes: input.backup.outcome === 'success' && previous.sizeBytes != null
        ? previous.sizeBytes
        : previous.previousSizeBytes || null,
      lastSuccessAt: input.backup.outcome === 'success' ? now : previous.lastSuccessAt || null,
      lastFailureAt: input.backup.outcome === 'failure' ? now : previous.lastFailureAt || null,
      lastRestoreFailureAt: input.backup.restore === 'failed'
        ? now
        : input.backup.restore === 'passed'
          ? null
          : previous.lastRestoreFailureAt || null,
    };
    await writeSetting('backup_status', next, actorId);
    await recordAudit(null, {
      actorId,
      action: 'BACKUP_RECORDED',
      targetType: 'setting',
      targetId: 'backup_status',
      metadata: { outcome: input.backup.outcome },
    });
  }
  clearOperationsCache();
  return { updated: true };
}
