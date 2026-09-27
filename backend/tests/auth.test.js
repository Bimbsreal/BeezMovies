import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { sessionCookieOptions } from '../src/auth/cookies.js';
import { PASSWORD_HASH_PARAMS } from '../src/auth/constants.js';
import { hashSecret } from '../src/auth/tokens.js';
import { migrate } from '../src/db/migrate.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { createAuthAttemptLimiter } from '../src/middleware/rate-limit.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const password = 'CorrectHorse1';

before(async () => {
  await migrate();
});

after(async () => {
  await closePool();
  await closeRedis();
});

function emailAddress() {
  return `ada.${randomUUID()}@example.com`;
}

function cookiePair(response) {
  const lines = response.headers['set-cookie'] || [];
  const line = lines.find((item) => item.startsWith('beezmovies_session='));
  assert.ok(line, 'session cookie was not set');
  return line.split(';')[0];
}

function sessionToken(response) {
  return cookiePair(response).slice('beezmovies_session='.length);
}

test('registration creates a pending account without returning the password', async () => {
  const email = emailAddress();
  const response = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });

  assert.equal(response.status, 201);
  assert.equal(response.body.user.email, email);
  assert.equal(response.body.user.accountStatus, 'pending_verification');
  assert.equal(response.body.user.emailVerified, false);
  assert.equal(response.body.user.role, 'user');
  assert.equal(response.body.user.passwordHash, undefined);
  assert.equal(JSON.stringify(response.body).includes(password), false);
  assert.ok(response.body.developmentOnly.emailVerificationToken);

  const verified = await request(app)
    .post('/api/v1/auth/verify-email')
    .set(csrf)
    .send({ token: response.body.developmentOnly.emailVerificationToken });

  assert.equal(verified.status, 200);
  assert.equal(verified.body.user.accountStatus, 'active');
  assert.equal(verified.body.user.emailVerified, true);
  assert.equal(JSON.stringify(verified.body).includes(password), false);

  const reused = await request(app)
    .post('/api/v1/auth/verify-email')
    .set(csrf)
    .send({ token: response.body.developmentOnly.emailVerificationToken });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, 'TOKEN_USED');
});

test('duplicate registration is rejected for the normalized email', async () => {
  const email = emailAddress();
  const first = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email: email.toUpperCase(), password, displayName: 'Ada Lovelace' });
  const second = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, 'ACCOUNT_EXISTS');
  assert.equal(JSON.stringify(second.body).includes(password), false);
});

test('invalid registration is rejected', async () => {
  const response = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email: 'not-an-email', password: 'short', displayName: '' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(JSON.stringify(response.body).includes('short'), false);
});

test('passwords are stored as Argon2id and never as plaintext', async () => {
  const email = emailAddress();
  const response = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  assert.equal(response.status, 201);

  const stored = await getPool().query(
    `SELECT password_hash FROM users WHERE normalized_email = $1`,
    [email],
  );
  const hash = stored.rows[0].password_hash;
  assert.match(hash, /^\$argon2id\$/);
  assert.match(hash, new RegExp(`m=${PASSWORD_HASH_PARAMS.memoryCost},t=${PASSWORD_HASH_PARAMS.timeCost},p=${PASSWORD_HASH_PARAMS.parallelism}`));
  assert.equal(hash.includes(password), false);

  const events = await getPool().query(
    `SELECT metadata::text AS metadata FROM auth_events WHERE user_id = $1`,
    [response.body.user.id],
  );
  assert.ok(events.rowCount > 0);
  for (const row of events.rows) {
    assert.equal(row.metadata.includes(password), false);
    assert.equal(row.metadata.includes(hash), false);
  }
});

test('login creates a hashed session and an HttpOnly cookie', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });

  const response = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });

  assert.equal(response.status, 200);
  assert.equal(response.body.user.email, email);
  assert.equal(response.body.session.token, undefined);
  assert.equal(JSON.stringify(response.body).includes(password), false);
  assert.equal(JSON.stringify(response.body).includes('argon2'), false);
  assert.match(response.headers['cache-control'], /no-store/);

  const cookie = response.headers['set-cookie'].join(';');
  const token = sessionToken(response);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /SameSite=Lax/i);
  assert.match(cookie, /Path=\//);
  assert.doesNotMatch(cookie, /Secure/i);
  assert.equal(JSON.stringify(response.body).includes(token), false);

  const stored = await getPool().query(
    `SELECT token_hash, revoked_at FROM sessions WHERE id = $1`,
    [response.body.session.id],
  );
  assert.equal(stored.rows[0].token_hash, hashSecret(token));
  assert.notEqual(stored.rows[0].token_hash, token);
  assert.equal(stored.rows[0].revoked_at, null);

  const seen = await getPool().query(
    'SELECT last_login_at FROM users WHERE id = $1',
    [response.body.user.id],
  );
  assert.ok(seen.rows[0].last_login_at);
});

