const api = 'http://localhost:5000/api/v1';
const header = { 'x-beezmovies-request': '1', 'content-type': 'application/json' };

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function noSecrets(body) {
  const text = JSON.stringify(body);
  assert(!/password_hash|stack|MEDIA_HANDOFF|postgres:\/\//i.test(text), 'response exposed internal detail');
}

async function json(path, options = {}) {
  const response = await fetch(`${api}${path}`, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text.slice(0, 120) }; }
  return { status: response.status, body, headers: response.headers };
}

if (process.argv.includes('--db-down')) {
  process.env.DATABASE_URL = 'postgresql://beezmovies:beezmovies_local@127.0.0.1:1/beezmovies_absent';
  process.env.NODE_ENV = 'test';
  process.env.REDIS_URL = '';
  const { createApp } = await import('../src/app.js');
  const request = (await import('supertest')).default;
  const { closePool } = await import('../src/db/pool.js');
  const { closeRedis } = await import('../src/redis/client.js');
  const app = createApp();
  const health = await request(app).get('/api/v1/health');
  const ready = await request(app).get('/api/v1/ready');
  assert(health.status === 200, 'liveness should survive a closed database');
  assert(ready.status === 503, 'readiness should fail when Postgres is closed');
  assert(ready.body.checks?.postgres?.status === 'unavailable', 'postgres check should be unavailable');
  noSecrets(ready.body);
  await closePool();
  await closeRedis();
  console.log('database-unavailable=503 health-still-alive=200');
  process.exit(0);
}

const health = await json('/health');
assert(health.status === 200 && health.body.release === undefined, 'public health leaked release metadata');
const ready = await json('/ready');
assert(ready.status === 200 && ready.body.checks.postgres.status === 'ok', 'live readiness failed');

const missing = await json('/movies/not-a-real-movie');
assert(missing.status === 404, 'invalid movie was not a 404');
noSecrets(missing.body);

const proxy = await json('/movies/nosferatu/download', {
  method: 'POST',
  headers: header,
  body: JSON.stringify({ url: 'http://127.0.0.1/secret' }),
});
assert(proxy.status === 400, 'arbitrary download URL was not rejected');
noSecrets(proxy.body);

const handoff = await json('/media/handoff/not-a-token');
assert(handoff.status >= 400 && handoff.status < 500, 'malformed handoff was not rejected');
noSecrets(handoff.body);

const unavailable = await json('/movies/night-of-the-living-dead/download', {
  method: 'POST',
  headers: header,
  body: '{}',
});
assert(unavailable.status >= 400 && unavailable.status < 500, 'title without media did not fail cleanly');
noSecrets(unavailable.body);

const injection = await json(`/search?q=${encodeURIComponent("' OR 1=1; DROP TABLE movies;--")}`);
assert(injection.status === 200 || injection.status === 400, 'search injection was not contained');
noSecrets(injection.body);

const admin = await json('/admin/system', { headers: header });
assert(admin.status === 401, 'anonymous admin system access was allowed');

const ads = await json('/monetization/config');
assert(ads.status === 200 && Array.isArray(ads.body.data?.placements), 'ad config failed closed');

const oversized = await fetch(`${api}/auth/login`, {
  method: 'POST',
  headers: header,
  body: `{"email":"${'a'.repeat(1_200_000)}"}`,
});
assert(oversized.status === 413, 'oversized body was not rejected');

async function sample(path) {
  const times = [];
  for (let i = 0; i < 15; i += 1) {
    const started = performance.now();
    const response = await fetch(`${api}${path}`);
    await response.arrayBuffer();
    times.push(performance.now() - started);
    assert(response.status === 200, `${path} returned ${response.status}`);
  }
  times.sort((a, b) => a - b);
  const at = (ratio) => Math.round(times[Math.min(times.length - 1, Math.ceil(times.length * ratio) - 1)]);
  return { p50: at(0.5), p95: at(0.95) };
}

const movies = await sample('/movies');
const detail = await sample('/movies/nosferatu');
const search = await sample('/search?q=nosferatu');
console.log(`invalid-movie=404 arbitrary-url=400 handoff-rejected=${handoff.status} provider-gap=${unavailable.status} search-contained=${injection.status} admin-anonymous=401 ads=${ads.body.data.placements.length} oversized=413`);
console.log(`movies p50=${movies.p50}ms p95=${movies.p95}ms detail p50=${detail.p50}ms p95=${detail.p95}ms search p50=${search.p50}ms p95=${search.p95}ms`);
