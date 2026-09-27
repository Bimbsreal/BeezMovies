import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p20${Date.now().toString(36)}`;
const password = 'PhaseTwenty1';
let userId = null;

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  if (userId) {
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

test('a private library stays off the public catalog and anonymous download still works', async () => {
  const anonymousList = await request(app).get('/api/v1/me/watchlist').set(csrf);
  assert.equal(anonymousList.status, 401);

  const home = await request(app).get('/api/v1/movies');
  assert.equal(home.status, 200);
  assert.match(home.headers['cache-control'], /public/);

  const download = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(download.status, 200);

  const email = `${stamp}@beezmovies.local`;
  const registered = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email,
    password,
    displayName: 'Phase Twenty',
  });
  assert.equal(registered.status, 201);
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(login.status, 200);
  const cookie = cookieFrom(login);
  userId = login.body.user.id;

  const other = await request(app).post('/api/v1/auth/register').set(csrf).send({
    email: `other-${stamp}@beezmovies.local`,
    password,
    displayName: 'Other Twenty',
  });
  assert.equal(other.status, 201);
  const otherLogin = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: `other-${stamp}@beezmovies.local`,
    password,
  });
  const otherId = otherLogin.body.user.id;
  const otherCookie = cookieFrom(otherLogin);

  const added = await request(app).post('/api/v1/me/watchlist/nosferatu').set(csrf).set('Cookie', cookie).send({});
  assert.equal(added.status, 201);
  const again = await request(app).post('/api/v1/me/watchlist/nosferatu').set(csrf).set('Cookie', cookie).send({});
  assert.equal(again.status, 201);
  assert.equal(again.body.data.created, false);
  const mine = await request(app).get('/api/v1/me/watchlist').set(csrf).set('Cookie', cookie);
  assert.equal(mine.status, 200);
  assert.equal(mine.headers['cache-control'], 'private, no-store');
  assert.equal(mine.body.data.length, 1);
  const theirs = await request(app).get('/api/v1/me/watchlist').set(csrf).set('Cookie', otherCookie);
  assert.equal(theirs.body.data.length, 0);

  const favorite = await request(app).post('/api/v1/me/favorites/nosferatu').set(csrf).set('Cookie', cookie).send({});
  assert.equal(favorite.status, 201);
  const favoriteAgain = await request(app).post('/api/v1/me/favorites/nosferatu').set(csrf).set('Cookie', cookie).send({});
  assert.equal(favoriteAgain.body.data.created, false);

  const viewed = await request(app).post('/api/v1/me/recent/the-cabinet-of-dr-caligari').set(csrf).set('Cookie', cookie).send({});
  assert.equal(viewed.status, 201);
  const suggestions = await request(app).get('/api/v1/me/suggestions').set(csrf).set('Cookie', cookie);
  assert.equal(suggestions.status, 200);
  if (suggestions.body.data) {
    assert.equal(typeof suggestions.body.data.genre.name, 'string');
    assert.equal(suggestions.body.data.movies.some((movie) => movie.slug === 'nosferatu'), false);
  }

  const prefs = await request(app).put('/api/v1/me/preferences').set(csrf).set('Cookie', cookie).send({ genreSlugs: ['horror'] });
  assert.equal(prefs.status, 200);
  assert.deepEqual(prefs.body.data.genreSlugs, ['horror']);

  const cleared = await request(app).delete('/api/v1/me/recent').set(csrf).set('Cookie', cookie);
  assert.equal(cleared.status, 200);
  const recent = await request(app).get('/api/v1/me/recent').set(csrf).set('Cookie', cookie);
  assert.equal(recent.body.data.length, 0);

  const removed = await request(app).delete('/api/v1/me/watchlist/nosferatu').set(csrf).set('Cookie', otherCookie);
  assert.equal(removed.status, 404);
  const still = await request(app).get('/api/v1/me/watchlist').set(csrf).set('Cookie', cookie);
  assert.equal(still.body.data.length, 1);

  const deleted = await request(app).post('/api/v1/auth/account/delete').set(csrf).set('Cookie', cookie).send({
    password,
    confirm: true,
  });
  assert.equal(deleted.status, 200);
  const gone = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(gone.status, 401);
  const stillPublic = await request(app).get('/api/v1/movies/nosferatu');
  assert.equal(stillPublic.status, 200);

  const pool = getPool();
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [otherId]);
  await pool.query('DELETE FROM auth_events WHERE user_id = $1', [otherId]);
  await pool.query('DELETE FROM user_roles WHERE user_id = $1', [otherId]);
  await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [otherId]);
  await pool.query('DELETE FROM users WHERE id = $1', [otherId]);
});
