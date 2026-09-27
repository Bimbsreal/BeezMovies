import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { catalogQuery } from '../src/catalog/db.js';
import { invalidateCatalogCache } from '../src/catalog/admin.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis, getRedis } from '../src/redis/client.js';
import { AppError } from '../src/errors/app-error.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const password = 'CorrectHorse1';
const nosferatuId = '55555555-5555-4555-8555-555555555501';
const murnauId = '44444444-4444-4444-8444-444444444401';

before(async () => {
  await seed();
});

after(async () => {
  await closePool();
  await closeRedis();
});

function slugs(response) {
  return response.body.data.map((movie) => movie.slug);
}

test('movie list returns active catalog pages', async () => {
  const response = await request(app).get('/api/v1/movies');

  assert.equal(response.status, 200);
  assert.equal(response.body.pagination.page, 1);
  assert.equal(response.body.pagination.limit, 20);
  assert.ok(response.body.pagination.total >= 3);
  assert.ok(slugs(response).includes('nosferatu'));
  assert.equal(response.body.data.some((movie) => movie.slug === 'nosferatu' && movie.id), false);
  assert.match(response.headers['cache-control'], /public/);
});

test('movie pagination reports totals and a single page of results', async () => {
  const response = await request(app).get('/api/v1/movies').query({
    genre: 'horror',
    page: 2,
    limit: 1,
    sort: 'title',
    order: 'asc',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.pagination.total, 3);
  assert.equal(response.body.pagination.totalPages, 3);
  assert.equal(response.body.data.length, 1);
  assert.equal(response.body.data[0].slug, 'nosferatu');
});

test('invalid pagination is rejected', async () => {
  const page = await request(app).get('/api/v1/movies').query({ page: 0 });
  const negative = await request(app).get('/api/v1/movies').query({ page: -1 });
  const limit = await request(app).get('/api/v1/movies').query({ limit: 0 });

  assert.equal(page.status, 400);
  assert.equal(negative.status, 400);
  assert.equal(limit.status, 400);
  assert.equal(page.body.error.code, 'VALIDATION_ERROR');
});

test('page size cannot exceed the catalog maximum', async () => {
  const allowed = await request(app).get('/api/v1/movies').query({ limit: 50 });
  const blocked = await request(app).get('/api/v1/movies').query({ limit: 51 });

  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.pagination.limit, 50);
  assert.ok(allowed.body.data.length <= 50);
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.code, 'VALIDATION_ERROR');
});

test('movie detail by slug returns public related data', async () => {
  const response = await request(app).get('/api/v1/movies/nosferatu');
  const movie = response.body.data;

  assert.equal(response.status, 200);
  assert.equal(movie.slug, 'nosferatu');
  assert.equal(movie.title, 'Nosferatu');
  assert.equal(movie.originalTitle, 'Nosferatu, eine Symphonie des Grauens');
  assert.equal(movie.releaseDate, '1922-03-15');
  assert.equal(movie.runtimeMinutes, 94);
  assert.equal(movie.seo.path, '/movie/nosferatu');
  assert.equal(movie.seo.title, 'Nosferatu');
  assert.ok(movie.genres.some((genre) => genre.slug === 'horror'));
  assert.ok(movie.alternateTitles.some((title) => title.title.includes('Symphony')));
  assert.equal(movie.poster.url, 'https://images.example.com/beezmovies/posters/nosferatu.jpg');
  assert.ok(movie.trailers.some((video) => video.type === 'trailer' && video.official === true && video.url === null));
  assert.equal(JSON.stringify(movie.seo).includes('videos.example.com'), false);
  assert.ok(movie.credits.some((credit) => credit.name === 'F. W. Murnau' && credit.job === 'Director'));
  assert.equal(movie.collection.slug, 'expressionist-shadows');
  assert.equal(movie.collection.sortOrder, 1);
  assert.ok(movie.externalIdentifiers.some((item) => item.externalId === 'dev-seed:movie:nosferatu'));
  assert.equal(movie.media.length, 2);
  const example = movie.media.find((item) => item.provider.slug === 'example-media');
  const development = movie.media.find((item) => item.provider.slug === 'development-media');
  assert.equal(example.quality, '1080p');
  assert.equal(example.reference, undefined);
  assert.equal(development.mediaType, 'download');
  assert.equal(development.quality, '1080p');
});

