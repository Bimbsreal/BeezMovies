import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { blocksPublicRequest } from '../src/ops/flags.js';
import {
  backupLevel,
  cacheLevel,
  databaseLevel,
  providerLevel,
  workerLevel,
} from '../src/ops/status.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };

after(async () => {
  await closePool();
  await closeRedis();
});

test('maintenance leaves health, auth, and admin reachable', () => {
  assert.equal(blocksPublicRequest('/movies/nosferatu', true), true);
  assert.equal(blocksPublicRequest('/media/handoff/token', true), true);
  assert.equal(blocksPublicRequest('/health', true), false);
  assert.equal(blocksPublicRequest('/ready', true), false);
  assert.equal(blocksPublicRequest('/admin/system', true), false);
  assert.equal(blocksPublicRequest('/auth/login', true), false);
  assert.equal(blocksPublicRequest('/movies', false), false);
});

test('operational levels do not treat a cache miss as an outage', () => {
  assert.equal(databaseLevel('ok'), 'HEALTHY');
  assert.equal(databaseLevel('unavailable'), 'DOWN');
  assert.equal(cacheLevel('unavailable'), 'DEGRADED');
  assert.equal(cacheLevel('disabled'), 'NOT CONFIGURED');
  assert.equal(workerLevel(null), 'NOT CONFIGURED');
  assert.equal(workerLevel(new Date().toISOString()), 'HEALTHY');
  assert.equal(workerLevel(new Date(Date.now() - 120_000).toISOString()), 'DOWN');
  assert.equal(backupLevel({ lastSuccessAt: null, lastFailureAt: null }), 'NOT CONFIGURED');
  assert.equal(backupLevel({
    lastSuccessAt: new Date(Date.now() - 48 * 36e5).toISOString(),
    lastFailureAt: null,
    maxAgeHours: 26,
  }), 'DOWN');
  assert.equal(providerLevel('unknown'), 'NOT CONFIGURED');
  assert.equal(providerLevel('unavailable'), 'DOWN');
});

test('admin system lists checks and does not expose secrets', async () => {
  await seed();
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  assert.equal(login.status, 200);
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const system = await request(app).get('/api/v1/admin/system').set(csrf).set('Cookie', cookie);
  assert.equal(system.status, 200);
  const text = JSON.stringify(system.body);
  assert.equal(text.includes('password_hash'), false);
  assert.equal(text.includes('beezmovies-local-handoff'), false);
  assert.equal(system.body.data.checks.find((item) => item.name === 'Database').status, 'HEALTHY');
  assert.equal(system.body.data.checks.find((item) => item.name === 'Backups').status, 'NOT CONFIGURED');
  assert.equal(system.body.data.maintenance.enabled, false);

  const anonymous = await request(app).patch('/api/v1/admin/operations').set(csrf).send({
    confirm: true,
    maintenance: { enabled: true, message: 'Closed' },
  });
  assert.equal(anonymous.status, 401);
  const health = await request(app).get('/api/v1/health');
  assert.equal(health.status, 200);
  const movies = await request(app).get('/api/v1/movies');
  assert.equal(movies.status, 200);
});
