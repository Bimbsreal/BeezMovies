import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { publicAdminError } from '../src/admin/audit.js';
import { processAdminOperation } from '../src/admin/control.js';
import { shouldReplace } from '../src/ingestion/priority.js';
import { PROTECTED_PRIORITY } from '../src/ingestion/constants.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p10${Date.now().toString(36)}`;
const created = {
  movieId: null,
  draftId: null,
  genreId: null,
  mergeGenreId: null,
  collectionId: null,
  mediaId: null,
  jobId: null,
  userIds: [],
};

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  if (created.mediaId) await pool.query('DELETE FROM media_references WHERE id = $1', [created.mediaId]);
  if (created.jobId) await pool.query('DELETE FROM ingestion_jobs WHERE id = $1', [created.jobId]);
  const movieIds = [created.movieId, created.draftId].filter(Boolean);
  for (const movieId of movieIds) {
    await pool.query('DELETE FROM search_documents WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM search_index_events WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM catalog_field_provenance WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM collection_movies WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM classification_reviews WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_countries WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_genres WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM admin_audit_events WHERE target_id = $1', [movieId]);
    await pool.query('DELETE FROM movies WHERE id = $1', [movieId]);
  }
  if (created.collectionId) await pool.query('DELETE FROM collections WHERE id = $1', [created.collectionId]);
  const genreIds = [created.genreId, created.mergeGenreId].filter(Boolean);
  if (genreIds.length) {
    await pool.query('DELETE FROM movie_genres WHERE genre_id = ANY($1::uuid[])', [genreIds]);
    await pool.query('DELETE FROM admin_audit_events WHERE target_id = ANY($1::text[])', [genreIds]);
    await pool.query('DELETE FROM genres WHERE id = ANY($1::uuid[])', [genreIds]);
  }
  for (const userId of created.userIds) {
    await pool.query('DELETE FROM admin_audit_events WHERE actor_user_id = $1', [userId]);
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await closePool();
  await closeRedis();
});

async function cookieFor(email, password) {
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(login.status, 200);
  return login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
}

test('admin system reports the release label and public health does not', async () => {
  const admin = await cookieFor('admin@beezmovies.local', 'BeezLocalAdmin1');
  const system = await request(app).get('/api/v1/admin/system').set(csrf).set('Cookie', admin);
  assert.equal(system.status, 200);
  assert.equal(system.body.data.release, 'BeezMovies RC1');

  const health = await request(app).get('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.release, undefined);

  const anonymous = await request(app).get('/api/v1/admin/system').set(csrf);
  assert.equal(anonymous.status, 401);
});

test('anonymous and ordinary users cannot use the admin API', async () => {
  const anonymous = await request(app).get('/api/v1/admin/movies').set(csrf);
  assert.equal(anonymous.status, 401);

  const email = `${stamp}@beezmovies.local`;
  const password = 'PhaseTenUser1';
  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email, password, displayName: 'Phase Ten',
  });
  assert.equal(registered.status, 201);
  created.userIds.push(registered.body.user.id);
  const cookie = await cookieFor(email, password);
  const denied = await request(app).get('/api/v1/admin/dashboard').set(csrf).set('Cookie', cookie);
  assert.equal(denied.status, 403);
  const editorial = await request(app).get('/api/v1/admin/editorial').set(csrf).set('Cookie', cookie);
  assert.equal(editorial.status, 403);
  const publish = await request(app).post('/api/v1/admin/movies/55555555-5555-4555-8555-555555555501/publish').set(csrf).set('Cookie', cookie).send({ confirm: true });
  assert.equal(publish.status, 403);
  const anonBoard = await request(app).get('/api/v1/admin/editorial').set(csrf);
  assert.equal(anonBoard.status, 401);
  assert.equal(JSON.stringify(denied.body).includes('password_hash'), false);
});

