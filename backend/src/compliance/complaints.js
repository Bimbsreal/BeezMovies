import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { AppError } from '../errors/app-error.js';
import { recordAudit } from '../admin/audit.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const statuses = ['RECEIVED', 'UNDER_REVIEW', 'ACTION_REQUIRED', 'REMOVED', 'REJECTED', 'RESOLVED'];

export const createComplaintSchema = z.object({
  body: z.object({
    movieSlug: slug,
    summary: z.string().trim().min(8).max(500),
    contact: z.string().trim().email().max(200),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({}).strict(),
});

export const updateComplaintSchema = z.object({
  body: z.object({
    confirm: z.literal(true),
    status: z.enum(statuses),
    actionNote: z.string().trim().max(300).optional(),
  }).strict(),
  query: z.object({}).strict(),
  params: z.object({ id: z.string().uuid() }).strict(),
});

function caseCode() {
  return `BM${randomBytes(4).toString('hex')}`;
}

export async function createComplaint({ movieSlug, summary, contact }) {
  const movie = await getPool().query(
    `SELECT id FROM movies WHERE slug = $1 AND archived_at IS NULL`,
    [movieSlug],
  );
  if (!movie.rowCount) {
    throw new AppError('Movie not found', { status: 404, code: 'NOT_FOUND' });
  }
  const code = caseCode();
  await getPool().query(
    `INSERT INTO content_complaints (case_code, movie_id, summary, contact)
     VALUES ($1, $2, $3, $4)`,
    [code, movie.rows[0].id, summary, contact],
  );
  return { caseCode: code, status: 'RECEIVED' };
}

export async function listComplaints() {
  const rows = await getPool().query(
    `SELECT c.id, c.case_code, c.status, c.summary, c.contact, c.action_note, c.created_at,
            m.slug, m.canonical_title
     FROM content_complaints c
     JOIN movies m ON m.id = c.movie_id
     ORDER BY c.created_at DESC
     LIMIT 50`,
  );
  return rows.rows.map((row) => ({
    id: row.id,
    caseCode: row.case_code,
    status: row.status,
    summary: row.summary,
    contact: row.contact,
    actionNote: row.action_note,
    createdAt: row.created_at,
    movieSlug: row.slug,
    movieTitle: row.canonical_title,
  }));
}

export async function updateComplaint(actorId, id, { status, actionNote }) {
  const current = await getPool().query(
    `SELECT movie_id FROM content_complaints WHERE id = $1`,
    [id],
  );
  if (!current.rowCount) throw new AppError('Complaint not found', { status: 404, code: 'NOT_FOUND' });
  await getPool().query(
    `UPDATE content_complaints
     SET status = $2, action_note = COALESCE($3, action_note), resolved_by = $4, updated_at = NOW()
     WHERE id = $1`,
    [id, status, actionNote || null, actorId],
  );
  if (status === 'REMOVED') {
    await getPool().query(
      `UPDATE media_references
       SET rights_status = 'REMOVED', status = 'unavailable'
       WHERE movie_id = $1`,
      [current.rows[0].movie_id],
    );
  }
  await recordAudit(null, {
    actorId,
    action: 'CONTENT_COMPLAINT_UPDATED',
    targetType: 'content_complaint',
    targetId: id,
    metadata: { status },
  });
  return { id, status };
}