test('an unknown movie slug returns not found', async () => {
  const response = await request(app).get('/api/v1/movies/not-a-real-film');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.equal(response.body.error.message, 'Movie not found');
});

test('genre list includes the seeded genres', async () => {
  const response = await request(app).get('/api/v1/genres');
  const horror = response.body.data.find((genre) => genre.slug === 'horror');

  assert.equal(response.status, 200);
  assert.ok(horror);
  assert.equal(horror.name, 'Horror');
  assert.ok(horror.movieCount >= 3);
});

test('genre movies are paginated members of that genre', async () => {
  const response = await request(app).get('/api/v1/genres/horror/movies').query({ limit: 10 });
  assert.equal(response.status, 200);
  assert.equal(response.body.genre.slug, 'horror');
  assert.ok(slugs(response).includes('nosferatu'));
  const missing = await request(app).get('/api/v1/genres/not-a-genre/movies');
  assert.equal(missing.status, 404);
});

test('collection list and ordered detail are public', async () => {
  const list = await request(app).get('/api/v1/collections');
  const detail = await request(app).get('/api/v1/collections/expressionist-shadows');

  assert.equal(list.status, 200);
  assert.ok(list.body.data.some((collection) => collection.slug === 'expressionist-shadows'));
  assert.equal(detail.status, 200);
  assert.equal(detail.body.data.movies[0].slug, 'nosferatu');
  assert.equal(detail.body.data.movies[0].sortOrder, 1);
  assert.equal(detail.body.data.movies[1].slug, 'the-cabinet-of-dr-caligari');
  assert.equal(detail.body.data.movies[1].sortOrder, 2);
});

test('person detail and filmography use credit relationships', async () => {
  const person = await request(app).get(`/api/v1/people/${murnauId}`);
  const movies = await request(app).get(`/api/v1/people/${murnauId}/movies`);

  assert.equal(person.status, 200);
  assert.equal(person.body.data.name, 'F. W. Murnau');
  assert.equal(person.body.data.birthDate, '1888-12-28');
  assert.equal(movies.status, 200);
  assert.deepEqual(slugs(movies), ['nosferatu']);
  const missing = await request(app).get('/api/v1/people/00000000-0000-4000-8000-000000000000');
  assert.equal(missing.status, 404);
});

test('filters narrow the catalog without changing unrelated movies', async () => {
  const year = await request(app).get('/api/v1/movies').query({ year: 1922 });
  const language = await request(app).get('/api/v1/movies').query({ language: 'en' });
  const country = await request(app).get('/api/v1/movies').query({ country: 'DE' });
  const search = await request(app).get('/api/v1/movies').query({ q: 'symphony' });

  assert.deepEqual(slugs(year), ['nosferatu']);
  assert.ok(slugs(language).includes('night-of-the-living-dead'));
  assert.equal(slugs(language).includes('nosferatu'), false);
  assert.ok(slugs(country).includes('nosferatu'));
  assert.ok(slugs(country).includes('the-cabinet-of-dr-caligari'));
  assert.deepEqual(slugs(search), ['nosferatu']);
});

