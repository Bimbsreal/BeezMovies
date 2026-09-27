import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { logger } from '../logger/index.js';

const SECRET_KEYS = ['password', 'password_hash', 'secret', 'token', 'api_key', 'apiKey'];

export function publicAdminError(error) {
  if (error instanceof AppError) return error;
  logger.error({ event: 'ADMIN_REQUEST_FAILED', code: error?.code || 'ADMIN_UNAVAILABLE' }, 'ADMIN_REQUEST_FAILED');
  return new AppError('The admin request could not be completed', {
    status: 503,
    code: 'ADMIN_UNAVAILABLE',
  });
}

function safeMetadata(metadata) {
  const source = metadata && typeof metadata === 'object' ? metadata : {};
  const copy = {};
  for (const [key, value] of Object.entries(source)) {
    if (SECRET_KEYS.includes(key)) continue;
    if (typeof value === 'string' && value.length > 300) {
      copy[key] = value.slice(0, 300);
    } else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) {
      copy[key] = value;
    }
  }
  return copy;
}

export async function recordAudit(client, {
  actorId, action, targetType, targetId = null, result = 'success', metadata = {},
}) {
  const db = client || getPool();
  await db.query(
    `INSERT INTO admin_audit_events (
       actor_user_id, action, target_type, target_id, result, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [actorId, action, targetType, targetId, result, JSON.stringify(safeMetadata(metadata))],
  );
  logger.info({
    event: action,
    actorId,
    targetType,
    targetId,
    result,
  }, action);
}

export async function listAudit({ limit = 30 }) {
  const rows = await getPool().query(
    `SELECT e.id, e.action, e.target_type, e.target_id, e.result, e.metadata, e.created_at,
            u.email AS actor_email
     FROM admin_audit_events e
     JOIN users u ON u.id = e.actor_user_id
     ORDER BY e.created_at DESC
     LIMIT $1`,
    [limit],
  );
  return rows.rows.map((row) => ({
    id: row.id,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    result: row.result,
    metadata: row.metadata,
    createdAt: row.created_at,
    actorEmail: row.actor_email,
  }));
}
