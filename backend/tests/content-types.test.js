import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { qualityIssues } from '../src/ingestion/quality-gate.js';
import { sourceContentType } from '../src/catalog/industries.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };

before(async () => {
  await seed();
});

after(async () => {
  await closePool();
  await closeRedis();
});

test('country and content type stay derived from real catalog rows', async () => {
  assert.equal(sourceContentType({ crossIdentifiers: [{ externalId: 'dev-seed:movie:nosferatu' }] }), 'movie');
  assert.equal(sourceContentType({ contentType: 'series' }), 'series');
  assert.equal(sourceContentType({ title: 'Untitled' }), null);
  assert.equal(qualityIssues({ displayTitle: 'A', contentType: 'movie', countries: ['US'] }).includes('content_type'), false);
  assert.equal(qualityIssues({ displayTitle: 'A' }).includes('content_type'), true);

  const types = await request(app).get('/api/v1/content-types');
  assert.equal(types.status, 200);
  assert.deepEqual(types.body.data.map((item) => item.code), ['movie', 'series']);
  assert.ok(types.body.data.find((item) => item.code === 'movie').published >= 3);
  assert.equal(typeof types.body.data.find((item) => item.code === 'series').published, 'number');

  const hollywood = await request(app).get('/api/v1/industries/hollywood').query({ type: 'movie', limit: 24 });
  assert.equal(hollywood.status, 200);
  assert.equal(hollywood.body.industry.label, 'Hollywood Movies');
  assert.ok(hollywood.body.data.some((movie) => movie.slug === 'night-of-the-living-dead'));
  assert.equal(hollywood.body.data.every((movie) => movie.contentType.code === 'movie'), true);
  assert.equal(hollywood.body.indexable, false);

  const nollywoodSeries = await request(app).get('/api/v1/industries/nollywood').query({ type: 'series' });
  assert.equal(nollywoodSeries.status, 200);
  assert.equal(nollywoodSeries.body.contentType.code, 'series');
  assert.equal(nollywoodSeries.body.industry.label, 'Nollywood Series');
  assert.equal(nollywoodSeries.body.indexable, false);
  assert.equal(nollywoodSeries.body.note, null);

  const board = await request(app).get('/api/v1/admin/content-types').set(csrf);
  assert.equal(board.status, 401);

  const admin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = admin.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const report = await request(app).get('/api/v1/admin/content-types').set(csrf).set('Cookie', cookie);
  assert.equal(report.status, 200);
  const nigeria = report.body.report.countries.find((row) => row.code === 'NG');
  const usa = report.body.report.countries.find((row) => row.code === 'US');
  const germany = report.body.report.countries.find((row) => row.code === 'DE');
  assert.equal(nigeria.types.find((item) => item.code === 'movie').published, 0);
  assert.ok(usa.types.find((item) => item.code === 'movie').published >= 1);
  assert.ok(germany.types.find((item) => item.code === 'movie').published >= 2);
  assert.ok(Array.isArray(report.body.series));
  assert.equal(nigeria.types.find((item) => item.code === 'series').published >= 0, true);
  assert.equal(JSON.stringify(report.body).includes('password'), false);

  const combined = await request(app).get('/api/v1/movies').query({
    country: 'US',
    type: 'movie',
    genre: 'horror',
    limit: 24,
  });
  assert.equal(combined.status, 200);
  assert.ok(combined.body.data.some((movie) => movie.slug === 'night-of-the-living-dead'));

  const search = await request(app).get('/api/v1/search').query({ q: 'Night', country: 'US', type: 'movie' });
  assert.equal(search.status, 200);
  assert.equal(search.body.data[0].contentType.name, 'Movie');
  const seriesSearch = await request(app).get('/api/v1/search').query({ q: 'Night', type: 'series' });
  assert.equal(seriesSearch.status, 200);
  assert.equal(seriesSearch.body.data.length, 0);

  const movie = await request(app).get('/api/v1/movies/night-of-the-living-dead');
  assert.equal(movie.body.data.contentType.name, 'Movie');
  assert.equal(movie.body.data.industryLabels[0].label, 'Hollywood Movies');
  const download = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(download.status, 200);

  const plan = await getPool().query(
    `EXPLAIN SELECT m.slug
     FROM movies m
     JOIN movie_countries mc ON mc.movie_id = m.id
     JOIN countries c ON c.id = mc.country_id AND c.code = 'US'
     JOIN content_types t ON t.id = m.content_type_id AND t.code = 'movie'
     JOIN movie_genres mg ON mg.movie_id = m.id
     JOIN genres g ON g.id = mg.genre_id AND g.slug = 'horror'
     WHERE m.status = 'active'`,
  );
  assert.ok(plan.rows.length > 0);
});
