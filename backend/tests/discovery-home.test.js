import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { invalidateDiscoveryCache, resetDiscoveryCacheStats, discoveryCacheStats } from '../src/discovery/cache.js';
import { omitDuplicateMovieRails, rankRelated } from '../src/discovery/select.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const draftId = '15151515-1515-4515-8515-151515151599';
const stamp = `p22${Date.now().toString(36)}`;
const password = 'PhaseTwenty2';
const userIds = [];

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  await pool.query('DELETE FROM movies WHERE id = $1', [draftId]);
  for (const userId of userIds) {
    await pool.query('DELETE FROM user_recent_views WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await closePool();
  await closeRedis();
});

function cookieFrom(response) {
  return response.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
}

function percentile(values, portion) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(portion * sorted.length) - 1));
  return sorted[index];
}

test('duplicate rails are omitted and related scores stay explainable', () => {
  const featured = [{ slug: 'a' }, { slug: 'b' }];
  const copy = [{ slug: 'a' }, { slug: 'b' }];
  const other = [{ slug: 'b' }];
  const visible = omitDuplicateMovieRails([
    { kind: 'movies', source: 'featured', items: featured },
    { kind: 'movies', source: 'recent', items: copy },
    { kind: 'movies', source: 'featured', items: copy },
    { kind: 'movies', items: other },
    { kind: 'movies', items: [] },
  ]);
  assert.equal(visible.length, 3);
  assert.equal(visible[1].source, 'recent');
  const ranked = rankRelated(
    { slug: 'nosferatu', releaseYear: 1922, originalLanguage: { code: 'de' } },
    [
      { slug: 'nosferatu', sharedGenres: 2, releaseYear: 1922, originalLanguage: { code: 'de' } },
      { slug: 'caligari', sharedGenres: 1, releaseYear: 1920, originalLanguage: { code: 'de' } },
      { slug: 'same-country', sharedGenres: 0, sharedCountries: 1, releaseYear: 2001, originalLanguage: { code: 'en' } },
      { slug: 'unrelated', sharedGenres: 0, releaseYear: 2001, originalLanguage: { code: 'en' } },
    ],
    { collectionSlugs: ['caligari'] },
  );
  assert.deepEqual(ranked.map((item) => item.slug), ['caligari', 'same-country']);
});

test('the public homepage explains rails and keeps private history off the catalog', async () => {
  await getPool().query(
    `INSERT INTO movies (id, canonical_title, slug, status, adult)
     VALUES ($1, 'Draft Rail', 'draft-rail-phase-22', 'draft', FALSE)
     ON CONFLICT (id) DO NOTHING`,
    [draftId],
  );
  invalidateDiscoveryCache();
  const home = await request(app).get('/api/v1/discovery/home');
  assert.equal(home.status, 200);
  assert.match(home.headers['cache-control'], /public/);
  assert.equal(JSON.stringify(home.body).includes('draft-rail-phase-22'), false);
  assert.equal(JSON.stringify(home.body).includes('AI'), false);
  const rails = home.body.data.rails;
  assert.ok(rails.some((rail) => rail.source === 'featured' && rail.reason === 'Editorial ranking'));
  assert.equal(home.body.data.featured.slug, 'night-of-the-living-dead');
  assert.ok(rails.every((rail) => rail.kind !== 'movies' || rail.items.length > 0));
  const sequences = rails.filter((rail) => rail.kind === 'movies').map((rail) => `${rail.source}|${rail.items.map((item) => item.slug).join('|')}`);
  assert.equal(new Set(sequences).size, sequences.length);
  assert.ok(rails.some((rail) => rail.source === 'recent' && rail.reason === 'Newest published movies'));

  const related = await request(app).get('/api/v1/movies/nosferatu/related');
  assert.equal(related.status, 200);
  assert.equal(JSON.stringify(related.body).includes('"slug":"nosferatu"'), false);
  assert.equal(related.body.data[0].title, 'More like this');

  const anonymous = await request(app).get('/api/v1/me/continue').set(csrf);
  assert.equal(anonymous.status, 401);
  const denied = await request(app).get('/api/v1/admin/rails').set(csrf);
  assert.equal(denied.status, 401);

  const email = `${stamp}@beezmovies.local`;
  const otherEmail = `other-${stamp}@beezmovies.local`;
  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email, password, displayName: 'Phase Twenty Two',
  });
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  userIds.push(login.body.user.id);
  const cookie = cookieFrom(login);
  await request(app).post('/api/v1/me/recent/nosferatu').set(csrf).set('Cookie', cookie).send({});
  const mine = await request(app).get('/api/v1/me/continue').set(csrf).set('Cookie', cookie);
  assert.equal(mine.status, 200);
  assert.match(mine.body.data.title, /Because you viewed Nosferatu/);
  assert.equal(mine.headers['cache-control'], 'private, no-store');

  const other = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email: otherEmail, password, displayName: 'Other Twenty Two',
  });
  assert.equal(other.status, 201);
  const otherLogin = await request(app).post('/api/v1/auth/login').set(csrf).send({ email: otherEmail, password });
  userIds.push(otherLogin.body.user.id);
  const theirs = await request(app).get('/api/v1/me/continue').set(csrf).set('Cookie', cookieFrom(otherLogin));
  assert.equal(theirs.body.data, null);

  const admin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const adminCookie = cookieFrom(admin);
  const railsAdmin = await request(app).get('/api/v1/admin/rails').set(csrf).set('Cookie', adminCookie);
  assert.equal(railsAdmin.status, 200);
  const featuredRail = railsAdmin.body.data.find((rail) => rail.slug === 'featured');
  const renamed = await request(app).patch(`/api/v1/admin/rails/${featuredRail.id}`).set(csrf).set('Cookie', adminCookie).send({
    title: 'Editorial picks',
    enabled: true,
    sortOrder: featuredRail.sortOrder,
    itemLimit: featuredRail.itemLimit,
    confirm: true,
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.data.title, 'Editorial picks');
  const refreshed = await request(app).get('/api/v1/discovery/home');
  assert.equal(refreshed.body.data.rails.some((rail) => rail.title === 'Editorial picks'), true);
  await request(app).patch(`/api/v1/admin/rails/${featuredRail.id}`).set(csrf).set('Cookie', adminCookie).send({
    title: 'Featured',
    enabled: true,
    sortOrder: featuredRail.sortOrder,
    itemLimit: featuredRail.itemLimit,
    confirm: true,
  });

  resetDiscoveryCacheStats();
  const cold = [];
  const warm = [];
  for (let index = 0; index < 20; index += 1) {
    const started = Date.now();
    const response = await request(app).get('/api/v1/discovery/home');
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    (index === 0 ? cold : warm).push(elapsed);
  }
  const detail = [];
  for (let index = 0; index < 20; index += 1) {
    const started = Date.now();
    const response = await request(app).get('/api/v1/movies/nosferatu/related');
    detail.push(Date.now() - started);
    assert.equal(response.status, 200);
  }
  console.log([
    `home-cold p50=${percentile(cold, 0.5)}`,
    `home-warm p50=${percentile(warm, 0.5)} p95=${percentile(warm, 0.95)} p99=${percentile(warm, 0.99)}`,
    `related p50=${percentile(detail, 0.5)} p95=${percentile(detail, 0.95)} p99=${percentile(detail, 0.99)}`,
    `errors=0 cache=${JSON.stringify(discoveryCacheStats())}`,
  ].join(' | '));
});
