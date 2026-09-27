import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { closePool, getPool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };

after(async () => {
  const pool = getPool();
  await pool.query('DELETE FROM catalog_seed_batches');
  await pool.query('DELETE FROM catalog_seed_runs');
  await closePool();
  await closeRedis();
});

test('catalog bootstrap dry run resumes and does not publish', async () => {
  await seed();
  const before = await getPool().query(`SELECT COUNT(*)::int AS total FROM movies WHERE slug = 'metropolis'`);
  const anonymous = await request(app).get('/api/v1/admin/ingestion/bootstrap').set(csrf);
  assert.equal(anonymous.status, 401);

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const started = await request(app)
    .post('/api/v1/admin/ingestion/bootstrap/dry-run')
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true, batchSize: 1 });
  assert.equal(started.status, 201);
  const id = started.body.data.id;

  const first = await request(app)
    .post(`/api/v1/admin/ingestion/bootstrap/${id}/advance`)
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true });
  assert.equal(first.status, 200);
  assert.equal(first.body.data.processed, 1);
  assert.equal(first.body.data.cursor, 1);
  assert.equal(first.body.data.published, 0);

  const paused = await request(app)
    .post(`/api/v1/admin/ingestion/bootstrap/${id}/pause`)
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true });
  assert.equal(paused.status, 200);
  const blocked = await request(app)
    .post(`/api/v1/admin/ingestion/bootstrap/${id}/advance`)
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'SEED_PAUSED');

  await request(app)
    .post(`/api/v1/admin/ingestion/bootstrap/${id}/resume`)
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true });
  const second = await request(app)
    .post(`/api/v1/admin/ingestion/bootstrap/${id}/advance`)
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true });
  assert.equal(second.status, 200);
  assert.equal(second.body.data.status, 'completed');
  assert.equal(second.body.data.cursor, 2);
  assert.equal(second.body.data.discovered, 2);
  assert.equal(second.body.data.processed, 2);
  assert.equal(second.body.data.published, 0);
  assert.equal(second.body.data.processed, second.body.data.discovered);
  if (before.rows[0].total === 0) {
    assert.equal(second.body.data.approved, 1);
    assert.equal(second.body.data.duplicates, 1);
    assert.equal(second.body.data.valid, 2);
  }

  const afterCount = await getPool().query(`SELECT COUNT(*)::int AS total FROM movies WHERE slug = 'metropolis'`);
  assert.equal(afterCount.rows[0].total, before.rows[0].total);

  const apply = await request(app)
    .post('/api/v1/admin/ingestion/bootstrap/apply')
    .set(csrf)
    .set('Cookie', cookie)
    .send({ confirm: true });
  assert.equal(apply.status, 409);
  assert.equal(apply.body.error.code, 'SEED_BLOCKED');
});