test('login failure does not reveal whether the email exists', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });

  const wrong = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password: 'WrongPassword1' });
  const missing = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email: emailAddress(), password });

  assert.equal(wrong.status, 401);
  assert.equal(missing.status, 401);
  assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
  assert.equal(missing.body.error.code, wrong.body.error.code);
  assert.equal(missing.body.error.message, wrong.body.error.message);
  assert.equal(wrong.headers['set-cookie'], undefined);
  assert.equal(JSON.stringify(wrong.body).includes(password), false);
});

test('a suspended account cannot authenticate', async () => {
  const email = emailAddress();
  const registered = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });
  assert.equal(login.status, 200);

  await getPool().query(
    `UPDATE users SET account_status = 'suspended' WHERE id = $1`,
    [registered.body.user.id],
  );

  const denied = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'ACCOUNT_UNAVAILABLE');
  assert.equal(denied.headers['set-cookie'], undefined);

  const current = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', cookiePair(login));
  assert.equal(current.status, 403);
  assert.equal(current.body.error.code, 'ACCOUNT_UNAVAILABLE');
});

test('the current user endpoint returns a safe profile and rejects anonymous requests', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });

  const anonymous = await request(app).get('/api/v1/auth/me');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.error.code, 'UNAUTHENTICATED');

  const current = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', cookiePair(login));
  assert.equal(current.status, 200);
  assert.equal(current.body.user.email, email);
  assert.equal(current.body.user.displayName, 'Ada Lovelace');
  assert.equal(current.body.user.role, 'user');
  assert.equal(current.body.session.id, login.body.session.id);
  assert.equal(current.body.user.passwordHash, undefined);
  assert.match(current.headers['cache-control'], /no-store/);
  assert.equal(JSON.stringify(current.body).includes(password), false);
  assert.equal(JSON.stringify(current.body).includes(sessionToken(login)), false);
});

test('logout revokes the current session and clears the cookie', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  const agent = request.agent(app);
  const login = await agent.post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(login.status, 200);
  const saved = cookiePair(login);

  const logout = await agent.post('/api/v1/auth/logout').set(csrf);
  assert.equal(logout.status, 200);
  assert.equal(logout.body.status, 'ok');
  assert.match(logout.headers['set-cookie'].join(';'), /beezmovies_session=;/);

  const afterLogout = await agent.get('/api/v1/auth/me');
  assert.equal(afterLogout.status, 401);

  const replay = await request(app).get('/api/v1/auth/me').set('Cookie', saved);
  assert.equal(replay.status, 401);
  assert.equal(replay.body.error.code, 'SESSION_REVOKED');
});

test('a session can be revoked and an expired session is rejected', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  const first = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  const second = await request(app).post('/api/v1/auth/login').set(csrf).send({ email, password });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const revoked = await request(app)
    .post(`/api/v1/auth/sessions/${second.body.session.id}/revoke`)
    .set(csrf)
    .set('Cookie', cookiePair(first));
  assert.equal(revoked.status, 200);

  const secondMe = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', cookiePair(second));
  assert.equal(secondMe.status, 401);
  assert.equal(secondMe.body.error.code, 'SESSION_REVOKED');

  await getPool().query(
    `UPDATE sessions
     SET created_at = NOW() - INTERVAL '2 minutes',
         expires_at = NOW() - INTERVAL '1 minute'
     WHERE id = $1`,
    [first.body.session.id],
  );
  const expired = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', cookiePair(first));
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'SESSION_EXPIRED');

  const replacement = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });
  const all = await request(app)
    .post('/api/v1/auth/sessions/revoke-all')
    .set(csrf)
    .set('Cookie', cookiePair(replacement));
  assert.equal(all.status, 200);
  const afterAll = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', cookiePair(replacement));
  assert.equal(afterAll.status, 401);
  assert.equal(afterAll.body.error.code, 'SESSION_REVOKED');
});

