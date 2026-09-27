import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { verifyPassword } from '../src/auth/passwords.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const password = 'PhaseFortyTwo1';
const userIds = [];

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  for (const userId of userIds) {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await closePool();
  await closeRedis();
});

test('state changes require the browser request header and ordinary users stay out of admin', async () => {
  const email = `p42-${Date.now().toString(36)}@example.com`;
  const missing = await request(app).post('/api/v1/auth/login').send({ email, password });
  assert.equal(missing.status, 403);
  assert.equal(missing.body.error.code, 'CSRF_REJECTED');

  const created = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email, password, displayName: 'Phase Forty Two',
  });
  assert.equal(created.status, 201);
  userIds.push(created.body.user.id);
  assert.equal(JSON.stringify(created.body).includes('password'), false);

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session='));
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.equal(JSON.stringify(login.body).includes('sessionToken'), false);

  const editorial = await request(app).get('/api/v1/admin/editorial').set('Cookie', cookie.split(';')[0]);
  assert.equal(editorial.status, 403);
  const publish = await request(app).post('/api/v1/admin/movies/55555555-5555-4555-8555-555555555501/publish')
    .set('Cookie', cookie.split(';')[0])
    .set(csrf)
    .send({ confirm: true });
  assert.equal(publish.status, 403);

  const injected = await request(app).get('/api/v1/search').query({ q: "' OR 1=1 --" });
  assert.equal(injected.status, 200);
  assert.equal(JSON.stringify(injected.body).includes('syntax error'), false);

  const remote = await request(app).post('/api/v1/media/resolve').set(csrf).send({
    slug: 'nosferatu',
    url: 'https://127.0.0.1/secret',
  });
  assert.equal(remote.status, 400);

  const deleted = await request(app).post('/api/v1/auth/account/delete')
    .set('Cookie', cookie.split(';')[0])
    .set(csrf)
    .send({ password, confirm: true });
  assert.equal(deleted.status, 200);
  const stored = await getPool().query('SELECT email, password_hash FROM users WHERE id = $1', [created.body.user.id]);
  assert.equal(stored.rows[0].email, `deleted-${created.body.user.id}@users.invalid`);
  assert.equal(await verifyPassword(stored.rows[0].password_hash, password), false);
  const events = await getPool().query(
    `SELECT COUNT(*)::int AS count FROM auth_events WHERE user_id = $1 AND event_type = 'sessions_revoked'`,
    [created.body.user.id],
  );
  assert.ok(events.rows[0].count >= 1);
});
