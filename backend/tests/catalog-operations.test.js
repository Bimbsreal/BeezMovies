import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { canonicalGenre } from '../src/ingestion/titles.js';
import { publicationIssues } from '../src/catalog/quality.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p18${Date.now().toString(36)}`;
const sourceSlug = `phase18-src-${stamp}`;
const keeperSlug = `phase18-keep-${stamp}`;
const ids = { source: null, keeper: null, review: null, job: null, refreshJob: null };

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  const movieIds = [ids.source, ids.keeper].filter(Boolean);
  if (movieIds.length) {
    await pool.query('DELETE FROM movie_slug_redirects WHERE movie_id = ANY($1::uuid[]) OR slug = $2', [movieIds, sourceSlug]);
    await pool.query('DELETE FROM search_documents WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM search_index_events WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM catalog_field_provenance WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM movie_genres WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM media_references WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM collection_movies WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM external_identifiers WHERE movie_id = ANY($1::uuid[])', [movieIds]);
    await pool.query('DELETE FROM ingestion_reviews WHERE candidate_movie_id = ANY($1::uuid[])', [movieIds]);
  }
  for (const jobId of [ids.job, ids.refreshJob]) {
    if (jobId) await pool.query('DELETE FROM ingestion_jobs WHERE id = $1', [jobId]);
  }
  if (movieIds.length) await pool.query('DELETE FROM movies WHERE id = ANY($1::uuid[])', [movieIds]);
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

test('genre aliases share one slug and publication rules stay limited', () => {
  assert.equal(canonicalGenre('Sci-Fi').slug, 'science-fiction');
  assert.equal(canonicalGenre('Science Fiction').slug, 'science-fiction');
  assert.equal(canonicalGenre('Science-Fiction').name, 'Science Fiction');
  assert.equal(canonicalGenre('Film Noir').slug, 'film-noir');
  assert.deepEqual(publicationIssues({
    title: 'Nosferatu',
    synopsis: 'A silent film.',
    releaseYear: 1922,
    genreCount: 1,
    posterCount: 1,
  }), []);
  assert.deepEqual(publicationIssues({ title: 'Untitled' }), ['release', 'synopsis', 'genre', 'poster']);
});

test('catalog health and review are admin only', async () => {
  const anonymous = await request(app).get('/api/v1/admin/catalog-health').set(csrf);
  assert.equal(anonymous.status, 401);
  const admin = await adminCookie();
  const started = Date.now();
  const health = await request(app).get('/api/v1/admin/catalog-health').set(csrf).set('Cookie', admin);
  const elapsed = Date.now() - started;
  assert.equal(health.status, 200);
  assert.ok(health.body.data.catalog.total >= 3);
  assert.equal(typeof health.body.data.metadata.duplicateCandidates, 'number');
  assert.equal(typeof health.body.data.media.available, 'number');
  assert.equal(typeof health.body.data.search.indexed, 'number');
  assert.ok(elapsed < 1000, `catalog health took ${elapsed}ms`);
  assert.equal(JSON.stringify(health.body).includes('password'), false);
});

test('review rejection, confirmed merge, validation, and refresh stay explicit', async () => {
  const pool = getPool();
  const admin = await adminCookie();
  const source = await pool.query(
    `INSERT INTO movies (canonical_title, slug, status, synopsis, release_year, content_type_id)
     VALUES (
       'Phase 18 Source', $1, 'active', 'Source synopsis.', 1922,
       (SELECT id FROM content_types WHERE code = 'movie')
     ) RETURNING id`,
    [sourceSlug],
  );
  const keeper = await pool.query(
    `INSERT INTO movies (canonical_title, slug, status, synopsis, release_year, content_type_id)
     VALUES (
       'Phase 18 Keeper', $1, 'active', 'Keeper synopsis.', 1922,
       (SELECT id FROM content_types WHERE code = 'movie')
     ) RETURNING id`,
    [keeperSlug],
  );
  ids.source = source.rows[0].id;
  ids.keeper = keeper.rows[0].id;
  const job = await pool.query(
    `INSERT INTO ingestion_jobs (
       job_type, catalog_source_id, external_id, operation, idempotency_key, status, payload
     ) VALUES (
       'metadata:resolve', '77777777-7777-4777-8777-777777777703', $1, 'upsert', $2, 'completed', '{}'::jsonb
     ) RETURNING id`,
    [`phase18-${stamp}`, `phase18-${stamp}:review`],
  );
  ids.job = job.rows[0].id;
  const review = await pool.query(
    `INSERT INTO ingestion_reviews (job_id, candidate_movie_id, external_id, confidence, signals)
     VALUES ($1, $2, $3, 'medium', '{"reason":"title-year"}'::jsonb) RETURNING id`,
    [ids.job, ids.source, `phase18-${stamp}`],
  );
  ids.review = review.rows[0].id;

  const rejected = await request(app)
    .post(`/api/v1/admin/review/${ids.review}`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ action: 'reject', confirm: true });
  assert.equal(rejected.status, 200);
  const still = await pool.query('SELECT status FROM movies WHERE id = ANY($1::uuid[])', [[ids.source, ids.keeper]]);
  assert.equal(still.rowCount, 2);
  assert.equal(still.rows.every((row) => row.status === 'active'), true);

  const unconfirmed = await request(app)
    .post(`/api/v1/admin/movies/${ids.keeper}/merge`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ sourceId: ids.source });
  assert.equal(unconfirmed.status, 400);

  const merged = await request(app)
    .post(`/api/v1/admin/movies/${ids.keeper}/merge`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ sourceId: ids.source, confirm: true });
  assert.equal(merged.status, 200);
  assert.equal(merged.body.data.redirectTo, keeperSlug);

  const archived = await pool.query('SELECT status, slug FROM movies WHERE id = $1', [ids.source]);
  assert.equal(archived.rows[0].status, 'archived');
  assert.equal(archived.rows[0].slug, `${sourceSlug}-merged`);

  const moved = await request(app).get(`/api/v1/movies/${sourceSlug}`);
  assert.equal(moved.status, 301);
  assert.equal(moved.body.error.code, 'SLUG_MOVED');
  assert.equal(moved.body.error.details.slug, keeperSlug);

  const checked = await request(app)
    .post(`/api/v1/admin/movies/${ids.keeper}/validate`)
    .set(csrf)
    .set('Cookie', admin)
    .send({});
  assert.equal(checked.status, 200);
  assert.equal(checked.body.data.ready, false);
  assert.ok(checked.body.data.issues.includes('genre'));

  const missing = await request(app)
    .post(`/api/v1/admin/movies/${ids.keeper}/refresh`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true });
  assert.equal(missing.status, 409);

  await pool.query(
    `INSERT INTO external_identifiers (movie_id, catalog_source_id, external_id)
     VALUES ($1, '77777777-7777-4777-8777-777777777703', $2)`,
    [ids.keeper, `phase18-refresh-${stamp}`],
  );
  const queued = await request(app)
    .post(`/api/v1/admin/movies/${ids.keeper}/refresh`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true });
  assert.equal(queued.status, 202);
  ids.refreshJob = queued.body.data.jobId;
  const again = await request(app)
    .post(`/api/v1/admin/movies/${ids.keeper}/refresh`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true });
  assert.equal(again.status, 202);
  assert.equal(again.body.data.created, false);
  const jobs = await pool.query(
    'SELECT COUNT(*)::int AS count FROM ingestion_jobs WHERE external_id = $1',
    [`phase18-refresh-${stamp}`],
  );
  assert.equal(jobs.rows[0].count, 1);
});
