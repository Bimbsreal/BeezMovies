import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { migrate } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();

after(async () => {
  await closePool();
  await closeRedis();
});

test('GET /health/ready confirms PostgreSQL after migrations', async () => {
  await migrate();

  const response = await request(app).get('/health/ready');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.checks.postgres.status, 'ok');
  assert.equal(response.body.checks.postgres.required, true);
  assert.equal(response.body.checks.redis.required, false);
  assert.equal(JSON.stringify(response.body).includes('beezmovies_local'), false);

  const namespaced = await request(app).get('/api/v1/ready');
  assert.equal(namespaced.status, 200);
  assert.equal(namespaced.headers['cache-control'], 'no-store');
});