test('an administrator can manage a fixture movie without a public login wall', async () => {
  const admin = await cookieFor('admin@beezmovies.local', 'BeezLocalAdmin1');
  const home = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(home.status, 200);

  const inserted = await getPool().query(
    `INSERT INTO movies (canonical_title, slug, status, synopsis, content_type_id)
     VALUES (
       'Phase Ten Fixture', $1, 'draft', 'Admin fixture',
       (SELECT id FROM content_types WHERE code = 'movie')
     )
     RETURNING id`,
    [`phase-ten-${stamp}`],
  );
  await getPool().query(
    `INSERT INTO movie_countries (movie_id, country_id)
     SELECT $1, id FROM countries WHERE code = 'US'
     ON CONFLICT DO NOTHING`,
    [inserted.rows[0].id],
  );
  created.movieId = inserted.rows[0].id;

  const dashboard = await request(app).get('/api/v1/admin/dashboard').set(csrf).set('Cookie', admin);
  assert.equal(dashboard.status, 200);
  assert.ok(dashboard.body.data.catalog.totalMovies >= 1);
  assert.equal(typeof dashboard.body.data.catalog.published, 'number');
  assert.equal(typeof dashboard.body.data.catalog.draft, 'number');
  assert.equal(typeof dashboard.body.data.users.total, 'number');
  assert.equal(typeof dashboard.body.data.media.failedChecks, 'number');
  assert.equal(typeof dashboard.body.data.system.cache, 'string');

  const edited = await request(app).patch(`/api/v1/admin/movies/${created.movieId}`).set(csrf).set('Cookie', admin).send({
    tagline: 'Curated locally',
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.curatedFields.includes('tagline'), true);
  const origin = await getPool().query(
    `SELECT origin FROM catalog_field_provenance WHERE movie_id = $1 AND field_name = 'tagline'`,
    [created.movieId],
  );
  assert.equal(origin.rows[0].origin, 'manual');
  assert.equal(shouldReplace({
    existingValue: 'Curated locally',
    incomingValue: 'Incoming source tagline',
    existingPriority: PROTECTED_PRIORITY + 1,
    incomingPriority: PROTECTED_PRIORITY,
  }), false);

  const unconfirmed = await request(app).post(`/api/v1/admin/movies/${created.movieId}/publish`).set(csrf).set('Cookie', admin).send({});
  assert.equal(unconfirmed.status, 400);

  const blockedPublish = await request(app).post(`/api/v1/admin/movies/${created.movieId}/publish`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(blockedPublish.status, 409);
  const submitted = await request(app).post(`/api/v1/admin/movies/${created.movieId}/submit`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(submitted.body.data.status, 'review');
  const approved = await request(app).post(`/api/v1/admin/movies/${created.movieId}/approve`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(approved.body.data.status, 'approved');
  const stillHiddenDraft = await request(app).get(`/api/v1/movies/phase-ten-${stamp}`);
  assert.equal(stillHiddenDraft.status, 404);
  const published = await request(app).post(`/api/v1/admin/movies/${created.movieId}/publish`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(published.status, 200);
  assert.equal(published.body.data.status, 'active');
  const visible = await request(app).get(`/api/v1/movies/phase-ten-${stamp}`);
  assert.equal(visible.status, 200);

  const archived = await request(app).post(`/api/v1/admin/movies/${created.movieId}/archive`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(archived.status, 200);
  const hidden = await request(app).get(`/api/v1/movies/phase-ten-${stamp}`);
  assert.equal(hidden.status, 404);
  const restored = await request(app).post(`/api/v1/admin/movies/${created.movieId}/restore`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.status, 'draft');
  const stillHidden = await request(app).get(`/api/v1/movies/phase-ten-${stamp}`);
  assert.equal(stillHidden.status, 404);
  const blockedUnpublish = await request(app).post(`/api/v1/admin/movies/${created.movieId}/unpublish`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(blockedUnpublish.status, 409);
  const againSubmit = await request(app).post(`/api/v1/admin/movies/${created.movieId}/submit`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(againSubmit.status, 200);
  const againApprove = await request(app).post(`/api/v1/admin/movies/${created.movieId}/approve`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(againApprove.status, 200);
  const again = await request(app).post(`/api/v1/admin/movies/${created.movieId}/publish`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(again.status, 200);
  const unpublished = await request(app).post(`/api/v1/admin/movies/${created.movieId}/unpublish`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(unpublished.status, 200);
  assert.equal(unpublished.body.data.status, 'approved');
  assert.equal(unpublished.body.data.provenance.find((item) => item.field === 'tagline').source, 'Manual override');

  const injected = await request(app).get('/api/v1/admin/movies').set(csrf).set('Cookie', admin).query({ q: "' OR 1=1 --" });
  assert.equal(injected.status, 200);
  assert.equal(JSON.stringify(injected.body).includes('password_hash'), false);

  const audit = await request(app).get('/api/v1/admin/audit').set(csrf).set('Cookie', admin);
  assert.equal(audit.body.data.some((event) => event.action === 'MOVIE_UPDATED'), true);
});

test('catalog, media, provider, ingestion, and search controls stay authorized', async () => {
  const admin = await cookieFor('admin@beezmovies.local', 'BeezLocalAdmin1');
  const genre = await request(app).post('/api/v1/admin/genres').set(csrf).set('Cookie', admin).send({ name: `Phase Ten ${stamp}` });
  assert.equal(genre.status, 201);
  created.genreId = genre.body.data.id;
  const duplicate = await request(app).post('/api/v1/admin/genres').set(csrf).set('Cookie', admin).send({ name: 'Other', slug: genre.body.data.slug });
  assert.equal(duplicate.status, 409);

  const collection = await request(app).post('/api/v1/admin/collections').set(csrf).set('Cookie', admin).send({
    name: `Phase Ten Collection ${stamp}`,
  });
  assert.equal(collection.status, 201);
  created.collectionId = collection.body.data.id;
  await getPool().query(
    'INSERT INTO collection_movies (collection_id, movie_id, sort_order) VALUES ($1, $2, 0)',
    [created.collectionId, created.movieId],
  );
  const order = await request(app).post(`/api/v1/admin/collections/${created.collectionId}/order`).set(csrf).set('Cookie', admin).send({
    movieIds: [created.movieId],
  });
  assert.equal(order.status, 200);

  const provider = await getPool().query(`SELECT id FROM providers WHERE slug = 'development-media'`);
  const media = await getPool().query(
    `INSERT INTO media_references (
       movie_id, provider_id, external_reference, media_type, quality, status, availability_status
     ) VALUES ($1, $2, $3, 'download', '720p', 'available', 'available')
     RETURNING id`,
    [created.movieId, provider.rows[0].id, `dev:ok:${stamp}`],
  );
  created.mediaId = media.rows[0].id;
  const disabled = await request(app).post(`/api/v1/admin/media/${created.mediaId}/disable`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.data.status, 'unavailable');

  const providers = await request(app).get('/api/v1/admin/providers').set(csrf).set('Cookie', admin);
  assert.equal(providers.status, 200);
  assert.equal(JSON.stringify(providers.body).includes('beezmovies-local-handoff'), false);
  assert.equal(providers.body.data.some((item) => item.credentials === 'Configured'), true);
  const health = await request(app).post(`/api/v1/admin/providers/${provider.rows[0].id}/health-check`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(health.status, 200);
  assert.equal(health.body.data.health, 'available');

  const source = await getPool().query(`SELECT id FROM catalog_sources WHERE slug = 'development-metadata'`);
  const job = await getPool().query(
    `INSERT INTO ingestion_jobs (
       job_type, catalog_source_id, external_id, operation, idempotency_key, status, attempt_count, max_attempts, last_error_code
     ) VALUES ('metadata:upsert', $1, $2, 'upsert', $3, 'dead_letter', 5, 5, 'SOURCE_FAILED')
     RETURNING id`,
    [source.rows[0].id, stamp, `phase-ten-${stamp}`],
  );
  created.jobId = job.rows[0].id;
  const retried = await request(app).post(`/api/v1/admin/ingestion/jobs/${created.jobId}/retry`).set(csrf).set('Cookie', admin).send({});
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.status, 'pending');
  const arbitrary = await request(app).post('/api/v1/admin/ingestion/jobs').set(csrf).set('Cookie', admin).send({
    source: 'https://evil.example/steal',
  });
  assert.equal(arbitrary.status, 400);

  const status = await request(app).get('/api/v1/admin/search/status').set(csrf).set('Cookie', admin);
  assert.equal(status.status, 200);
  assert.equal(typeof status.body.data.indexedMovies, 'number');
  const reindex = await request(app).post(`/api/v1/admin/search/movies/${created.movieId}/reindex`).set(csrf).set('Cookie', admin).send({});
  assert.equal(reindex.status, 202);
});

test('role changes require a super admin and bulk actions require confirmation', async () => {
  const email = `${stamp}-admin@beezmovies.local`;
  const password = 'PhaseTenAdmin1';
  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email, password, displayName: 'Limited Admin',
  });
  created.userIds.push(registered.body.user.id);
  await getPool().query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE slug = 'admin'`,
    [registered.body.user.id],
  );
  const limited = await cookieFor(email, password);
  const superCookie = await cookieFor('admin@beezmovies.local', 'BeezLocalAdmin1');

  const users = await request(app).get('/api/v1/admin/users').set(csrf).set('Cookie', limited);
  assert.equal(users.status, 200);
  assert.equal(JSON.stringify(users.body).includes('password_hash'), false);

  const elevation = await request(app).post(`/api/v1/admin/users/${registered.body.user.id}/roles`).set(csrf).set('Cookie', limited).send({
    roles: ['super_admin'], confirm: true,
  });
  assert.equal(elevation.status, 403);

  const granted = await request(app).post(`/api/v1/admin/users/${registered.body.user.id}/roles`).set(csrf).set('Cookie', superCookie).send({
    roles: ['user', 'admin'], confirm: true,
  });
  assert.equal(granted.status, 200);
  assert.equal(granted.body.data.roles.includes('super_admin'), false);

  const bulk = await request(app).post('/api/v1/admin/movies/bulk').set(csrf).set('Cookie', superCookie).send({
    action: 'publish', ids: [created.movieId],
  });
  assert.equal(bulk.status, 400);
  const queued = await request(app).post('/api/v1/admin/movies/bulk').set(csrf).set('Cookie', superCookie).send({
    action: 'publish', ids: [created.movieId], confirm: true,
  });
  assert.equal(queued.status, 202);
  await processAdminOperation(queued.body.data.id);
  const movie = await request(app).get(`/api/v1/admin/movies/${created.movieId}`).set(csrf).set('Cookie', superCookie);
  assert.equal(movie.body.data.status, 'active');
});

test('cms create, genre merge, collection reindex, and audit writes stay controlled', async () => {
  const admin = await cookieFor('admin@beezmovies.local', 'BeezLocalAdmin1');
  const anonymous = await request(app).post('/api/v1/admin/movies').set(csrf).send({
    canonicalTitle: 'Blocked', confirm: true,
  });
  assert.equal(anonymous.status, 401);

  const createdMovie = await request(app).post('/api/v1/admin/movies').set(csrf).set('Cookie', admin).send({
    canonicalTitle: `Phase Cms ${stamp}`, confirm: true,
  });
  assert.equal(createdMovie.status, 201);
  assert.equal(createdMovie.body.data.status, 'draft');
  created.draftId = createdMovie.body.data.id;
  assert.equal(createdMovie.body.data.slug.startsWith('phase-cms-'), true);

  const source = await request(app).post('/api/v1/admin/genres').set(csrf).set('Cookie', admin).send({ name: `Merge Source ${stamp}` });
  assert.equal(source.status, 201);
  created.mergeGenreId = source.body.data.id;
  await getPool().query(
    'INSERT INTO movie_genres (movie_id, genre_id) VALUES ($1, $2)',
    [created.draftId, created.mergeGenreId],
  );
  const merged = await request(app).post(`/api/v1/admin/genres/${created.mergeGenreId}/merge`).set(csrf).set('Cookie', admin).send({
    targetId: created.genreId, confirm: true,
  });
  assert.equal(merged.status, 200);
  const remaining = await getPool().query('SELECT genre_id FROM movie_genres WHERE movie_id = $1', [created.draftId]);
  assert.equal(remaining.rows.some((row) => row.genre_id === created.genreId), true);
  assert.equal(remaining.rows.some((row) => row.genre_id === created.mergeGenreId), false);
  const removed = await request(app).delete(`/api/v1/admin/genres/${created.genreId}`).set(csrf).set('Cookie', admin);
  assert.equal(removed.status, 404);

  const bulkDelete = await request(app).post('/api/v1/admin/movies/bulk').set(csrf).set('Cookie', admin).send({
    action: 'delete', ids: [created.draftId], confirm: true,
  });
  assert.equal(bulkDelete.status, 400);

  const reindexed = await request(app).post(`/api/v1/admin/collections/${created.collectionId}/reindex`).set(csrf).set('Cookie', admin).send({ confirm: true });
  assert.equal(reindexed.status, 202);
  assert.equal(typeof reindexed.body.data.queued, 'number');

  const auditWrite = await request(app).patch('/api/v1/admin/audit').set(csrf).set('Cookie', admin).send({ result: 'failed' });
  assert.equal(auditWrite.status, 404);
  const system = await request(app).get('/api/v1/admin/system').set(csrf).set('Cookie', admin);
  assert.equal(system.body.data.pwa.assets.find((item) => item.name === 'Bee artwork').present, true);
  assert.equal(JSON.stringify(system.body).includes('password_hash'), false);
});

test('admin failures do not return database text', () => {
  const error = publicAdminError({ message: 'SELECT password_hash FROM users', code: '42P01' });
  assert.equal(error.message.includes('password_hash'), false);
  assert.equal(error.code, 'ADMIN_UNAVAILABLE');
});
