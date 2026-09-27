import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { resolveMovieDownload } from '../src/media/resolution.js';
import { classifyMedia } from '../src/media/availability.js';
import { assertApprovedDestination } from '../src/media/validate.js';
import { rankCandidates } from '../src/media/selection.js';
import { createRateLimiter } from '../src/middleware/rate-limit.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const created = [];

before(async () => {
  await seed();
});

after(async () => {
  for (const item of created.reverse()) {
    await getPool().query(item.sql, item.params);
  }
  await closePool();
  await closeRedis();
});

function track(sql, params) {
  created.push({ sql, params });
}

async function insertMovie(slug) {
  const result = await getPool().query(
    `INSERT INTO movies (canonical_title, slug, status, content_type_id)
     VALUES ($1, $2, 'active', (SELECT id FROM content_types WHERE code = 'movie'))
     RETURNING id`,
    [slug, slug],
  );
  track('DELETE FROM movies WHERE id = $1', [result.rows[0].id]);
  return result.rows[0].id;
}

async function insertProvider(slug, status = 'active', priority = 10) {
  const result = await getPool().query(
    `INSERT INTO providers (name, slug, provider_type, status, capabilities, configuration)
     VALUES ($1, $2, 'media', $3, $4::jsonb, '{}'::jsonb)
     RETURNING id`,
    [slug, slug, status, JSON.stringify({ priority, media_types: ['download'] })],
  );
  track('DELETE FROM providers WHERE id = $1', [result.rows[0].id]);
  return result.rows[0].id;
}

async function insertReference(movieId, providerId, externalReference, mediaType = 'download') {
  const result = await getPool().query(
    `INSERT INTO media_references (
       movie_id, provider_id, external_reference, media_type, quality,
       status, availability_status, rights_status, metadata
     ) VALUES ($1, $2, $3, $4, '720p', 'available', 'available', 'AUTHORIZED', '{"format":"development-text"}'::jsonb)
     RETURNING id`,
    [movieId, providerId, externalReference, mediaType],
  );
  track('DELETE FROM media_references WHERE id = $1', [result.rows[0].id]);
  return result.rows[0].id;
}

test('candidate ranking prefers healthy higher-priority download references', () => {
  const ranked = rankCandidates([
    {
      mediaType: 'stream',
      providerStatus: 'active',
      providerSlug: 'development-stream',
      quality: '2160p',
      health: 'available',
      priority: 100,
    },
    {
      mediaType: 'download',
      providerStatus: 'inactive',
      providerSlug: 'development-off',
      quality: '1080p',
      health: 'available',
      priority: 100,
    },
    {
      mediaType: 'download',
      providerStatus: 'active',
      providerSlug: 'development-b',
      quality: '720p',
      health: 'available',
      priority: 5,
    },
    {
      mediaType: 'download',
      providerStatus: 'active',
      providerSlug: 'development-a',
      quality: '1080p',
      health: 'unavailable',
      priority: 50,
    },
  ], { enabled: ['development-stream', 'development-off', 'development-a', 'development-b'] });

  assert.deepEqual(ranked.map((item) => item.providerSlug), ['development-b', 'development-a']);
});

test('provider failure fails over to the next authorized reference', async () => {
  const slug = `phase8-failover-${randomUUID().slice(0, 8)}`;
  const movieId = await insertMovie(slug);
  const failing = await insertProvider('development-failover', 'active', 80);
  const backup = await insertProvider('development-backup', 'active', 10);
  await insertReference(movieId, failing, 'dev:fail:primary');
  await insertReference(movieId, backup, 'dev:ok:backup');

  const started = Date.now();
  const result = await resolveMovieDownload(slug, {
    enabledSlugs: ['development-failover', 'development-backup'],
  });
  const durationMs = Date.now() - started;

  assert.equal(result.state, 'ready');
  assert.equal(result.filename, `${slug}-development.txt`);
  assert.ok(durationMs < 2000, `resolution took ${durationMs}ms`);
});

