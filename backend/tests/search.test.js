import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis, getRedis } from '../src/redis/client.js';
import { AppError } from '../src/errors/app-error.js';
import { searchQuery } from '../src/search/repository.js';
import { resetSearchCacheStats, searchCacheStats } from '../src/search/cache.js';
import { searchCacheKey } from '../src/search/keys.js';
import {
  consumeSearchEvents,
  rebuildSearchIndex,
  runPendingReindex,
} from '../src/search/indexer.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const nosferatuId = '55555555-5555-4555-8555-555555555501';
const murnauId = '44444444-4444-4444-8444-444444444401';
const signalSlug = 'phase-six-signal';

describe('search and discovery', { concurrency: 1 }, () => {
before(async () => {
  await seed();
  await rebuildSearchIndex();
});

after(async () => {
  await getPool().query('DELETE FROM search_index_events WHERE slug = $1', [signalSlug]);
  await getPool().query('DELETE FROM movies WHERE slug = $1', [signalSlug]);
  await closePool();
  await closeRedis();
});

function slugs(response) {
  return response.body.data.map((movie) => movie.slug);
}

test('exact, partial, alternate, and person searches rank catalog movies', async () => {
  const exact = await request(app).get('/api/v1/search').query({ q: 'Nosferatu' });
  assert.equal(exact.status, 200);
  assert.equal(exact.body.data[0].slug, 'nosferatu');
  assert.equal(exact.body.data[0].relevance.match, 'exact_title');
  assert.equal(exact.body.data[0].id, undefined);
  assert.equal(JSON.stringify(exact.body).includes(nosferatuId), false);

  const partial = await request(app).get('/api/v1/search').query({ q: 'Nosfer' });
  assert.equal(partial.status, 200);
  assert.equal(partial.body.data[0].slug, 'nosferatu');
  assert.equal(partial.body.data[0].relevance.match, 'prefix_title');

  const alternate = await request(app).get('/api/v1/search').query({ q: 'Symphony of Horror' });
  assert.equal(alternate.status, 200);
  assert.ok(slugs(alternate).includes('nosferatu'));
  assert.equal(alternate.body.data.find((movie) => movie.slug === 'nosferatu').relevance.match, 'alternate_title');

  const person = await request(app).get('/api/v1/search').query({ q: 'Murnau' });
  assert.equal(person.status, 200);
  assert.ok(slugs(person).includes('nosferatu'));
});

test('filters narrow search results', async () => {
  const genre = await request(app).get('/api/v1/search').query({ q: 'film', genre: 'horror', year: 1968 });
  assert.equal(genre.status, 200);
  assert.deepEqual(slugs(genre), ['night-of-the-living-dead']);

  const language = await request(app).get('/api/v1/search').query({ q: 'Nosferatu', language: 'de', country: 'DE' });
  assert.ok(slugs(language).includes('nosferatu'));

  const collection = await request(app).get('/api/v1/search').query({
    q: 'film',
    collection: 'expressionist-shadows',
  });
  assert.equal(slugs(collection).includes('night-of-the-living-dead'), false);
  assert.ok(slugs(collection).includes('nosferatu'));

  const person = await request(app).get('/api/v1/search').query({ q: 'film', person: murnauId });
  assert.deepEqual(slugs(person), ['nosferatu']);

  const combined = await request(app).get('/api/v1/search').query({
    q: 'film',
    genre: 'horror',
    year: 1968,
    language: 'en',
    country: 'US',
  });
  assert.deepEqual(slugs(combined), ['night-of-the-living-dead']);

  const missed = await request(app).get('/api/v1/search').query({ q: 'Nosferatu', genre: 'comedy' });
  assert.equal(missed.status, 200);
  assert.equal(missed.body.pagination.total, 0);
  assert.ok(Array.isArray(missed.body.didYouMean));
});

test('search pagination, invalid input, and injection attempts stay bounded', async () => {
  const page = await request(app).get('/api/v1/search').query({ q: 'film', page: 2, limit: 1 });
  assert.equal(page.status, 200);
  assert.equal(page.body.pagination.total, 3);
  assert.equal(page.body.pagination.totalPages, 3);
  assert.equal(page.body.data.length, 1);

  const empty = await request(app).get('/api/v1/search').query({ q: '' });
  const huge = await request(app).get('/api/v1/search').query({ q: 'n'.repeat(81) });
  const wild = await request(app).get('/api/v1/search').query({ q: '%%' });
  const badPage = await request(app).get('/api/v1/search').query({ q: 'film', page: 0, limit: 0 });
  const badSort = await request(app).get('/api/v1/search').query({ q: 'film', sort: 'id;drop' });
  assert.equal(empty.status, 400);
  assert.equal(huge.status, 400);
  assert.equal(wild.status, 400);
  assert.equal(badPage.status, 400);
  assert.equal(badSort.status, 400);

  const injected = await request(app).get('/api/v1/search').query({
    q: "nosferatu' OR 1=1; DROP TABLE movies;--",
  });
  assert.equal(injected.status, 200);
  const stillThere = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(stillThere.status, 200);
});

test('typos, suggestions, and zero results use the derived index', async () => {
  const typo = await request(app).get('/api/v1/search').query({ q: 'Nosferau' });
  assert.equal(typo.status, 200);
  assert.ok(slugs(typo).includes('nosferatu'));
  assert.equal(typo.body.data.find((movie) => movie.slug === 'nosferatu').relevance.match, 'fuzzy');

  const suggestions = await request(app).get('/api/v1/search/suggestions').query({ q: 'Nosf' });
  assert.equal(suggestions.status, 200);
  assert.ok(suggestions.body.data.length <= 8);
  assert.ok(suggestions.body.data.some((item) => item.type === 'movie' && item.slug === 'nosferatu'));

  const genre = await request(app).get('/api/v1/search/suggestions').query({ q: 'hor' });
  assert.ok(genre.body.data.some((item) => item.type === 'genre' && item.slug === 'horror'));

  const none = await request(app).get('/api/v1/search').query({ q: 'zzzzqqqq' });
  assert.equal(none.status, 200);
  assert.equal(none.body.pagination.total, 0);
  assert.deepEqual(none.body.data, []);
  assert.ok(Array.isArray(none.body.didYouMean));
});

test('anonymous search can be cached and authenticated search is private', async () => {
  assert.equal(getRedis(), null);
  resetSearchCacheStats();
  const first = await request(app).get('/api/v1/search').query({ q: 'Caligari' });
  const second = await request(app).get('/api/v1/search').query({ q: 'Caligari' });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.match(first.headers['cache-control'], /public/);
  assert.ok(searchCacheStats().hits >= 1);
  assert.equal(
    searchCacheKey({
      version: 1,
      query: 'Caligari',
      filters: {},
      page: 1,
      limit: 20,
    }).includes('user'),
    false,
  );

  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const privateSearch = await request(app).get('/api/v1/search').set('Cookie', cookie).query({ q: 'Caligari' });
  assert.match(privateSearch.headers['cache-control'], /no-store/);
});

test('catalog updates and archives flow into the search index', async () => {
  await getPool().query(
    `INSERT INTO movies (canonical_title, slug, status, release_year, synopsis, content_type_id)
     VALUES (
       'Phase Six Signal', $1, 'active', 1991, 'A local search fixture.',
       (SELECT id FROM content_types WHERE code = 'movie')
     )`,
    [signalSlug],
  );
  const movie = await getPool().query('SELECT id FROM movies WHERE slug = $1', [signalSlug]);
  const movieId = movie.rows[0].id;
  await getPool().query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     VALUES ('movie.catalog.updated', $1, $2)`,
    [movieId, signalSlug],
  );
  assert.ok(await consumeSearchEvents() >= 1);

  const created = await request(app).get('/api/v1/search').query({ q: 'Phase Six' });
  assert.ok(slugs(created).includes(signalSlug));

  await getPool().query(
    `UPDATE movies SET canonical_title = 'Phase Six Beacon' WHERE id = $1`,
    [movieId],
  );
  await getPool().query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     VALUES ('movie.catalog.updated', $1, $2)`,
    [movieId, signalSlug],
  );
  await consumeSearchEvents();
  const updated = await request(app).get('/api/v1/search').query({ q: 'Beacon' });
  assert.ok(slugs(updated).includes(signalSlug));

  await getPool().query(
    `UPDATE movies SET status = 'archived', archived_at = NOW() WHERE id = $1`,
    [movieId],
  );
  await getPool().query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     VALUES ('movie.catalog.archived', $1, $2)`,
    [movieId, signalSlug],
  );
  await consumeSearchEvents();
  const hidden = await request(app).get('/api/v1/search').query({ q: 'Beacon' });
  assert.equal(slugs(hidden).includes(signalSlug), false);

  await getPool().query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     VALUES ('movie.catalog.deleted', $1, $2)`,
    [movieId, signalSlug],
  );
  await consumeSearchEvents();
  const documents = await getPool().query(
    'SELECT COUNT(*)::int AS total FROM search_documents WHERE movie_id = $1',
    [movieId],
  );
  assert.equal(documents.rows[0].total, 0);
});

