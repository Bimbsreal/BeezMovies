import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const created = { synopsisId: null, titleId: null };

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  if (created.synopsisId) await pool.query('DELETE FROM movie_synopses WHERE id = $1', [created.synopsisId]);
  if (created.titleId) await pool.query('DELETE FROM alternate_titles WHERE id = $1', [created.titleId]);
  await closePool();
  await closeRedis();
});

test('languages stay separate from countries and only English is an interface language', async () => {
  const languages = await request(app).get('/api/v1/languages');
  assert.equal(languages.status, 200);
  const byCode = new Map(languages.body.data.map((language) => [language.code, language]));
  assert.equal(byCode.get('en').uiReady, true);
  assert.equal(byCode.get('en').direction, 'ltr');
  assert.equal(byCode.get('de').uiReady, false);
  assert.equal(byCode.get('de').movieCount, 2);
  assert.equal(byCode.get('en').movieCount, 1);
  assert.equal(byCode.get('fr').movieCount, 0);
  assert.equal(byCode.has('zh'), false);
  assert.equal(byCode.has('ru'), false);
  assert.equal(byCode.has('tr'), false);

  const german = await request(app).get('/api/v1/languages/de/movies');
  assert.equal(german.status, 200);
  assert.deepEqual(german.body.data.map((movie) => movie.slug).sort(), ['nosferatu', 'the-cabinet-of-dr-caligari']);

  const english = await request(app).get('/api/v1/languages/en/movies');
  assert.deepEqual(english.body.data.map((movie) => movie.slug), ['night-of-the-living-dead']);

  const germany = await request(app).get('/api/v1/countries/germany/movies');
  assert.deepEqual(germany.body.data.map((movie) => movie.slug).sort(), ['nosferatu', 'the-cabinet-of-dr-caligari']);

  const missing = await request(app).get('/api/v1/languages/zh/movies');
  assert.equal(missing.status, 404);
});

test('original titles stay in place and unverified translations stay private', async () => {
  const movie = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(movie.status, 200);
  assert.equal(movie.body.data.title, 'Nosferatu');
  assert.equal(movie.body.data.originalTitle, 'Nosferatu, eine Symphonie des Grauens');
  assert.match(movie.body.data.synopsis, /public-domain silent horror/);
  assert.deepEqual(movie.body.data.synopses, []);
  assert.ok(movie.body.data.alternateTitles.some((item) => item.title === 'Nosferatu: A Symphony of Horror' && item.status === 'verified'));

  const search = await request(app).get('/api/v1/search').query({ q: 'Symphony of Horror' });
  assert.equal(search.status, 200);
  assert.ok(search.body.data.some((item) => item.slug === 'nosferatu'));

  const original = await request(app).get('/api/v1/search').query({ q: 'Symphonie des Grauens' });
  assert.ok(original.body.data.some((item) => item.slug === 'nosferatu'));

  const pool = getPool();
  const inserted = await pool.query(
    `INSERT INTO movie_synopses (movie_id, language_id, synopsis, status)
     SELECT id, original_language_id, 'Unverified synopsis that must not be published.', 'review'
     FROM movies WHERE slug = 'nosferatu'
     RETURNING id`,
  );
  created.synopsisId = inserted.rows[0].id;

  const hidden = await request(app).get('/api/v1/movies/nosferatu');
  assert.deepEqual(hidden.body.data.synopses, []);
  assert.match(hidden.body.data.synopsis, /public-domain silent horror/);

  const title = await pool.query(
    `INSERT INTO alternate_titles (movie_id, title, language_id, status)
     SELECT id, 'Private Nosferatu Translation', original_language_id, 'review'
     FROM movies WHERE slug = 'nosferatu'
     RETURNING id`,
  );
  created.titleId = title.rows[0].id;
  const titles = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(titles.body.data.alternateTitles.some((item) => item.title === 'Private Nosferatu Translation'), false);

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const board = await request(app).get('/api/v1/admin/localization').set('Cookie', cookie);
  assert.equal(board.status, 200);
  const row = board.body.data.find((item) => item.slug === 'nosferatu');
  assert.equal(row.originalLanguage.code, 'de');
  assert.equal(row.originalTitle, 'Nosferatu, eine Symphonie des Grauens');
  assert.equal(row.synopsis.source, 'verified');
  assert.equal(row.synopsis.localized, 'review');
  assert.ok(row.titles.some((item) => item.title === 'Private Nosferatu Translation' && item.status === 'review'));

  await pool.query('DELETE FROM movie_synopses WHERE id = $1', [created.synopsisId]);
  await pool.query('DELETE FROM alternate_titles WHERE id = $1', [created.titleId]);
  created.synopsisId = null;
  created.titleId = null;
});