test('password reset tokens expire and cannot be reused', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });

  const missing = await request(app)
    .post('/api/v1/auth/forgot-password')
    .set(csrf)
    .send({ email: emailAddress() });
  assert.equal(missing.status, 200);
  assert.equal(missing.body.status, 'ok');
  assert.equal(missing.body.developmentOnly, undefined);

  const issued = await request(app)
    .post('/api/v1/auth/forgot-password')
    .set(csrf)
    .send({ email });
  assert.equal(issued.status, 200);
  const expiredToken = issued.body.developmentOnly.passwordResetToken;
  assert.ok(expiredToken);
  assert.equal(JSON.stringify(issued.body).includes(password), false);

  await getPool().query(
    `UPDATE password_reset_tokens
     SET created_at = NOW() - INTERVAL '2 minutes',
         expires_at = NOW() - INTERVAL '1 minute'
     WHERE token_hash = $1`,
    [hashSecret(expiredToken)],
  );
  const expired = await request(app)
    .post('/api/v1/auth/reset-password')
    .set(csrf)
    .send({ token: expiredToken, password: 'Replacement2' });
  assert.equal(expired.status, 400);
  assert.equal(expired.body.error.code, 'TOKEN_EXPIRED');

  const reissued = await request(app)
    .post('/api/v1/auth/forgot-password')
    .set(csrf)
    .send({ email });
  const token = reissued.body.developmentOnly.passwordResetToken;
  const reset = await request(app)
    .post('/api/v1/auth/reset-password')
    .set(csrf)
    .send({ token, password: 'Replacement2' });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.status, 'ok');
  assert.equal(JSON.stringify(reset.body).includes('Replacement2'), false);

  const reused = await request(app)
    .post('/api/v1/auth/reset-password')
    .set(csrf)
    .send({ token, password: 'Replacement3' });
  assert.equal(reused.status, 400);
  assert.equal(reused.body.error.code, 'TOKEN_USED');

  const oldSession = await request(app)
    .get('/api/v1/auth/me')
    .set('Cookie', cookiePair(login));
  assert.equal(oldSession.status, 401);
  assert.equal(oldSession.body.error.code, 'SESSION_REVOKED');

  const oldPassword = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });
  assert.equal(oldPassword.status, 401);

  const nextLogin = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password: 'Replacement2' });
  assert.equal(nextLogin.status, 200);
});

test('production password reset responses omit the development token', async () => {
  const email = emailAddress();
  await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });

  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .set(csrf)
      .send({ email });
    assert.equal(response.status, 200);
    assert.equal(response.body.developmentOnly, undefined);
    assert.equal(JSON.stringify(response.body).includes('passwordResetToken'), false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('admin identity is granted only to the admin permission', async () => {
  const email = emailAddress();
  const registered = await request(app)
    .post('/api/v1/auth/register')
    .set(csrf)
    .send({ email, password, displayName: 'Ada Lovelace' });
  const login = await request(app)
    .post('/api/v1/auth/login')
    .set(csrf)
    .send({ email, password });
  const cookie = cookiePair(login);

  const denied = await request(app).get('/api/v1/admin/me').set('Cookie', cookie);
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, 'FORBIDDEN');
  assert.match(denied.headers['cache-control'], /no-store/);

  await getPool().query(
    `INSERT INTO user_roles (user_id, role_id)
     SELECT $1, id FROM roles WHERE slug = 'admin'
     ON CONFLICT DO NOTHING`,
    [registered.body.user.id],
  );

  const allowed = await request(app).get('/api/v1/admin/me').set('Cookie', cookie);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.user.role, 'admin');
  assert.equal(allowed.body.user.email, email);
  assert.equal(allowed.body.user.passwordHash, undefined);
  assert.equal(JSON.stringify(allowed.body).includes(password), false);
  assert.equal(JSON.stringify(allowed.body).includes('argon2'), false);
});

test('unsafe requests without the browser header are rejected', async () => {
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: emailAddress(), password });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'CSRF_REJECTED');
});

test('authentication attempts are rate limited', async () => {
  const limited = express();
  limited.use(express.json());
  limited.use(createAuthAttemptLimiter({
    windowMs: 60_000,
    limit: 1,
    skip: () => false,
  }));
  limited.post('/api/v1/auth/login', (_req, res) => {
    res.json({ ok: true });
  });

  const first = await request(limited).post('/api/v1/auth/login').send({});
  const second = await request(limited).post('/api/v1/auth/login').send({});
  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'RATE_LIMITED');
  assert.equal(second.body.error.message, 'Too many authentication attempts');
});

test('production session cookies are marked Secure', () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const options = sessionCookieOptions();
    assert.equal(options.httpOnly, true);
    assert.equal(options.secure, true);
    assert.equal(options.sameSite, 'lax');
    assert.equal(options.path, '/');
  } finally {
    process.env.NODE_ENV = previous;
  }
});