test('reindex is idempotent and stays outside the request', async () => {
  const anonymous = await request(app).post('/api/v1/admin/search/reindex').set(csrf).send({});
  assert.equal(anonymous.status, 401);

  const email = `search.${Date.now()}@example.com`;
  await request(app).post('/api/v1/auth/register').set(csrf).send({
    email,
    password: 'CorrectHorse1',
    displayName: 'Search Reader',
  });
  const readerLogin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email,
    password: 'CorrectHorse1',
  });
  const readerCookie = readerLogin.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const forbidden = await request(app).post('/api/v1/admin/search/reindex').set(csrf).set('Cookie', readerCookie).send({});
  assert.equal(forbidden.status, 403);

  const adminLogin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const adminCookie = adminLogin.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const queued = await request(app).post('/api/v1/admin/search/reindex').set(csrf).set('Cookie', adminCookie).send({});
  assert.equal(queued.status, 202);
  assert.equal(queued.body.data.status, 'pending');
  const beforeCount = await getPool().query('SELECT COUNT(*)::int AS total FROM movies WHERE status = \'active\'');
  const result = await runPendingReindex();
  assert.equal(result.processed >= beforeCount.rows[0].total, true);

  const again = await rebuildSearchIndex();
  const active = await getPool().query(
    `SELECT COUNT(*)::int AS versions FROM search_index_versions WHERE status = 'active'`,
  );
  const missing = await getPool().query(
    `SELECT m.id
     FROM movies m
     WHERE m.status = 'active'
       AND NOT EXISTS (
         SELECT 1
         FROM search_documents d
         JOIN search_index_versions v ON v.version = d.index_version AND v.status = 'active'
         WHERE d.movie_id = m.id AND d.status = 'active'
       )`,
  );
  assert.equal(active.rows[0].versions, 1);
  assert.equal(missing.rowCount, 0);
  assert.equal(again.processed, result.processed);
});

