import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { enqueueJob, claimJobById, pruneIngestionHistory, publicJobState } from '../src/ingestion/jobs.js';
import { processClaimedJob, runJobById } from '../src/ingestion/pipeline.js';
import { loadSource } from '../src/ingestion/registry.js';
import { assertSafeMetadataUrl } from '../src/ingestion/security.js';
import { releaseSource, reserveSource } from '../src/ingestion/rate-limit.js';
import { withTransaction } from '../src/db/transaction.js';
import { setIngestionQueue } from '../src/ingestion/admin-service.js';
import { runIngestionCycle } from '../src/ingestion/worker.js';
import { qualityIssues } from '../src/ingestion/quality-gate.js';
import { shouldReplace } from '../src/ingestion/priority.js';
import { publicFailure } from '../src/ingestion/errors.js';
import { discoveryCacheStats } from '../src/discovery/cache.js';
import { PROTECTED_PRIORITY } from '../src/ingestion/constants.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p25${Date.now().toString(36)}`;
const sourceId = '77777777-7777-4777-8777-777777777703';
const created = { movieIds: [], jobIds: [], adminId: null };

before(async () => {
  await seed();
  const admin = await getPool().query(
    `SELECT id FROM users WHERE normalized_email = 'admin@beezmovies.local'`,
  );
  created.adminId = admin.rows[0].id;
});

after(async () => {
  const pool = getPool();
  if (created.adminId) await setIngestionQueue(created.adminId, true);
  await pool.query(
    `UPDATE catalog_source_runtime
     SET consecutive_failures = 0, health_status = 'healthy', disabled_until = NULL
     WHERE catalog_source_id = $1`,
    [sourceId],
  );
  if (created.jobIds.length) {
    await pool.query('DELETE FROM ingestion_jobs WHERE id = ANY($1::uuid[])', [created.jobIds]);
  }
  await pool.query(
    `DELETE FROM ingestion_jobs WHERE idempotency_key LIKE $1`,
    [`development-metadata:%${stamp}%`],
  );
  for (const movieId of created.movieIds) {
    await pool.query('DELETE FROM ingestion_reviews WHERE candidate_movie_id = $1', [movieId]);
    await pool.query('DELETE FROM search_documents WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM search_index_events WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM catalog_field_provenance WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM collection_movies WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_genres WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_languages WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM classification_reviews WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_countries WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM alternate_titles WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_credits WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_images WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movie_videos WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM external_identifiers WHERE movie_id = $1', [movieId]);
    await pool.query('DELETE FROM movies WHERE id = $1', [movieId]);
  }
  await pool.query(
    `DELETE FROM ingestion_reviews WHERE external_id = $1`,
    ['dev-meta:nosferatu-lookalike'],
  );
  await closePool();
  await closeRedis();
});

function sample(externalId, extra = {}) {
  return {
    externalId,
    title: `Pipeline Sample ${stamp}`,
    originalTitle: `Probe ${stamp}`,
    synopsis: 'A local pipeline sample with enough fields to publish.',
    releaseDate: '1921-01-02',
    runtimeMinutes: 80,
    originalLanguage: 'en',
    genres: ['Drama'],
    countries: ['US'],
    contentType: 'movie',
    credits: [
      { name: 'Pipeline Director', department: 'Directing', job: 'Director', billingOrder: 0 },
    ],
    images: [{
      type: 'poster',
      url: 'https://images.example.com/beezmovies/posters/pipeline.jpg',
      width: 500,
      height: 750,
    }],
    sourceUpdatedAt: '2024-01-01T00:00:00.000Z',
    ...extra,
  };
}

async function runRaw(externalId, raw) {
  const source = await loadSource('development-metadata');
  const queued = await enqueueJob({
    source,
    externalId,
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test', discovery: 'METADATA_REFRESH' },
  });
  created.jobIds.push(queued.job.id);
  const finished = await runJobById(queued.job.id, { raw });
  const result = finished.outcome;
  if (result?.movieId) created.movieIds.push(result.movieId);
  return result;
}

