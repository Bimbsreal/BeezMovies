import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { closePool, getPool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };

before(async () => {
  await seed();
});

after(async () => {
  await closePool();
  await closeRedis();
});

test('reconciliation reports stored catalog differences and writes nothing', async () => {
  const beforeCount = await getPool().query(
    `SELECT COUNT(*)::int AS total FROM movies WHERE archived_at IS NULL`,
  );

  const anonymous = await request(app).get('/api/v1/admin/editorial').set(csrf);
  assert.equal(anonymous.status, 401);

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const editorial = await request(app).get('/api/v1/admin/editorial').set(csrf).set('Cookie', cookie);
  assert.equal(editorial.status, 200);
  const report = editorial.body.data.reconciliation;
  assert.equal(report.recovery.updated, 0);
  assert.notEqual(report.recovery.backup, 'HEALTHY');
  assert.equal(report.recovery.automaticAllowed, false);
  assert.equal(report.totals.movies, 3);
  assert.equal(report.totals.series, 0);
  assert.equal(report.totals.seasons, 0);
  assert.equal(report.totals.episodes, 0);
  assert.ok(report.totals.countries >= 10);
  assert.deepEqual(report.contentTypes, ['movie', 'series']);
  assert.equal(report.industry.mismatches.length, 0);
  assert.equal(report.seriesIntegrity.orphan_seasons, 0);
  assert.equal(report.seriesIntegrity.orphan_episodes, 0);
  assert.equal(report.seriesIntegrity.duplicate_seasons, 0);
  assert.equal(report.seriesIntegrity.duplicate_episodes, 0);
  assert.equal(report.movieIntegrity.duplicate_external_ids, 0);
  assert.equal(report.movieIntegrity.missing_country, 0);
  assert.equal(report.movieIntegrity.missing_content_type, 0);
  assert.equal(report.search.missing_index, 0);
  assert.equal(report.search.unpublished, 0);
  assert.equal(report.homepage.staleCollectionItems, 0);
  const nigeria = report.countries.find((row) => row.code === 'NG');
  const usa = report.countries.find((row) => row.code === 'US');
  const germany = report.countries.find((row) => row.code === 'DE');
  assert.equal(nigeria.types.find((type) => type.code === 'movie').published, 0);
  assert.equal(usa.types.find((type) => type.code === 'movie').published, 1);
  assert.equal(germany.types.find((type) => type.code === 'movie').published, 2);
  const nosferatu = report.metadata.records.find((row) => row.slug === 'nosferatu');
  assert.equal(nosferatu.fields.find((field) => field.field === 'title').classification, 'MATCH');
  assert.equal(nosferatu.fields.find((field) => field.field === 'originalTitle').classification, 'CONFLICT');
  assert.ok(report.metadata.records.some((row) => row.externalId === 'dev-meta:metropolis' && row.slug === null));
  assert.equal(report.summary.updated, 0);
  assert.equal(JSON.stringify(report).includes('dev-meta:metropolis'), true);

  const seriesSearch = await request(app).get('/api/v1/search').query({ q: 'Nosferatu', type: 'series' });
  assert.equal(seriesSearch.status, 200);
  assert.equal(seriesSearch.body.pagination.total, 0);
  const filtered = await request(app).get('/api/v1/search').query({
    q: 'Night', country: 'US', type: 'movie', genre: 'horror',
  });
  assert.equal(filtered.body.data.length, 1);
  assert.equal(filtered.body.data[0].slug, 'night-of-the-living-dead');
  assert.equal(filtered.body.data[0].contentType.code, 'movie');
  const german = await request(app).get('/api/v1/search').query({ q: 'Nosferatu', country: 'DE', language: 'de' });
  assert.equal(german.body.data.every((row) => row.slug === 'nosferatu'), true);

  const usaMovies = await request(app).get('/api/v1/countries/usa/movies');
  assert.equal(usaMovies.status, 200);
  assert.ok(usaMovies.body.data.some((row) => row.slug === 'night-of-the-living-dead'));
  const nigeriaMovies = await request(app).get('/api/v1/countries/nigeria/movies');
  assert.equal(nigeriaMovies.status, 200);
  assert.equal(nigeriaMovies.body.pagination.total, 0);

  const download = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf);
  assert.equal(download.status, 200);
  const withheld = await request(app).post('/api/v1/movies/night-of-the-living-dead/download').set(csrf);
  assert.equal(withheld.status, 409);

  const afterCount = await getPool().query(
    `SELECT COUNT(*)::int AS total FROM movies WHERE archived_at IS NULL`,
  );
  assert.equal(afterCount.rows[0].total, beforeCount.rows[0].total);
  const metropolis = await getPool().query(`SELECT COUNT(*)::int AS total FROM movies WHERE slug = 'metropolis'`);
  assert.equal(metropolis.rows[0].total, 0);
});