test('sorting accepts only the public sort names', async () => {
  const response = await request(app).get('/api/v1/movies').query({
    genre: 'horror',
    sort: 'release_date',
    order: 'desc',
    limit: 10,
  });
  assert.deepEqual(slugs(response), [
    'night-of-the-living-dead',
    'nosferatu',
    'the-cabinet-of-dr-caligari',
  ]);

  const invalid = await request(app).get('/api/v1/movies').query({ sort: 'id;drop' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
});

test('private catalog records and raw ids stay behind authorization', async () => {
  const draftSlug = `phase4-draft-${randomUUID().slice(0, 8)}`;
  const inserted = await getPool().query(
    `INSERT INTO movies (canonical_title, slug, status)
     VALUES ('Hidden Draft', $1, 'draft')
     RETURNING id`,
    [draftSlug],
  );
  const draftId = inserted.rows[0].id;

  try {
    const hidden = await request(app).get('/api/v1/movies').query({ q: 'Hidden Draft' });
    assert.equal(slugs(hidden).includes(draftSlug), false);
    const bySlug = await request(app).get(`/api/v1/movies/${draftSlug}`);
    assert.equal(bySlug.status, 404);

    const anonymous = await request(app).get(`/api/v1/movies/id/${nosferatuId}`);
    assert.equal(anonymous.status, 401);

    const draftFilter = await request(app).get('/api/v1/movies').query({ status: 'draft' });
    assert.equal(draftFilter.status, 403);

    const email = `catalog.${randomUUID()}@example.com`;
    await request(app).post('/api/v1/auth/register').set(csrf).send({
      email,
      password,
      displayName: 'Catalog Reader',
    });
    const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
    const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
    const reader = await request(app).get('/api/v1/movies').set('Cookie', cookie).query({ status: 'draft' });
    assert.equal(reader.status, 403);
    assert.match(reader.headers['cache-control'], /no-store/);

    await getPool().query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT $1, id FROM roles WHERE slug = 'admin'
       ON CONFLICT DO NOTHING`,
      [login.body.user.id],
    );
    const admin = await request(app).get(`/api/v1/movies/id/${draftId}`).set('Cookie', cookie);
    assert.equal(admin.status, 200);
    assert.equal(admin.body.data.id, draftId);
    assert.equal(admin.body.data.slug, draftSlug);
  } finally {
    await getPool().query('DELETE FROM movies WHERE slug = $1', [draftSlug]);
  }
});

test('search text cannot change the query structure', async () => {
  const response = await request(app).get('/api/v1/movies').query({
    q: "nosferatu' OR 1=1; DROP TABLE movies;--",
  });
  assert.equal(response.status, 200);
  const stillThere = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(stillThere.status, 200);

  const genre = await request(app).get('/api/v1/movies').query({ genre: "horror' OR '1'='1" });
  assert.equal(genre.status, 400);
});

test('public movie responses omit secrets and internal media notes', async () => {
  const response = await request(app).get('/api/v1/movies/nosferatu');
  const body = JSON.stringify(response.body);

  assert.equal(response.body.data.id, undefined);
  assert.equal(body.includes(nosferatuId), false);
  assert.equal(body.includes('configuration'), false);
  assert.equal(body.includes('api_key'), false);
  assert.equal(body.includes('password'), false);
  assert.equal(body.includes('development placeholder'), false);
  assert.equal(body.includes('dev-seed:night-of-the-living-dead'), false);
  assert.equal(response.body.data.seo.description.includes('public-domain'), true);
});

test('catalog database errors do not return SQL text', async () => {
  await assert.rejects(
    () => catalogQuery('SELECT * FROM movies WHERE slug = $1; DROP TABLE movies', ['nosferatu']),
    (error) => {
      assert.equal(error instanceof AppError, true);
      assert.equal(error.status, 500);
      assert.equal(error.code, 'CATALOG_UNAVAILABLE');
      assert.equal(error.message.includes('SELECT'), false);
      assert.equal(error.message.includes('DROP'), false);
      return true;
    },
  );
});

test('the catalog API works when Redis is unavailable', async () => {
  assert.equal(getRedis(), null);
  const first = await request(app).get('/api/v1/movies/nosferatu');
  const second = await request(app).get('/api/v1/genres');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  await invalidateCatalogCache({ slug: 'nosferatu' });
});

test('representative catalog queries stay responsive on the local seed', async () => {
  const samples = [
    '/api/v1/movies?limit=20',
    '/api/v1/movies/nosferatu',
    '/api/v1/genres/horror/movies',
    '/api/v1/collections/expressionist-shadows',
  ];
  for (const path of samples) {
    const started = Date.now();
    const response = await request(app).get(path);
    assert.equal(response.status, 200);
    assert.ok(Date.now() - started < 2000, path);
  }
});

test('slug lookup can use the movie slug index', async () => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL enable_seqscan = off');
    const plan = await client.query(`EXPLAIN SELECT id FROM movies WHERE slug = 'nosferatu'`);
    assert.match(plan.rows.map((row) => row['QUERY PLAN']).join('\n'), /Index Scan|Index Only Scan/);
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('health, readiness, and the current-user route still respond', async () => {
  const health = await request(app).get('/api/v1/health');
  const ready = await request(app).get('/api/v1/ready');
  const me = await request(app).get('/api/v1/auth/me');

  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');
  assert.equal(ready.status, 200);
  assert.equal(me.status, 401);
});
