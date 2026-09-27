import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const password = 'CorrectHorse1';

before(async () => {
  await seed();
});

after(async () => {
  await closePool();
  await closeRedis();
});

test('anonymous download resolution does not require a session or leak a provider reference', async () => {
  const response = await request(app)
    .post('/api/v1/movies/nosferatu/download')
    .set(csrf)
    .send({});
  const body = JSON.stringify(response.body);

  assert.equal(response.status, 200);
  assert.equal(response.body.data.state, 'ready');
  assert.equal(response.body.data.resourceType, 'download');
  assert.equal(response.body.data.filename, 'nosferatu-development.txt');
  assert.equal(response.body.data.href.startsWith('/api/v1/media/handoff/'), true);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(body.includes('dev:ok:nosferatu'), false);
  assert.equal(body.includes('://'), false);
  assert.equal(body.includes('api_key'), false);

  const file = await request(app).get(response.body.data.href);
  assert.equal(file.status, 200);
  assert.match(file.headers['content-disposition'], /attachment; filename="nosferatu-development.txt"/);
  assert.match(file.text, /generated on this machine/);
  assert.equal(file.text.includes('dev:ok:'), false);

  const detail = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.media[0].reference, undefined);
  assert.equal(JSON.stringify(detail.body).includes('dev:ok:nosferatu'), false);
});

test('movies without an available reference stay unavailable to anonymous and signed-in viewers', async () => {
  const pending = await request(app)
    .post('/api/v1/movies/night-of-the-living-dead/download')
    .set(csrf)
    .send({});
  const missing = await request(app)
    .post('/api/v1/movies/the-cabinet-of-dr-caligari/download')
    .set(csrf)
    .send({});
  const unknown = await request(app)
    .post('/api/v1/movies/not-a-real-film/download')
    .set(csrf)
    .send({});
  const injected = await request(app)
    .post('/api/v1/movies/nosferatu/download')
    .set(csrf)
    .send({ url: 'https://example.invalid/file.mp4' });

  assert.equal(pending.body.error.code, 'MEDIA_UNAVAILABLE');
  assert.equal(missing.body.error.code, 'MEDIA_UNAVAILABLE');
  assert.equal(unknown.status, 404);
  assert.equal(injected.status, 400);

  const email = `download.${randomUUID()}@example.com`;
  await request(app).post('/api/v1/auth/register').set(csrf).send({
    email,
    password,
    displayName: 'Download Reader',
  });
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  const signedIn = await request(app)
    .post('/api/v1/movies/nosferatu/download')
    .set(csrf)
    .set('Cookie', login.headers['set-cookie'])
    .send({});

  assert.equal(signedIn.status, 200);
  assert.equal(signedIn.body.data.state, 'ready');
  assert.equal(signedIn.body.data.href.startsWith('/api/v1/media/handoff/'), true);
});
