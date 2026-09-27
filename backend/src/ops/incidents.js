import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { recordAudit } from '../admin/audit.js';
import { operationalSnapshot } from './status.js';

const OPEN = ['DETECTED', 'INVESTIGATING', 'MITIGATING'];
const AUTO = {
  DATABASE_UNAVAILABLE: ['CRITICAL', 'DATABASE'],
  DOWNLOADS_FAILING: ['CRITICAL', 'DOWNLOADS'],
  BACKUP_FAILED: ['CRITICAL', 'BACKUPS'],
  SEARCH_UNAVAILABLE: ['HIGH', 'SEARCH'],
  PROVIDER_OUTAGE: ['HIGH', 'MEDIA PROVIDERS'],
  WORKER_DOWN: ['HIGH', 'WORKERS'],
  QUEUE_BACKLOG: ['HIGH', 'QUEUE'],
};

const SERVICES = [
  'APPLICATION', 'DATABASE', 'CACHE', 'QUEUE', 'WORKERS', 'SEARCH',
  'MEDIA PROVIDERS', 'CDN', 'PWA', 'BACKUPS', 'DOWNLOADS', 'SECURITY',
];

export const incidentCreateSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    severity: z.enum(['CRITICAL', 'HIGH', 'MEDIUM']),
    service: z.enum(SERVICES),
    summary: z.string().trim().min(8).max(300),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const incidentUpdateSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    status: z.enum(['DETECTED', 'INVESTIGATING', 'MITIGATING', 'RESOLVED', 'POSTMORTEM']),
    note: z.string().trim().min(2).max(500).optional(),
    impact: z.string().trim().min(8).max(500).optional(),
    cause: z.string().trim().min(8).max(500).optional(),
    mitigation: z.string().trim().min(8).max(500).optional(),
    prevention: z.string().trim().min(8).max(500).optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

function caseCode() {
  return `IN${randomBytes(4).toString('hex').toUpperCase()}`;
}

function present(row) {
  return {
    id: row.id,
    caseCode: row.case_code,
    severity: row.severity,
    status: row.status,
    service: row.service,
    summary: row.summary,
    detectionCode: row.detection_code,
    startedAt: row.started_at,
    resolvedAt: row.resolved_at,
    impact: row.impact,
    cause: row.cause,
    mitigation: row.mitigation,
    prevention: row.prevention,
  };
}

export async function listIncidents() {
  const result = await getPool().query(
    `SELECT id, case_code, severity, status, service, summary, detection_code,
            started_at, resolved_at, impact, cause, mitigation, prevention
     FROM ops_incidents
     ORDER BY started_at DESC
     LIMIT 40`,
  );
  return result.rows.map(present);
}

export async function listNotifications() {
  const result = await getPool().query(
    `SELECT id, case_code, severity, status, service, summary, started_at
     FROM ops_incidents
     WHERE status = ANY($1::text[]) AND severity IN ('CRITICAL', 'HIGH')
     ORDER BY started_at DESC
     LIMIT 10`,
    [OPEN],
  );
  return result.rows.map((row) => ({
    id: row.id,
    caseCode: row.case_code,
    severity: row.severity,
    status: row.status,
    service: row.service,
    summary: row.summary,
    startedAt: row.started_at,
  }));
}

async function insertIncident(client, { severity, service, summary, detectionCode, actorId }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await client.query(
        `INSERT INTO ops_incidents (
           case_code, severity, status, service, summary, detection_code, opened_by, updated_by
         ) VALUES ($1, $2, 'DETECTED', $3, $4, $5, $6, $6)
         RETURNING id, case_code`,
        [caseCode(), severity, service, summary, detectionCode, actorId],
      );
      return created.rows[0];
    } catch (error) {
      if (error.code !== '23505') throw error;
    }
  }
  throw new AppError('Incident could not be recorded', { status: 503, code: 'INCIDENT_UNAVAILABLE' });
}

export async function createIncident(actorId, input) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const row = await insertIncident(client, { ...input, detectionCode: null, actorId });
    await client.query('COMMIT');
    await recordAudit(null, {
      actorId,
      action: 'INCIDENT_OPENED',
      targetType: 'incident',
      targetId: row.id,
      metadata: { status: 'DETECTED', service: input.service },
    });
    return { id: row.id, caseCode: row.case_code, status: 'DETECTED' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function updateIncident(actorId, id, input) {
  if (input.status === 'POSTMORTEM' && !(input.impact && input.cause && input.mitigation && input.prevention)) {
    throw new AppError('A postmortem needs impact, cause, mitigation, and prevention', {
      status: 400,
      code: 'VALIDATION_ERROR',
    });
  }
  const resolved = input.status === 'RESOLVED' || input.status === 'POSTMORTEM';
  const result = await getPool().query(
    `UPDATE ops_incidents
     SET status = $2,
         updated_by = $3,
         updated_at = NOW(),
         resolved_at = CASE WHEN $4::boolean THEN COALESCE(resolved_at, NOW()) ELSE resolved_at END,
         impact = COALESCE($5, impact),
         cause = COALESCE($6, cause),
         mitigation = COALESCE($7, mitigation),
         prevention = COALESCE($8, prevention)
     WHERE id = $1
     RETURNING id, case_code, status`,
    [id, input.status, actorId, resolved, input.impact || null, input.cause || null, input.mitigation || null, input.prevention || null],
  );
  if (!result.rowCount) throw new AppError('Incident not found', { status: 404, code: 'NOT_FOUND' });
  if (input.note) {
    await getPool().query(
      `INSERT INTO ops_incident_notes (incident_id, actor_id, body) VALUES ($1, $2, $3)`,
      [id, actorId, input.note],
    );
  }
  await recordAudit(null, {
    actorId,
    action: 'INCIDENT_UPDATED',
    targetType: 'incident',
    targetId: id,
    metadata: { status: input.status },
  });
  return { id, caseCode: result.rows[0].case_code, status: result.rows[0].status };
}

export async function syncOperationalIncidents(databaseStatus = 'ok') {
  const snapshot = await operationalSnapshot(databaseStatus);
  const interesting = snapshot.alerts.filter((alert) => AUTO[alert.code]);
  if (interesting.length === 0) return { opened: 0 };
  const existing = await getPool().query(
    `SELECT detection_code FROM ops_incidents
     WHERE detection_code IS NOT NULL AND status = ANY($1::text[])`,
    [OPEN],
  );
  const openCodes = new Set(existing.rows.map((row) => row.detection_code));
  let opened = 0;
  for (const alert of interesting) {
    if (opened >= 3 || openCodes.has(alert.code)) continue;
    const [severity, service] = AUTO[alert.code];
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await insertIncident(client, {
        severity,
        service,
        summary: alert.message,
        detectionCode: alert.code,
        actorId: null,
      });
      await client.query('COMMIT');
      opened += 1;
      openCodes.add(alert.code);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return { opened };
}