test('search failures hide database details and discovery lists stay ordered', async () => {
  await assert.rejects(
    () => searchQuery('SELECT * FROM movies WHERE slug = $1; DROP TABLE movies', ['nosferatu']),
    (error) => {
      assert.equal(error instanceof AppError, true);
      assert.equal(error.code, 'SEARCH_UNAVAILABLE');
      assert.equal(error.message.includes('SELECT'), false);
      assert.equal(error.message.includes('DROP'), false);
      return true;
    },
  );

  const trending = await request(app).get('/api/v1/discovery/trending');
  const popular = await request(app).get('/api/v1/discovery/popular');
  const recent = await request(app).get('/api/v1/discovery/recent');
  const genres = await request(app).get('/api/v1/discovery/genres');
  const collections = await request(app).get('/api/v1/discovery/collections');
  assert.equal(trending.status, 200);
  assert.equal(popular.body.data[0].slug, 'night-of-the-living-dead');
  assert.equal(recent.body.data[0].slug, 'night-of-the-living-dead');
  assert.ok(genres.body.data.some((genre) => genre.slug === 'horror'));
  assert.ok(collections.body.data.some((collection) => collection.slug === 'expressionist-shadows'));

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const plan = await client.query(`
      EXPLAIN SELECT slug FROM search_documents
      WHERE search_vector @@ plainto_tsquery('simple', 'nosferatu')
    `);
    assert.match(plan.rows.map((row) => row['QUERY PLAN']).join('\n'), /Index|Bitmap/);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('representative search queries stay responsive on the local seed', async () => {
  const samples = [
    '/api/v1/search?q=Nosferatu',
    '/api/v1/search?q=Nosfer',
    '/api/v1/search?q=Nosferau',
    '/api/v1/search?q=film&genre=horror',
    '/api/v1/search/suggestions?q=Nos',
    '/api/v1/discovery/trending',
  ];
  const timings = [];
  for (const path of samples) {
    const started = Date.now();
    const response = await request(app).get(path);
    const elapsed = Date.now() - started;
    timings.push(`${elapsed}ms ${path}`);
    assert.equal(response.status, 200);
    assert.ok(elapsed < 2000, path);
  }
  console.log(timings.join(' | '));
});
});
