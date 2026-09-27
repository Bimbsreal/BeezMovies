import { getPool } from '../db/pool.js';
import { config } from '../config/index.js';
import { getMediaAdapter } from './registry.js';
import { recordProviderHealth } from './repository.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';

const SWEEP_GAP_MS = 15 * 60 * 1000;
let lastSweep = 0;

export async function sweepOneMediaReference(now = Date.now()) {
  if (now - lastSweep < SWEEP_GAP_MS) return 0;
  lastSweep = now;
  const providers = config.mediaProviders;
  if (providers.length === 0) return 0;
  const selected = await getPool().query(
    `SELECT r.id, r.external_reference, r.quality, r.provider_id, p.slug
     FROM media_references r
     JOIN providers p ON p.id = r.provider_id
     WHERE p.slug = ANY($1::text[])
       AND r.status <> 'archived'
       AND (r.last_checked_at IS NULL OR r.last_checked_at < NOW() - INTERVAL '6 hours')
     ORDER BY r.last_checked_at NULLS FIRST
     LIMIT 1`,
    [providers],
  );
  if (!selected.rowCount) return 0;
  const row = selected.rows[0];
  const adapter = getMediaAdapter(row.slug);
  if (!adapter?.getFileStatus) return 0;
  try {
    const status = await adapter.getFileStatus({
      external_reference: row.external_reference,
      quality: row.quality,
    });
    const available = status?.availability === 'available';
    await getPool().query(
      `UPDATE media_references
       SET availability_status = $2,
           status = CASE WHEN status = 'archived' THEN status ELSE $3 END,
           last_checked_at = NOW()
       WHERE id = $1`,
      [row.id, available ? 'available' : 'unavailable', available ? 'available' : 'unavailable'],
    );
    await recordProviderHealth(row.provider_id, available ? 'available' : 'unavailable', available ? null : 'MEDIA_UNAVAILABLE');
  } catch (error) {
    logger.warn({ err: sanitize(error.message), code: error.code || 'MEDIA_CHECK_FAILED' }, 'Media reference check failed');
    await getPool().query('UPDATE media_references SET last_checked_at = NOW() WHERE id = $1', [row.id]);
  }
  return 1;
}
