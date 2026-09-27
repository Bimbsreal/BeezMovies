import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { closePool, getPool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const summary = 'Phase 29 operations incident for the local board.';
let userId;

after(async () => {
  const pool = getPool();
  await pool.query(
    `DELETE FROM ops_incident_notes
     WHERE incident_id IN (SELECT id FROM ops_incidents WHERE summary = $1)`,
    [summary],
  );
  await pool.query('DELETE FROM ops_incidents WHERE summary = $1', [summary]);
  if (userId) {
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await closePool();
  await closeRedis();
});

test('operations board stays private and does not invent a deployment', async () => {
  await seed();
  const anonymous = await request(app).get('/api/v1/admin/operations').set(csrf);
  assert.equal(anonymous.status, 401);

  const email = `ops.${Date.now()}@example.com`;
  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email,
    password: 'CorrectHorse1',
    displayName: 'Ops Audit',
  });
  assert.equal(registered.status, 201);
  userId = registered.body.user.id;
  const userLogin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email,
    password: 'CorrectHorse1',
  });
  assert.equal(userLogin.status, 200);
  const userCookie = userLogin.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const denied = await request(app).get('/api/v1/admin/operations').set(csrf).set('Cookie', userCookie);
  assert.equal(denied.status, 403);

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const board = await request(app).get('/api/v1/admin/operations').set(csrf).set('Cookie', cookie);
  assert.equal(board.status, 200);
  assert.equal(board.headers['cache-control'], 'private, no-store');
  const names = board.body.data.services.map((item) => item.name);
  assert.deepEqual(names, [
    'APPLICATION', 'DATABASE', 'CACHE', 'QUEUE', 'WORKERS', 'SEARCH',
    'MEDIA PROVIDERS', 'CDN', 'PWA',
  ]);
  assert.equal(board.body.data.services.find((item) => item.name === 'CDN').status, 'NOT CONFIGURED');
  assert.equal(board.body.data.services.find((item) => item.name === 'APPLICATION').status, 'HEALTHY');
  assert.equal(board.body.data.release.deployedAt, null);
  assert.equal(board.body.data.performance.comparedWith, null);
  assert.equal(board.body.data.cost.cdn, null);
  const text = JSON.stringify(board.body);
  assert.equal(text.includes('password'), false);
  assert.equal(text.includes('beezmovies_local'), false);

  const scan = await request(app).post('/api/v1/admin/operations/incidents/scan').set(csrf).set('Cookie', cookie).send({ confirm: true });
  assert.equal(scan.status, 200);
  assert.equal(typeof scan.body.data.opened, 'number');
  assert.ok(scan.body.data.opened <= 3);

  const opened = await request(app).post('/api/v1/admin/operations/incidents').set(csrf).set('Cookie', cookie).send({
    confirm: true,
    severity: 'HIGH',
    service: 'SEARCH',
    summary,
  });
  assert.equal(opened.status, 201);
  const incomplete = await request(app).post(`/api/v1/admin/operations/incidents/${opened.body.data.id}`).set(csrf).set('Cookie', cookie).send({
    confirm: true,
    status: 'POSTMORTEM',
  });
  assert.equal(incomplete.status, 400);
  const resolved = await request(app).post(`/api/v1/admin/operations/incidents/${opened.body.data.id}`).set(csrf).set('Cookie', cookie).send({
    confirm: true,
    status: 'RESOLVED',
    note: 'Checked search and left the catalog in place.',
  });
  assert.equal(resolved.status, 200);

  const quality = await request(app).post('/api/v1/admin/operations/quality').set(csrf).set('Cookie', cookie).send({ confirm: true });
  assert.equal(quality.status, 202);
  assert.ok(quality.body.data.queued <= 10);
  assert.ok(quality.body.data.examined <= 10);
});
