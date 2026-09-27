import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { knownCountryId } from '../src/ingestion/countries.js';
import { countrySearchKey } from '../src/search/repository.js';

const app = createApp();

before(async () => {
  await seed();
});

after(async () => {
  await closePool();
  await closeRedis();
});

test('country pages use the controlled list and published counts', async () => {
  const response = await request(app).get('/api/v1/countries');
  assert.equal(response.status, 200);
  const bySlug = new Map(response.body.data.map((country) => [country.slug, country]));
  assert.equal(bySlug.get('nigeria').movieCount, 0);
  assert.equal(bySlug.get('ghana').movieCount, 0);
  assert.equal(bySlug.get('south-africa').movieCount, 0);
  assert.equal(bySlug.get('uk').movieCount, 0);
  assert.equal(bySlug.get('usa').movieCount, 1);
  assert.equal(bySlug.get('russia').movieCount, 0);
  assert.equal(bySlug.get('china').movieCount, 0);
  assert.equal(bySlug.get('turkiye').displayName, 'Türkiye');
  assert.equal(bySlug.get('germany').movieCount, 2);
  assert.equal(response.body.data.some((country) => country.code === 'ZZ'), false);

  const usa = await request(app).get('/api/v1/countries/usa/movies').query({ genre: 'horror', year: 1968 });
  assert.equal(usa.status, 200);
  assert.deepEqual(usa.body.data.map((movie) => movie.slug), ['night-of-the-living-dead']);

  const empty = await request(app).get('/api/v1/countries/nigeria/movies');
  assert.equal(empty.status, 200);
  assert.equal(empty.body.pagination.total, 0);
  assert.deepEqual(empty.body.data, []);

  const germany = await request(app).get('/api/v1/countries/germany/movies').query({ genre: 'horror', year: 1922 });
  assert.equal(germany.status, 200);
  assert.deepEqual(germany.body.data.map((movie) => movie.slug), ['nosferatu']);
});

test('homepage country rails and explore links follow published movies', async () => {
  const home = await request(app).get('/api/v1/discovery/home');
  assert.equal(home.status, 200);
  const rails = home.body.data.rails.filter((rail) => rail.source === 'countries');
  assert.deepEqual(rails.map((rail) => rail.slug), ['germany', 'usa']);
  assert.deepEqual(rails[0].items.map((movie) => movie.slug), ['nosferatu', 'the-cabinet-of-dr-caligari']);
  assert.equal(rails.some((rail) => rail.slug === 'nigeria'), false);
  const explore = home.body.data.countries.map((country) => country.slug);
  assert.ok(explore.includes('nigeria'));
  assert.ok(explore.includes('turkiye'));
  assert.equal(explore.includes('germany'), false);

  const nigeria = await request(app).get('/api/v1/movies').query({ country: 'NG', genre: 'action' });
  assert.equal(nigeria.status, 200);
  assert.equal(nigeria.body.pagination.total, 0);

  const germany = await request(app).get('/api/v1/countries/germany');
  assert.ok(germany.body.data.genres.some((genre) => genre.slug === 'horror'));
  assert.equal(germany.body.data.genres.some((genre) => genre.slug === 'comedy'), false);
});

test('country search recognizes aliases without inventing movies', async () => {
  assert.equal(countrySearchKey('Nigerian movies'), 'nigerian');
  assert.equal(countrySearchKey('Türkiye'), 'turkiye');
  const nigeria = await request(app).get('/api/v1/search/suggestions').query({ q: 'Nigerian movies' });
  assert.equal(nigeria.status, 200);
  assert.ok(nigeria.body.data.some((item) => item.type === 'country' && item.slug === 'nigeria'));
  const turkey = await request(app).get('/api/v1/search/suggestions').query({ q: 'Turkish movies' });
  assert.ok(turkey.body.data.some((item) => item.type === 'country' && item.slug === 'turkiye'));
});

test('an unknown country is reviewed and a movie can keep several known countries', async () => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const movie = await client.query(
      `INSERT INTO movies (canonical_title, slug, status)
       VALUES ('Country Probe', $1, 'draft')
       RETURNING id`,
      [`country-probe-${Date.now().toString(36)}`],
    );
    const movieId = movie.rows[0].id;
    const unknown = await knownCountryId(client, 'ZZ', { movieId, sourceSlug: 'test' });
    assert.equal(unknown, null);
    const review = await client.query(
      `SELECT reason FROM country_reviews WHERE movie_id = $1 AND raw_code = 'ZZ'`,
      [movieId],
    );
    assert.equal(review.rows[0].reason, 'unknown');
    const invented = await client.query(`SELECT 1 FROM countries WHERE code = 'ZZ'`);
    assert.equal(invented.rowCount, 0);
    const nigeria = await knownCountryId(client, 'NG', { movieId, sourceSlug: 'test' });
    const britain = await knownCountryId(client, 'GB', { movieId, sourceSlug: 'test' });
    await client.query(
      `INSERT INTO movie_countries (movie_id, country_id) VALUES ($1, $2), ($1, $3)
       ON CONFLICT DO NOTHING`,
      [movieId, nigeria, britain],
    );
    const linked = await client.query(
      'SELECT COUNT(*)::int AS total FROM movie_countries WHERE movie_id = $1',
      [movieId],
    );
    assert.equal(linked.rows[0].total, 2);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('country administration does not expose a delete route', async () => {
  const response = await request(app)
    .delete('/api/v1/admin/countries/22222222-2222-4222-8222-222222222211')
    .set('x-beezmovies-request', '1');
  assert.equal(response.status, 401);
});
