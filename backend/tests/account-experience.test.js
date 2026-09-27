import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p38${Date.now().toString(36)}`;
const password = 'PhaseThirtyEight1';
const userIds = [];

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  for (const userId of userIds) {
    await pool.query('DELETE FROM user_watchlist WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_favorites WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_recent_views WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_preferences WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM auth_events WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
  }
  await closePool();
  await closeRedis();
});

function cookieFrom(response) {
  return response.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
}

test('optional accounts keep private lists, saved countries, and playback honesty', async () => {
  const download = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(download.status, 200);

  const missing = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: `missing-${stamp}@beezmovies.local`,
    password,
  });
  const wrong = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'not-the-password',
  });
  assert.equal(missing.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(missing.body.error.message, wrong.body.error.message);

  async function account(name) {
    const email = `${name}-${stamp}@beezmovies.local`;
    const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
      email,
      password,
      displayName: name,
    });
    assert.equal(registered.status, 201);
    const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
    assert.equal(login.status, 200);
    userIds.push(login.body.user.id);
    return cookieFrom(login);
  }

  const owner = await account('owner');
  const other = await account('other');

  const progress = await request(app).get('/api/v1/me/progress').set(csrf).set('Cookie', owner);
  assert.equal(progress.status, 200);
  assert.equal(progress.body.data.stored, false);
  assert.deepEqual(progress.body.data.items, []);
  assert.match(progress.headers['cache-control'], /private/);

  const saved = await request(app).put('/api/v1/me/preferences').set(csrf).set('Cookie', owner).send({
    genreSlugs: ['horror'],
    countrySlugs: ['germany'],
  });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.data.countrySlugs, ['germany']);

  const picks = await request(app).get('/api/v1/me/country-picks').set(csrf).set('Cookie', owner);
  assert.equal(picks.status, 200);
  const slugs = picks.body.data.movies.map((movie) => movie.slug).sort();
  assert.deepEqual(slugs, ['nosferatu', 'the-cabinet-of-dr-caligari']);

  const otherPicks = await request(app).get('/api/v1/me/country-picks').set(csrf).set('Cookie', other);
  assert.equal(otherPicks.body.data, null);

  await request(app).post('/api/v1/me/recent/nosferatu').set(csrf).set('Cookie', owner).send({});
  await request(app).post('/api/v1/me/recent/night-of-the-living-dead').set(csrf).set('Cookie', owner).send({});
  const removed = await request(app).delete('/api/v1/me/recent/nosferatu').set(csrf).set('Cookie', owner);
  assert.equal(removed.status, 200);
  const history = await request(app).get('/api/v1/me/recent').set(csrf).set('Cookie', owner);
  assert.deepEqual(history.body.data.map((movie) => movie.slug), ['night-of-the-living-dead']);
  const otherHistory = await request(app).get('/api/v1/me/recent').set(csrf).set('Cookie', other);
  assert.equal(otherHistory.body.data.length, 0);

  const sessions = await request(app).get('/api/v1/auth/sessions').set(csrf).set('Cookie', owner);
  assert.equal(sessions.status, 200);
  assert.equal(JSON.stringify(sessions.body).includes('token'), false);
  assert.equal(sessions.body.data.some((session) => session.current), true);
  const foreign = await request(app).post(`/api/v1/auth/sessions/${sessions.body.data[0].id}/revoke`).set(csrf).set('Cookie', other).send({});
  assert.equal(foreign.status, 404);
});