test('catalog ingestion pipeline', async () => {
  const pool = getPool();
  await pool.query(
    `DELETE FROM ingestion_jobs
     WHERE external_id IN ('dev-meta:unavailable', 'dev-meta:malformed', 'dev-meta:nosferatu-lookalike')
        OR idempotency_key IN (
          'development-metadata:discover:NEW_RELEASE_DISCOVERY',
          'development-metadata:discover:POPULAR_DISCOVERY'
        )`,
  );
  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: 'admin@beezmovies.local', password: 'BeezLocalAdmin1' });
  assert.equal(adminLogin.status, 200);
  const admin = adminLogin.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];

  const anonymous = await request(app).get('/api/v1/admin/ingestion/jobs').set(csrf);
  assert.equal(anonymous.status, 401);
  const arbitrary = await request(app)
    .post('/api/v1/admin/ingestion/jobs')
    .set(csrf)
    .set('Cookie', admin)
    .send({ source: 'https://evil.example/feed' });
  assert.equal(arbitrary.status, 400);

  for (const url of [
    'http://images.example.com/a.jpg',
    'https://127.0.0.1/a.jpg',
    'https://10.1.1.1/a.jpg',
    'https://169.254.1.1/a.jpg',
    'https://user:pass@images.example.com/a.jpg',
    'https://localhost/a.jpg',
  ]) {
    assert.throws(() => assertSafeMetadataUrl(url));
  }
  assert.equal(assertSafeMetadataUrl('https://images.example.com/a.jpg').protocol, 'https:');

  const externalId = `dev-meta:${stamp}`;
  const started = Date.now();
  const published = await runRaw(externalId, sample(externalId));
  const singleMs = Date.now() - started;
  assert.equal(published.action, 'created');
  assert.equal(published.publication, 'published');
  const movie = await pool.query('SELECT status, synopsis, original_title, release_year FROM movies WHERE id = $1', [published.movieId]);
  assert.equal(movie.rows[0].status, 'active');
  assert.equal(movie.rows[0].original_title, `Probe ${stamp}`);
  assert.equal(movie.rows[0].release_year, 1921);
  const media = await pool.query('SELECT COUNT(*)::int AS count FROM media_references WHERE movie_id = $1', [published.movieId]);
  assert.equal(media.rows[0].count, 0);
  const indexed = await pool.query(
    `SELECT COUNT(*)::int AS count FROM search_index_events WHERE movie_id = $1`,
    [published.movieId],
  );
  assert.equal(indexed.rows[0].count >= 1, true);
  const genre = await pool.query(
    `SELECT g.slug FROM movie_genres mg JOIN genres g ON g.id = mg.genre_id WHERE mg.movie_id = $1`,
    [published.movieId],
  );
  assert.equal(genre.rows.some((row) => row.slug === 'drama'), true);

  const duplicateStarted = Date.now();
  const source = await loadSource('development-metadata');
  const first = await enqueueJob({
    source,
    externalId: `dev-meta:dup-${stamp}`,
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  const second = await enqueueJob({
    source,
    externalId: `dev-meta:dup-${stamp}`,
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  const duplicateMs = Date.now() - duplicateStarted;
  created.jobIds.push(first.job.id);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(first.job.id, second.job.id);

  const incomplete = await runRaw(`dev-meta:gap-${stamp}`, sample(`dev-meta:gap-${stamp}`, {
    title: `Pipeline Gap ${stamp}`,
    synopsis: null,
    images: [],
    genres: [],
  }));
  assert.equal(incomplete.publication, 'pending_review');
  assert.equal(incomplete.issues.includes('synopsis'), true);
  assert.equal(incomplete.issues.includes('poster'), true);
  const draft = await pool.query('SELECT status FROM movies WHERE id = $1', [incomplete.movieId]);
  assert.equal(draft.rows[0].status, 'draft');

  const beforeNosferatu = await pool.query(
    `SELECT COUNT(*)::int AS count FROM movies WHERE canonical_title = 'Nosferatu' AND release_year = 1922`,
  );
  const lookalike = await runJobById((await enqueueJob({
    source,
    externalId: 'dev-meta:nosferatu-lookalike',
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  })).job.id);
  created.jobIds.push(lookalike.job.id);
  assert.equal(lookalike.outcome.action, 'review');
  const afterNosferatu = await pool.query(
    `SELECT COUNT(*)::int AS count FROM movies WHERE canonical_title = 'Nosferatu' AND release_year = 1922`,
  );
  assert.equal(afterNosferatu.rows[0].count, beforeNosferatu.rows[0].count);
  const review = await pool.query(
    `SELECT status FROM ingestion_reviews WHERE external_id = 'dev-meta:nosferatu-lookalike' AND status = 'pending'`,
  );
  assert.equal(review.rowCount > 0, true);

  await pool.query(
    `UPDATE catalog_field_provenance SET origin = 'manual' WHERE movie_id = $1 AND field_name = 'synopsis'`,
    [published.movieId],
  );
  const refreshStarted = Date.now();
  const refreshed = await runRaw(externalId, sample(externalId, {
    synopsis: 'This automatic synopsis must not replace the manual one.',
    sourceUpdatedAt: '2026-01-01T00:00:00.000Z',
  }));
  const refreshMs = Date.now() - refreshStarted;
  assert.equal(refreshed.action, 'updated');
  const kept = await pool.query('SELECT synopsis FROM movies WHERE id = $1', [published.movieId]);
  assert.equal(kept.rows[0].synopsis, 'A local pipeline sample with enough fields to publish.');
  assert.equal(shouldReplace({
    existingValue: 'kept',
    incomingValue: 'incoming',
    existingPriority: PROTECTED_PRIORITY + 1,
    incomingPriority: 40,
  }), false);

  const releases = await request(app)
    .post('/api/v1/admin/ingestion/jobs')
    .set(csrf)
    .set('Cookie', admin)
    .send({ source: 'development-metadata', operation: 'discover', discovery: 'NEW_RELEASE_DISCOVERY' });
  const popular = await request(app)
    .post('/api/v1/admin/ingestion/jobs')
    .set(csrf)
    .set('Cookie', admin)
    .send({ source: 'development-metadata', operation: 'discover', discovery: 'POPULAR_DISCOVERY' });
  assert.equal(releases.status, 201);
  assert.equal(popular.status, 201);
  assert.notEqual(releases.body.data.id, popular.body.data.id);
  created.jobIds.push(releases.body.data.id, popular.body.data.id);
  const again = await request(app)
    .post('/api/v1/admin/ingestion/jobs')
    .set(csrf)
    .set('Cookie', admin)
    .send({ source: 'development-metadata', operation: 'discover', discovery: 'NEW_RELEASE_DISCOVERY' });
  assert.equal(again.body.data.created, false);

  const unavailable = await enqueueJob({
    source,
    externalId: 'dev-meta:unavailable',
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  created.jobIds.push(unavailable.job.id);
  const timedOut = await runJobById(unavailable.job.id);
  assert.equal(timedOut.outcome.action, 'failed');
  const retry = await request(app)
    .post(`/api/v1/admin/ingestion/jobs/${unavailable.job.id}/retry`)
    .set(csrf)
    .set('Cookie', admin)
    .send({});
  assert.equal(retry.status, 200);
  assert.equal(retry.body.data.status, 'pending');

  const malformed = await enqueueJob({
    source,
    externalId: 'dev-meta:malformed',
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  created.jobIds.push(malformed.job.id);
  const dead = await runJobById(malformed.job.id);
  assert.equal(dead.outcome.action, 'dead_letter');

  const queued = await enqueueJob({
    source,
    externalId: `dev-meta:cancel-${stamp}`,
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  created.jobIds.push(queued.job.id);
  assert.equal(publicJobState(queued.job), 'QUEUED');
  const cancel = await request(app)
    .post(`/api/v1/admin/ingestion/jobs/${queued.job.id}/cancel`)
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.data.state, 'CANCELLED');
  assert.equal(await claimJobById(queued.job.id), null);

  const batch = await request(app)
    .post('/api/v1/admin/ingestion/batches')
    .set(csrf)
    .set('Cookie', admin)
    .send({
      confirm: true,
      source: 'development-metadata',
      externalIds: [`dev-meta:batch-a-${stamp}`, `dev-meta:batch-b-${stamp}`],
    });
  assert.equal(batch.status, 202);
  assert.equal(batch.body.data.total, 2);
  assert.equal(batch.body.data.successful, 2);
  assert.equal(batch.body.data.skipped, 0);
  const overflow = await request(app)
    .post('/api/v1/admin/ingestion/batches')
    .set(csrf)
    .set('Cookie', admin)
    .send({
      confirm: true,
      source: 'development-metadata',
      externalIds: Array.from({ length: 26 }, (_, index) => `dev-meta:loop-${stamp}-${index}`),
    });
  assert.equal(overflow.status, 400);
  const batchJobs = await pool.query(
    `SELECT id FROM ingestion_jobs WHERE external_id LIKE $1`,
    [`dev-meta:batch-%${stamp}`],
  );
  for (const row of batchJobs.rows) created.jobIds.push(row.id);

  await setIngestionQueue(created.adminId, false);
  const pausedJob = await enqueueJob({
    source,
    externalId: `dev-meta:paused-${stamp}`,
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  created.jobIds.push(pausedJob.job.id);
  await runIngestionCycle();
  const stillQueued = await pool.query('SELECT status FROM ingestion_jobs WHERE id = $1', [pausedJob.job.id]);
  assert.equal(stillQueued.rows[0].status, 'pending');
  await setIngestionQueue(created.adminId, true);

  const generation = discoveryCacheStats().generation;
  await runRaw(`dev-meta:cache-${stamp}`, sample(`dev-meta:cache-${stamp}`, {
    title: `Pipeline Cache ${stamp}`,
  }));
  assert.equal(discoveryCacheStats().generation > generation, true);

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE catalog_source_runtime
       SET min_interval_ms = 60000, last_request_at = NOW()
       WHERE catalog_source_id = $1`,
      [sourceId],
    );
    const reserved = await reserveSource(client, source);
    assert.equal(reserved.ok, false);
    assert.equal(reserved.waitMs > 0, true);
    throw new Error('rollback-rate-limit');
  }).catch((error) => {
    assert.equal(error.message, 'rollback-rate-limit');
  });

  const oldCompleted = await pool.query(
    `INSERT INTO ingestion_jobs (
       job_type, catalog_source_id, external_id, operation, idempotency_key, status, completed_at, payload
     )
     VALUES ('metadata:upsert', $1, $2, 'upsert', $3, 'completed', NOW() - INTERVAL '40 days', '{}'::jsonb)
     RETURNING id`,
    [sourceId, `dev-meta:old-${stamp}`, `development-metadata:old-${stamp}:upsert`],
  );
  const recentDead = await pool.query(
    `INSERT INTO ingestion_jobs (
       job_type, catalog_source_id, external_id, operation, idempotency_key, status, completed_at, payload
     )
     VALUES ('metadata:upsert', $1, $2, 'upsert', $3, 'dead_letter', NOW() - INTERVAL '10 days', '{}'::jsonb)
     RETURNING id`,
    [sourceId, `dev-meta:dead-${stamp}`, `development-metadata:dead-${stamp}:upsert`],
  );
  created.jobIds.push(recentDead.rows[0].id);
  await pruneIngestionHistory();
  const pruned = await pool.query('SELECT id FROM ingestion_jobs WHERE id = $1', [oldCompleted.rows[0].id]);
  const keptDead = await pool.query('SELECT id FROM ingestion_jobs WHERE id = $1', [recentDead.rows[0].id]);
  assert.equal(pruned.rowCount, 0);
  assert.equal(keptDead.rowCount, 1);

  const broken = await enqueueJob({
    source,
    externalId: `dev-meta:broken-${stamp}`,
    operation: 'upsert',
    jobType: 'metadata:upsert',
    payload: { origin: 'test' },
  });
  created.jobIds.push(broken.job.id);
  const claimed = await claimJobById(broken.job.id);
  claimed.job.catalog_source_id = '00000000-0000-4000-8000-000000000099';
  let failed;
  try {
    failed = await processClaimedJob(claimed.job);
  } finally {
    await releaseSource(sourceId);
  }
  assert.equal(failed.action, 'failed');
  assert.equal(publicFailure({ code: '08006' }).transient, true);
  const during = Date.now();
  const page = await request(app).get('/api/v1/movies/nosferatu');
  const home = await request(app).get('/api/v1/discovery/home');
  const search = await request(app).get('/api/v1/search').query({ q: 'nosferatu' });
  const download = await request(app)
    .post('/api/v1/movies/nosferatu/download')
    .set(csrf)
    .send({});
  assert.equal(page.status, 200);
  assert.equal(home.status, 200);
  assert.equal(search.status, 200);
  assert.equal(download.status, 200);
  const publicMs = Date.now() - during;

  const nosferatu = await pool.query(`SELECT id FROM movies WHERE slug = 'nosferatu'`);
  const validation = await request(app)
    .post('/api/v1/admin/ingestion/validate')
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true, movieId: nosferatu.rows[0].id });
  assert.equal(validation.status, 200);
  assert.equal(validation.body.data.ready, true);
  const reindex = await request(app)
    .post('/api/v1/admin/ingestion/reindex')
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true, movieId: nosferatu.rows[0].id });
  assert.equal(reindex.status, 200);
  assert.equal(reindex.body.data.status, 'indexed');
  const failedBefore = await pool.query(
    `SELECT id, status FROM ingestion_jobs WHERE status IN ('failed', 'dead_letter')`,
  );
  const retriedFailed = await request(app)
    .post('/api/v1/admin/ingestion/retry-failed')
    .set(csrf)
    .set('Cookie', admin)
    .send({ confirm: true });
  assert.equal(retriedFailed.status, 200);
  assert.equal(typeof retriedFailed.body.data.retried, 'number');
  for (const row of failedBefore.rows) {
    if (!created.jobIds.includes(row.id)) {
      await pool.query('UPDATE ingestion_jobs SET status = $2 WHERE id = $1', [row.id, row.status]);
    }
  }
  const sources = await request(app).get('/api/v1/admin/ingestion/sources').set(csrf).set('Cookie', admin);
  const adapter = sources.body.data.sources.find((item) => item.slug === 'development-metadata').adapter;
  assert.equal(adapter.authentication, 'none');
  assert.equal(JSON.stringify(adapter).includes('password'), false);

  const metrics = await request(app).get('/api/v1/admin/ingestion/metrics').set(csrf).set('Cookie', admin);
  assert.equal(metrics.status, 200);
  assert.equal(typeof metrics.body.data.queued, 'number');
  assert.equal(typeof metrics.body.data.deadLetter, 'number');
  assert.equal(JSON.stringify(metrics.body).includes('visitor'), false);

  assert.equal(qualityIssues({ displayTitle: 'A' }).includes('synopsis'), true);
  const startup = readFileSync(new URL('../../frontend/components/startup/startup-sequence.js', import.meta.url), 'utf8');
  const workerScript = readFileSync(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8');
  assert.equal(startup.includes('STARTUP_BEE'), true);
  assert.equal(workerScript.includes('/branding/beezmovies-logo.jpg'), true);
  assert.equal(workerScript.includes("request.method !== 'GET'"), true);

  console.log(JSON.stringify({
    singleMs,
    duplicateMs,
    refreshMs,
    publicMs,
  }));
});
