import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { flushAnalytics, pruneAnalytics, setAnalyticsWriter } from '../src/analytics/record.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p24${Date.now().toString(36)}`;
const zeroQuery = `zz${stamp}`;
let userId = null;

before(async () => {
  await seed();
});

after(async () => {
  setAnalyticsWriter();
  const pool = getPool();
  if (userId) {
    await pool.query('DELETE FROM user_watchlist WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_favorites WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await pool.query('DELETE FROM analytics_search_terms WHERE query_text = $1', [zeroQuery]);
  await pool.query(`DELETE FROM analytics_events WHERE created_at < NOW() - INTERVAL '15 days'`);
  await closePool();
  await closeRedis();
});

async function count(eventName, subject = null) {
  const rows = await getPool().query(
    `SELECT COALESCE(SUM(event_count), 0)::int AS count
     FROM analytics_daily
     WHERE event_name = $1 AND day = CURRENT_DATE
       AND ($2::text IS NULL OR subject_key = $2)`,
    [eventName, subject],
  );
  return rows.rows[0].count;
}

test('product analytics stay aggregated, authorized, and non-critical', async () => {
  const anonymous = await request(app).get('/api/v1/admin/analytics').set(csrf);
  assert.equal(anonymous.status, 401);

  const email = `${stamp}@beezmovies.local`;
  const password = 'PhaseTwentyFour1';
  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email, password, displayName: 'Phase Twenty Four',
  });
  assert.equal(registered.status, 201);
  userId = registered.body.user.id;
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  const userCookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const denied = await request(app).get('/api/v1/admin/analytics').set(csrf).set('Cookie', userCookie);
  assert.equal(denied.status, 403);

  const beforeViews = await count('PAGE_VIEW', 'home');
  const page = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'PAGE_VIEW', subject: 'home' }],
  });
  assert.equal(page.status, 202);
  await flushAnalytics();
  assert.equal(await count('PAGE_VIEW', 'home'), beforeViews + 1);

  const movie = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'MOVIE_VIEW', subject: 'nosferatu' }],
  });
  assert.equal(movie.status, 202);
  const trailer = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'TRAILER_PLAY', subject: 'nosferatu' }],
  });
  assert.equal(trailer.status, 202);
  const pwa = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'PWA_OPEN', subject: 'open' }],
  });
  assert.equal(pwa.status, 202);

  const found = await request(app).get('/api/v1/search').set(csrf).query({ q: 'nosferatu' });
  assert.equal(found.status, 200);
  const missing = await request(app).get('/api/v1/search').set(csrf).query({ q: zeroQuery });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.pagination.total, 0);
  const click = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'SEARCH_RESULT_CLICK', subject: 'nosferatu', query: 'nosferatu' }],
  });
  assert.equal(click.status, 202);

  const ready = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(ready.status, 200);
  const failed = await request(app).post('/api/v1/movies/night-of-the-living-dead/download').set(csrf).send({});
  assert.equal(failed.status, 409);
  const missingPage = await request(app).get('/api/v1/movies/not-a-real-title').set(csrf);
  assert.equal(missingPage.status, 404);

  const watch = await request(app).post('/api/v1/me/watchlist/nosferatu').set(csrf).set('Cookie', userCookie).send({});
  assert.equal(watch.status, 201);
  const favorite = await request(app).post('/api/v1/me/favorites/nosferatu').set(csrf).set('Cookie', userCookie).send({});
  assert.equal(favorite.status, 201);
  await flushAnalytics();

  const invalid = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'DOWNLOAD_RESOLVED', subject: 'nosferatu' }],
  });
  assert.equal(invalid.status, 400);
  const installsBefore = await count('PWA_INSTALL', 'install');
  const duplicateId = randomUUID();
  const first = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: duplicateId, name: 'PWA_INSTALL', subject: 'install' }],
  });
  const second = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: duplicateId, name: 'PWA_INSTALL', subject: 'install' }],
  });
  assert.equal(first.status, 202);
  assert.equal(second.status, 202);
  await flushAnalytics();
  assert.equal(await count('PWA_INSTALL', 'install'), installsBefore + 1);

  await flushAnalytics();
  const adminLogin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local', password: 'BeezLocalAdmin1',
  });
  const admin = adminLogin.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const report = await request(app).get('/api/v1/admin/analytics').set(csrf).set('Cookie', admin).query({ period: '7d' });
  assert.equal(report.status, 200);
  assert.equal(report.body.data.period.key, '7d');
  assert.ok(report.body.data.movies.some((row) => row.slug === 'nosferatu' && row.resolved >= 1 && row.trailers >= 1));
  assert.equal(report.body.data.downloads.resolved >= 1, true);
  assert.equal(report.body.data.downloads.failed >= 1, true);
  assert.equal(report.body.data.search.zeroQueries.some((row) => row.query === zeroQuery), true);
  assert.equal(report.body.data.pwa.opens >= 1, true);
  assert.ok(report.body.data.performance.download.samples >= 1);
  assert.ok(report.body.data.performance.download.p50 >= 0);
  assert.equal(report.body.data.errors.some((row) => row.status === 404), true);
  assert.equal(JSON.stringify(report.body).includes('password'), false);
  assert.equal(JSON.stringify(report.body).includes(email), false);
  assert.equal(JSON.stringify(report.body).includes('visitor'), false);

  const providers = await request(app).get('/api/v1/admin/analytics/providers').set(csrf).set('Cookie', admin);
  assert.equal(providers.status, 200);
  const media = providers.body.data.providers.find((row) => row.slug === 'development-media');
  assert.equal(media.resolved >= 1, true);
  assert.equal(JSON.stringify(providers.body).includes('beezmovies-local-handoff'), false);

  const exported = await request(app).get('/api/v1/admin/analytics/export').set(csrf).set('Cookie', admin);
  assert.equal(exported.status, 200);
  assert.match(exported.headers['content-type'], /text\/csv/);
  assert.match(exported.text, /MOVIE_VIEW/);
  assert.equal(exported.text.includes(email), false);

  const oldId = randomUUID();
  await getPool().query(
    `INSERT INTO analytics_events (id, event_name, subject_key, created_at)
     VALUES ($1, 'PAGE_VIEW', 'home', NOW() - INTERVAL '20 days')`,
    [oldId],
  );
  await getPool().query(
    `INSERT INTO analytics_daily (day, event_name, subject_key, event_count)
     VALUES (CURRENT_DATE - 500, 'PAGE_VIEW', 'expired-metric', 1)`,
  );
  await getPool().query(
    `INSERT INTO analytics_search_terms (day, query_text, search_count)
     VALUES (CURRENT_DATE - 40, $1, 1)`,
    [`old${stamp}`],
  );
  await pruneAnalytics();
  const raw = await getPool().query('SELECT 1 FROM analytics_events WHERE id = $1', [oldId]);
  const daily = await getPool().query(`SELECT 1 FROM analytics_daily WHERE subject_key = 'expired-metric'`);
  const term = await getPool().query('SELECT 1 FROM analytics_search_terms WHERE query_text = $1', [`old${stamp}`]);
  assert.equal(raw.rowCount, 0);
  assert.equal(daily.rowCount, 0);
  assert.equal(term.rowCount, 0);

  setAnalyticsWriter(async () => {
    throw new Error('analytics down');
  });
  const stillThere = await request(app).get('/api/v1/movies/nosferatu').set(csrf);
  assert.equal(stillThere.status, 200);
  const skipped = await request(app).post('/api/v1/analytics/events').set(csrf).send({
    events: [{ id: randomUUID(), name: 'PAGE_VIEW', subject: 'home' }],
  });
  assert.equal(skipped.status, 202);
  assert.equal(skipped.body.data.unavailable, true);
  setAnalyticsWriter();
});
