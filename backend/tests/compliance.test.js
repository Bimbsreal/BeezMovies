import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { listResolutionCandidates } from '../src/media/repository.js';
import { migrate } from '../src/db/migrate.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const password = 'CorrectHorse1';
const email = `rights.${randomUUID()}@example.com`;
let userId = null;

before(async () => {
  await migrate();
});

after(async () => {
  const pool = getPool();
  await pool.query(
    `UPDATE media_references
     SET rights_status = 'AUTHORIZED', status = 'available', availability_status = 'available'
     WHERE external_reference IN ('dev-seed:nosferatu:1080p', 'dev:ok:nosferatu')`,
  );
  if (userId) {
    await pool.query('DELETE FROM content_complaints WHERE resolved_by = $1', [userId]);
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await pool.query(`DELETE FROM content_complaints WHERE summary LIKE 'Phase 27 claim%'`);
  await closePool();
  await closeRedis();
});

test('rights, complaints, and account deletion stay separated from public browsing', async () => {
  const pool = getPool();
  const open = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(open.status, 200);

  const night = await pool.query(`SELECT id FROM movies WHERE slug = 'night-of-the-living-dead'`);
  const provider = await pool.query(`SELECT id FROM providers WHERE slug = 'development-media'`);
  const pending = await pool.query(
    `INSERT INTO media_references (
       movie_id, provider_id, external_reference, media_type, quality,
       status, availability_status, rights_status
     ) VALUES ($1, $2, $3, 'download', '720p', 'available', 'available', 'PENDING_REVIEW')
     RETURNING id`,
    [night.rows[0].id, provider.rows[0].id, `dev:rights:${randomUUID()}`],
  );
  const candidates = await listResolutionCandidates(night.rows[0].id);
  assert.equal(candidates.some((item) => item.id === pending.rows[0].id), false);
  await pool.query('DELETE FROM media_references WHERE id = $1', [pending.rows[0].id]);
  const stillClosed = await request(app).post('/api/v1/movies/night-of-the-living-dead/download').set(csrf).send({});
  assert.equal(stillClosed.status, 409);

  const contact = `claim.${randomUUID()}@example.com`;
  const filed = await request(app).post('/api/v1/complaints').set(csrf).send({
    movieSlug: 'nosferatu',
    summary: 'Phase 27 claim for a catalog listing.',
    contact,
  });
  assert.equal(filed.status, 201);
  assert.equal(filed.body.data.status, 'RECEIVED');
  assert.equal(JSON.stringify(filed.body).includes(contact), false);

  const hidden = await request(app).get('/api/v1/admin/complaints').set(csrf);
  assert.equal(hidden.status, 401);

  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email,
    password,
    displayName: 'Rights Audit',
  });
  assert.equal(registered.status, 201);
  userId = registered.body.user.id;
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const forbidden = await request(app).get('/api/v1/admin/complaints').set(csrf).set('Cookie', cookie);
  assert.equal(forbidden.status, 403);

  const removed = await request(app).post('/api/v1/auth/account/delete').set(csrf).set('Cookie', cookie).send({ password, confirm: true });
  assert.equal(removed.status, 200);
  const tombstone = await pool.query(`SELECT email, display_name FROM users WHERE id = $1`, [userId]);
  assert.equal(tombstone.rows[0].email, `deleted-${userId}@users.invalid`);
  assert.equal(tombstone.rows[0].display_name, 'Deleted account');
  assert.equal(JSON.stringify(tombstone.rows).includes(email), false);
});
