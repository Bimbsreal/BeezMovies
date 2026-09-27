import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { closePool, getPool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { seedSafety } from '../src/ingestion/bootstrap.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };

before(async () => {
  await seed();
});

after(async () => {
  await closePool();
  await closeRedis();
});

test('production publication stays blocked and the census uses stored rows', async () => {
  const safety = await seedSafety();
  assert.equal(safety.applyAllowed, false);
  assert.notEqual(safety.backup, 'HEALTHY');
  assert.ok(safety.reasons.length > 0);

  const anonymous = await request(app).get('/api/v1/admin/ingestion/sync').set(csrf);
  assert.equal(anonymous.status, 401);

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const board = await request(app).get('/api/v1/admin/ingestion/sync').set(csrf).set('Cookie', cookie);
  assert.equal(board.status, 200);
  const catalog = board.body.data.catalog;
  assert.equal(catalog.seeding.applyAllowed, false);
  assert.equal(catalog.totals.movies, 3);
  assert.equal(catalog.totals.series, 0);
  assert.equal(catalog.totals.seasons, 0);
  assert.equal(catalog.totals.episodes, 0);
  assert.deepEqual(catalog.contentTypes, ['movie', 'series']);
  const nigeria = catalog.countries.find((row) => row.code === 'NG');
  const usa = catalog.countries.find((row) => row.code === 'US');
  const germany = catalog.countries.find((row) => row.code === 'DE');
  assert.equal(nigeria.types.find((type) => type.code === 'movie').published, 0);
  assert.equal(nigeria.types.find((type) => type.code === 'series').published, 0);
  assert.ok(usa.types.find((type) => type.code === 'movie').published >= 1);
  assert.ok(germany.types.find((type) => type.code === 'movie').published >= 2);
  assert.equal(catalog.sources[0].identifier, 'development-metadata');
  assert.equal(catalog.sources[0].authentication, 'none');
  assert.equal(JSON.stringify(catalog).includes('password'), false);
  assert.ok(catalog.constraints.includes('movies_slug_key'));
  assert.ok(catalog.constraints.includes('episodes_number_key'));
  assert.equal(catalog.gaps.missingCountry, 0);

  const blocked = await request(app).post('/api/v1/admin/ingestion/bootstrap/apply').set(csrf).set('Cookie', cookie).send({ confirm: true });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, 'SEED_BLOCKED');

  const titles = await getPool().query(
    `SELECT COUNT(*)::int AS total FROM movies WHERE status = 'active' AND archived_at IS NULL`,
  );
  assert.equal(titles.rows[0].total, 3);
});