test('invalid, expired, disabled, and timing failures stay inside the resolution service', async () => {
  const slug = `phase8-errors-${randomUUID().slice(0, 8)}`;
  const movieId = await insertMovie(slug);
  const providerId = await insertProvider('development-errors', 'active', 10);

  await insertReference(movieId, providerId, 'https://127.0.0.1/secret');
  await assert.rejects(
    () => resolveMovieDownload(slug, { enabledSlugs: ['development-errors'] }),
    (error) => error.code === 'MEDIA_NOT_FOUND' && !error.message.includes('127.0.0.1'),
  );

  await getPool().query('DELETE FROM media_references WHERE movie_id = $1', [movieId]);
  await insertReference(movieId, providerId, 'dev:expired:title');
  await assert.rejects(
    () => resolveMovieDownload(slug, { enabledSlugs: ['development-errors'] }),
    (error) => error.code === 'MEDIA_EXPIRED',
  );

  await getPool().query('DELETE FROM media_references WHERE movie_id = $1', [movieId]);
  await getPool().query(`UPDATE providers SET status = 'inactive' WHERE id = $1`, [providerId]);
  await insertReference(movieId, providerId, 'dev:ok:hidden');
  await assert.rejects(
    () => resolveMovieDownload(slug, { enabledSlugs: ['development-errors'] }),
    (error) => error.code === 'MEDIA_UNAVAILABLE',
  );

  await getPool().query(`UPDATE providers SET status = 'active' WHERE id = $1`, [providerId]);
  await getPool().query('DELETE FROM media_references WHERE movie_id = $1', [movieId]);
  await insertReference(movieId, providerId, 'dev:timeout:title');
  const timed = Date.now();
  await assert.rejects(
    () => resolveMovieDownload(slug, { enabledSlugs: ['development-errors'], timeoutMs: 20 }),
    (error) => error.code === 'PROVIDER_TIMEOUT',
  );
  assert.ok(Date.now() - timed < 1000);

  const unknown = await request(app).post('/api/v1/movies/not-a-real-film/download').set(csrf).send({});
  const injected = await request(app)
    .post('/api/v1/movies/nosferatu/download')
    .set(csrf)
    .send({ url: 'http://169.254.169.254/latest/meta-data' });
  assert.equal(unknown.status, 404);
  assert.equal(injected.status, 400);
  assert.equal(JSON.stringify(injected.body).includes('169.254.169.254'), false);
});

test('download resolution requests can be limited without blocking a normal request', async () => {
  const limited = express();
  limited.get('/download', createRateLimiter({
    windowMs: 60_000,
    limit: 2,
    skip: () => false,
    message: { error: { code: 'RATE_LIMITED', message: 'Too many download requests' } },
  }), (_req, res) => res.json({ ok: true }));

  const first = await request(limited).get('/download');
  const second = await request(limited).get('/download');
  const third = await request(limited).get('/download');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(third.status, 429);
  assert.equal(third.body.error.code, 'RATE_LIMITED');
});

test('public resolution stays on an authorized local handoff', async () => {
  assert.equal(classifyMedia([{
    mediaType: 'stream',
    status: 'available',
    availability: 'available',
    rights: 'AUTHORIZED',
    providerStatus: 'active',
    health: 'available',
  }]).state, 'MEDIA_UNAVAILABLE');
  assert.equal(classifyMedia([{
    mediaType: 'download',
    status: 'pending',
    availability: 'unknown',
    rights: 'PENDING_REVIEW',
    providerStatus: 'active',
    health: 'unknown',
    metadata: { countries: ['not-a-country', 'NG'] },
  }]).state, 'REVIEW_REQUIRED');
  assert.deepEqual(classifyMedia([{
    mediaType: 'download',
    status: 'available',
    availability: 'available',
    rights: 'AUTHORIZED',
    providerStatus: 'active',
    health: 'available',
    metadata: { countries: ['US', 'NG'] },
  }]).countries, ['NG', 'US']);

  const movie = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(movie.body.data.mediaState.state, 'MEDIA_AVAILABLE');
  assert.equal(movie.body.data.mediaState.countries, null);
  assert.equal(JSON.stringify(movie.body).includes('dev:ok:'), false);

  const night = await request(app).get('/api/v1/movies/night-of-the-living-dead');
  assert.equal(night.body.data.mediaState.state, 'REVIEW_REQUIRED');

  const resolved = await request(app).post('/api/v1/media/resolve').set(csrf).send({ slug: 'nosferatu' });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.data.state, 'ready');
  assert.equal(resolved.body.data.resourceType, 'download');
  assert.equal(resolved.body.data.href.startsWith('/api/v1/media/handoff/'), true);
  assert.equal(JSON.stringify(resolved.body).includes('secret'), false);
  assert.equal(resolved.headers['cache-control'], 'no-store');

  const injected = await request(app).post('/api/v1/media/resolve').set(csrf).send({
    slug: 'nosferatu',
    url: 'https://evil.example/file',
  });
  assert.equal(injected.status, 400);
  assert.throws(() => assertApprovedDestination('https://evil.example/file', []));
  assert.throws(() => assertApprovedDestination('http://videos.example.com/a.mp4', ['videos.example.com']));

  const handoff = await request(app).get(resolved.body.data.href);
  assert.equal(handoff.status, 200);
  assert.match(handoff.headers['content-disposition'], /attachment/);
  assert.equal(handoff.text.includes('not a movie'), true);
});
