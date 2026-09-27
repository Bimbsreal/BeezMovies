import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

test('liveness probes do not touch dependency details', async () => {
  const live = await request(app).get('/health/live');
  assert.equal(live.status, 200);
  assert.equal(live.body.status, 'ok');
  assert.equal(live.headers['cache-control'], 'no-store');
  assert.equal(JSON.stringify(live.body).includes('postgres'), false);

  const alias = await request(app).get('/health');
  assert.equal(alias.status, 200);
  assert.equal(alias.headers['cache-control'], 'no-store');
});

test('GET /api/v1/health returns ok', async () => {
  const response = await request(app).get('/api/v1/health');

  assert.equal(response.status, 200);
  assert.equal(response.body.status, 'ok');
  assert.equal(response.body.service, 'beezmovies-api');
  assert.equal(response.body.release, undefined);
  assert.equal(response.headers['x-powered-by'], undefined);
});

test('local frontend origin is allowed', async () => {
  const response = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'http://localhost:3000');

  assert.equal(response.headers['access-control-allow-origin'], 'http://localhost:3000');
});

test('local development omits HSTS and allows admin PATCH preflight', async () => {
  const health = await request(app).get('/api/v1/health');
  assert.equal(health.headers['strict-transport-security'], undefined);
  assert.match(health.headers['permissions-policy'], /camera=\(\)/);

  const preflight = await request(app)
    .options('/api/v1/admin/settings')
    .set('Origin', 'http://localhost:3000')
    .set('Access-Control-Request-Method', 'PATCH')
    .set('Access-Control-Request-Headers', 'content-type,x-beezmovies-request');

  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:3000');
  assert.match(preflight.headers['access-control-allow-methods'], /PATCH/);
});

test('unknown origins are not allowed', async () => {
  const response = await request(app)
    .get('/api/v1/health')
    .set('Origin', 'https://unknown.example');

  assert.equal(response.headers['access-control-allow-origin'], undefined);
});
