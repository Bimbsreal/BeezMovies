import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { classifySyncRecord, shouldThrottleSync } from '../src/ingestion/sync.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  const source = await pool.query(`SELECT id FROM catalog_sources WHERE slug = 'development-metadata'`);
  if (source.rowCount) {
    await pool.query(
      `DELETE FROM ingestion_jobs
       WHERE catalog_source_id = $1 AND payload->>'origin' = 'sync'`,
      [source.rows[0].id],
    );
    await pool.query('DELETE FROM catalog_sync_runs WHERE catalog_source_id = $1', [source.rows[0].id]);
    await pool.query('DELETE FROM catalog_sync_checkpoints WHERE catalog_source_id = $1', [source.rows[0].id]);
  }
  await closePool();
  await closeRedis();
});

async function adminCookie() {
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  assert.equal(login.status, 200);
  return login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
}

test('sync classification keeps series separate and skips unchanged fingerprints', () => {
  const movie = classifySyncRecord({
    fingerprint: 'a',
    previousFingerprint: null,
    contentType: 'movie',
    seasons: 0,
    countries: true,
    genres: true,
    artwork: true,
  });
  assert.equal(movie.disposition, 'created');
  assert.equal(movie.layers.includes('series-sync'), false);
  assert.equal(movie.layers.includes('country-sync'), true);

  const series = classifySyncRecord({
    fingerprint: 'b',
    previousFingerprint: 'a',
    contentType: 'series',
    seasons: 2,
    countries: true,
    genres: false,
    artwork: false,
  });
  assert.equal(series.disposition, 'updated');
  assert.equal(series.layers.includes('series-sync'), true);
  assert.equal(series.layers.includes('episode-sync'), true);

  const same = classifySyncRecord({
    fingerprint: 'a',
    previousFingerprint: 'a',
    contentType: 'movie',
    seasons: 0,
    countries: false,
    genres: false,
    artwork: false,
  });
  assert.equal(same.disposition, 'unchanged');
  assert.equal(shouldThrottleSync(40), true);
  assert.equal(shouldThrottleSync(3), false);
});

test('an administrator can resume synchronization without publishing an unconfirmed catalog', async () => {
  const anonymous = await request(app).get('/api/v1/admin/ingestion/sync').set(csrf);
  assert.equal(anonymous.status, 401);
  const cookie = await adminCookie();
  const pool = getPool();
  const source = await pool.query(`SELECT id FROM catalog_sources WHERE slug = 'development-metadata'`);
  const sourceId = source.rows[0].id;

  const paused = await pool.query(
    `INSERT INTO catalog_sync_runs (catalog_source_id, mode, status)
     VALUES ($1, 'manual', 'running')
     RETURNING id`,
    [sourceId],
  );
  const hold = await request(app).post(`/api/v1/admin/ingestion/sync/${paused.rows[0].id}/pause`).set(csrf).set('Cookie', cookie).send({ confirm: true });
  assert.equal(hold.status, 200);
  assert.equal(hold.body.data.current.status, 'paused');
  const stopped = await request(app).post(`/api/v1/admin/ingestion/sync/${paused.rows[0].id}/cancel`).set(csrf).set('Cookie', cookie).send({ confirm: true });
  assert.equal(stopped.status, 200);

  const started = await request(app).post('/api/v1/admin/ingestion/sync').set(csrf).set('Cookie', cookie).send({
    confirm: true,
    source: 'development-metadata',
    mode: 'initial',
  });
  assert.equal(started.status, 202);
  assert.equal(started.body.data.last.status, 'completed');
  assert.equal(started.body.data.last.discovered, 2);
  assert.equal(started.body.data.last.created, 2);
  assert.equal(started.body.data.last.failed, 0);
  assert.equal(started.body.data.checkpoints[0].initialCompleted, true);
  assert.equal(started.body.data.health.orphanEpisodes, 0);
  assert.deepEqual(started.body.data.health.contentTypes, ['movie', 'series']);
  assert.equal(
    started.body.data.health.industryLabels.find((row) => row.country === 'NG' && row.type === 'series').label,
    'Nollywood Series',
  );
  assert.equal(
    started.body.data.health.industryLabels.find((row) => row.country === 'US' && row.type === 'movie').label,
    'Hollywood Movies',
  );

  const again = await request(app).post('/api/v1/admin/ingestion/sync').set(csrf).set('Cookie', cookie).send({
    confirm: true,
    source: 'development-metadata',
    mode: 'initial',
  });
  assert.equal(again.status, 202);
  assert.match(again.body.data.last.note, /checkpoint/);
  assert.equal(again.body.data.last.unchanged, 2);
  assert.equal(again.body.data.last.created, 0);

  const queued = await pool.query(
    `SELECT external_id FROM ingestion_jobs
     WHERE catalog_source_id = $1 AND payload->>'origin' = 'sync' AND status = 'pending'`,
    [sourceId],
  );
  assert.equal(queued.rowCount, 2);
  const invented = await pool.query(`SELECT id FROM movies WHERE slug = 'metropolis'`);
  assert.equal(invented.rowCount, 0);
  const schedules = await request(app).get('/api/v1/admin/ingestion/sources').set(csrf).set('Cookie', cookie);
  const incremental = schedules.body.data.schedules.find((row) => row.name === 'development-metadata-incremental');
  assert.equal(incremental.enabled, false);
  assert.ok(incremental.intervalSeconds >= 3600);

  const download = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(download.status, 200);
});
