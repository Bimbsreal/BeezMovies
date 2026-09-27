import { AppError } from '../errors/app-error.js';
import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import {
  AUTHENTICATABLE_STATUSES,
  EMAIL_VERIFICATION_TTL_MS,
  PASSWORD_RESET_TTL_MS,
  SESSION_TOUCH_INTERVAL_MS,
  SESSION_TTL_MS,
} from './constants.js';
import { recordAuthEvent } from './events.js';
import { hashPassword, verifyMissingPassword, verifyPassword } from './passwords.js';
import { toPublicUser } from './presenter.js';
import { createSecret, hashSecret, normalizeEmail } from './tokens.js';
import { eraseLibrary } from '../library/service.js';

const INVALID_CREDENTIALS = () => new AppError('Email or password is incorrect', {
  status: 401,
  code: 'INVALID_CREDENTIALS',
});

const ACCOUNT_UNAVAILABLE = () => new AppError('This account cannot sign in', {
  status: 403,
  code: 'ACCOUNT_UNAVAILABLE',
});

function tokenError(kind, state) {
  const subject = kind === 'reset' ? 'reset link' : 'verification link';
  if (state === 'used') {
    return new AppError(`This ${subject} has already been used`, {
      status: 400,
      code: 'TOKEN_USED',
    });
  }
  if (state === 'expired') {
    return new AppError(`This ${subject} has expired`, {
      status: 400,
      code: 'TOKEN_EXPIRED',
    });
  }
  return new AppError(`This ${subject} is not valid`, {
    status: 400,
    code: 'TOKEN_INVALID',
  });
}

function sessionFailure(state) {
  if (state === 'expired') {
    return new AppError('The session has expired', {
      status: 401,
      code: 'SESSION_EXPIRED',
    });
  }
  if (state === 'revoked') {
    return new AppError('The session is no longer valid', {
      status: 401,
      code: 'SESSION_REVOKED',
    });
  }
  if (state === 'unavailable') {
    return ACCOUNT_UNAVAILABLE();
  }
  return new AppError('Authentication is required', {
    status: 401,
    code: 'UNAUTHENTICATED',
  });
}

async function loadPublicUser(client, userId) {
  const result = await client.query(
    `SELECT
       u.id,
       u.email,
       u.display_name,
       u.username,
       u.account_status,
       u.email_verified_at,
       COALESCE(array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL), ARRAY[]::text[]) AS roles
     FROM users u
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     WHERE u.id = $1 AND u.deleted_at IS NULL
     GROUP BY u.id`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return toPublicUser(row, row.roles);
}

async function issueEmailVerification(client, userId) {
  await client.query(
    `UPDATE email_verification_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  const secret = createSecret();
  await client.query(
    `INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashSecret(secret), new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)],
  );
  return secret;
}

async function issuePasswordReset(client, userId) {
  await client.query(
    `UPDATE password_reset_tokens
     SET used_at = NOW()
     WHERE user_id = $1 AND used_at IS NULL`,
    [userId],
  );
  const secret = createSecret();
  await client.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, hashSecret(secret), new Date(Date.now() + PASSWORD_RESET_TTL_MS)],
  );
  return secret;
}

const TOKEN_TABLES = {
  password_reset_tokens: 'password_reset_tokens',
  email_verification_tokens: 'email_verification_tokens',
};

async function lockToken(client, table, token) {
  const relation = TOKEN_TABLES[table];
  if (!relation) throw new Error('Unknown token table');
  const result = await client.query(
    `SELECT id, user_id, expires_at, used_at
     FROM ${relation}
     WHERE token_hash = $1
     FOR UPDATE`,
    [hashSecret(token)],
  );
  return result.rows[0] || null;
}

function classifyToken(row) {
  if (!row) return 'invalid';
  if (row.used_at) return 'used';
  if (new Date(row.expires_at).getTime() <= Date.now()) return 'expired';
  return 'ok';
}

export async function registerAccount({
  email,
  password,
  displayName,
  username = null,
  ip,
  userAgent,
}) {
  const passwordHash = await hashPassword(password);
  const normalizedEmail = normalizeEmail(email);

  try {
    return await withTransaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO users (
           email, normalized_email, password_hash, display_name, username, account_status
         ) VALUES ($1, $2, $3, $4, $5, 'pending_verification')
         RETURNING id`,
        [email.trim(), normalizedEmail, passwordHash, displayName.trim(), username || null],
      );
      const userId = inserted.rows[0].id;
      const role = await client.query(
        `INSERT INTO user_roles (user_id, role_id)
         SELECT $1, id FROM roles WHERE slug = 'user'
         RETURNING user_id`,
        [userId],
      );
      if (!role.rows[0]) {
        throw new Error('The user role is not configured');
      }

      const verificationToken = await issueEmailVerification(client, userId);
      await recordAuthEvent(client, {
        userId,
        eventType: 'registration',
        ip,
        userAgent,
        metadata: {},
      });
      await recordAuthEvent(client, {
        userId,
        eventType: 'email_verification_sent',
        ip,
        userAgent,
        metadata: {},
      });

      const user = await loadPublicUser(client, userId);
      return { user, verificationToken };
    });
  } catch (error) {
    if (error.code === '23505' && error.constraint === 'users_username_active_uidx') {
      throw new AppError('That username is not available', {
        status: 409,
        code: 'USERNAME_TAKEN',
      });
    }
    if (error.code === '23505') {
      throw new AppError('An account with that email already exists', {
        status: 409,
        code: 'ACCOUNT_EXISTS',
      });
    }
    throw error;
  }
}

export async function loginAccount({
  email,
  password,
  ip,
  userAgent,
}) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await getPool().query(
    `SELECT id, password_hash, account_status
     FROM users
     WHERE normalized_email = $1 AND deleted_at IS NULL`,
    [normalizedEmail],
  );
  const account = existing.rows[0];

  if (!account) {
    await verifyMissingPassword(password);
    await withTransaction((client) => recordAuthEvent(client, {
      eventType: 'login_failure',
      ip,
      userAgent,
      metadata: { reason: 'invalid_credentials' },
    }));
    throw INVALID_CREDENTIALS();
  }

  const matches = await verifyPassword(account.password_hash, password);
  if (!matches) {
    await withTransaction((client) => recordAuthEvent(client, {
      userId: account.id,
      eventType: 'login_failure',
      ip,
      userAgent,
      metadata: { reason: 'invalid_credentials' },
    }));
    throw INVALID_CREDENTIALS();
  }

  if (!AUTHENTICATABLE_STATUSES.has(account.account_status)) {
    await withTransaction((client) => recordAuthEvent(client, {
      userId: account.id,
      eventType: 'login_failure',
      ip,
      userAgent,
      metadata: { reason: 'account_unavailable' },
    }));
    throw ACCOUNT_UNAVAILABLE();
  }

  return withTransaction(async (client) => {
    const token = createSecret();
    const session = await client.query(
      `INSERT INTO sessions (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, expires_at`,
      [
        account.id,
        hashSecret(token),
        new Date(Date.now() + SESSION_TTL_MS),
        userAgent,
        ip,
      ],
    );
    await client.query(
      'UPDATE users SET last_login_at = NOW() WHERE id = $1',
      [account.id],
    );
    await recordAuthEvent(client, {
      userId: account.id,
      eventType: 'login_success',
      ip,
      userAgent,
      metadata: { sessionId: session.rows[0].id },
    });
    const user = await loadPublicUser(client, account.id);
    return {
      user,
      sessionToken: token,
      session: {
        id: session.rows[0].id,
        expiresAt: session.rows[0].expires_at,
      },
    };
  });
}

export async function resolveSession(token) {
  if (!token) return { state: 'anonymous' };

  const result = await getPool().query(
    `SELECT
       s.id AS session_id,
       s.expires_at,
       s.revoked_at,
       s.last_seen_at,
       u.id,
       u.email,
       u.display_name,
       u.username,
       u.account_status,
       u.email_verified_at,
       u.deleted_at,
       COALESCE(array_agg(DISTINCT r.slug) FILTER (WHERE r.slug IS NOT NULL), ARRAY[]::text[]) AS roles,
       COALESCE(array_agg(DISTINCT p.slug) FILTER (WHERE p.slug IS NOT NULL), ARRAY[]::text[]) AS permissions
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_roles ur ON ur.user_id = u.id
     LEFT JOIN roles r ON r.id = ur.role_id
     LEFT JOIN role_permissions rp ON rp.role_id = r.id
     LEFT JOIN permissions p ON p.id = rp.permission_id
     WHERE s.token_hash = $1
     GROUP BY s.id, u.id`,
    [hashSecret(token)],
  );
  const row = result.rows[0];
  if (!row || row.deleted_at) return { state: 'anonymous' };

  const session = { id: row.session_id, expiresAt: row.expires_at };
  if (row.revoked_at) return { state: 'revoked', session, userId: row.id };
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    return { state: 'expired', session, userId: row.id };
  }
  if (!AUTHENTICATABLE_STATUSES.has(row.account_status)) {
    return { state: 'unavailable', session, userId: row.id };
  }

  if (Date.now() - new Date(row.last_seen_at).getTime() >= SESSION_TOUCH_INTERVAL_MS) {
    getPool().query(
      `UPDATE sessions
       SET last_seen_at = NOW()
       WHERE id = $1 AND revoked_at IS NULL`,
      [row.session_id],
    ).catch(() => {});
  }

  return {
    state: 'ok',
    session,
    userId: row.id,
    auth: {
      session,
      user: toPublicUser(row, row.roles),
      permissions: row.permissions,
    },
  };
}

export function sessionError(state) {
  return sessionFailure(state);
}

export async function logoutSession({ token, ip, userAgent }) {
  const resolved = token ? await resolveSession(token) : { state: 'anonymous' };
  if (!resolved.session) return;
  if (resolved.state !== 'ok' && resolved.state !== 'expired') return;

  await withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE sessions
       SET revoked_at = NOW(), revoke_reason = 'logout'
       WHERE id = $1 AND revoked_at IS NULL
       RETURNING user_id`,
      [resolved.session.id],
    );
    if (!updated.rows[0]) return;
    await recordAuthEvent(client, {
      userId: updated.rows[0].user_id,
      eventType: 'logout',
      ip,
      userAgent,
      metadata: { sessionId: resolved.session.id },
    });
  });
}

export async function listOwnSessions(userId, currentSessionId) {
  const result = await getPool().query(
    `SELECT id, created_at, expires_at, last_seen_at, user_agent
     FROM sessions
     WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW()
     ORDER BY last_seen_at DESC
     LIMIT 10`,
    [userId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastSeenAt: row.last_seen_at,
    device: row.user_agent ? String(row.user_agent).slice(0, 80) : 'Unknown device',
    current: row.id === currentSessionId,
  }));
}

export async function revokeOneSession({
  userId,
  sessionId,
  ip,
  userAgent,
}) {
  return withTransaction(async (client) => {
    const updated = await client.query(
      `UPDATE sessions
       SET revoked_at = NOW(), revoke_reason = 'revoked'
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, userId],
    );
    if (!updated.rows[0]) {
      const existing = await client.query(
        'SELECT id, revoked_at FROM sessions WHERE id = $1 AND user_id = $2',
        [sessionId, userId],
      );
      if (!existing.rows[0]) {
        throw new AppError('Session not found', { status: 404, code: 'NOT_FOUND' });
      }
      return { revoked: true };
    }
    await recordAuthEvent(client, {
      userId,
      eventType: 'session_revoked',
      ip,
      userAgent,
      metadata: { sessionId },
    });
    return { revoked: true };
  });
}

export async function revokeAllSessions({ userId, ip, userAgent }) {
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE sessions
       SET revoked_at = NOW(), revoke_reason = 'revoke_all'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await recordAuthEvent(client, {
      userId,
      eventType: 'sessions_revoked',
      ip,
      userAgent,
      metadata: { reason: 'revoke_all' },
    });
  });
}

export async function requestPasswordReset({ email, ip, userAgent }) {
  const normalizedEmail = normalizeEmail(email);
  const existing = await getPool().query(
    `SELECT id FROM users WHERE normalized_email = $1 AND deleted_at IS NULL`,
    [normalizedEmail],
  );
  const account = existing.rows[0];
  if (!account) return { token: null };

  const token = await withTransaction(async (client) => {
    const issued = await issuePasswordReset(client, account.id);
    await recordAuthEvent(client, {
      userId: account.id,
      eventType: 'password_reset_requested',
      ip,
      userAgent,
      metadata: {},
    });
    return issued;
  });
  return { token };
}

export async function resetPassword({ token, password, ip, userAgent }) {
  const passwordHash = await hashPassword(password);

  await withTransaction(async (client) => {
    const row = await lockToken(client, 'password_reset_tokens', token);
    const state = classifyToken(row);
    if (state !== 'ok') throw tokenError('reset', state);

    const account = await client.query(
      `SELECT id, account_status, deleted_at
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [row.user_id],
    );
    const user = account.rows[0];
    if (!user || user.deleted_at || !AUTHENTICATABLE_STATUSES.has(user.account_status)) {
      throw tokenError('reset', 'invalid');
    }

    await client.query(
      'UPDATE users SET password_hash = $2 WHERE id = $1',
      [user.id, passwordHash],
    );
    await client.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id],
    );
    await client.query(
      `UPDATE sessions
       SET revoked_at = NOW(), revoke_reason = 'password_reset'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [user.id],
    );
    await recordAuthEvent(client, {
      userId: user.id,
      eventType: 'password_reset_completed',
      ip,
      userAgent,
      metadata: {},
    });
    await recordAuthEvent(client, {
      userId: user.id,
      eventType: 'sessions_revoked',
      ip,
      userAgent,
      metadata: { reason: 'password_reset' },
    });
  });
}

export async function verifyEmail({ token, ip, userAgent }) {
  return withTransaction(async (client) => {
    const row = await lockToken(client, 'email_verification_tokens', token);
    const state = classifyToken(row);
    if (state !== 'ok') throw tokenError('verify', state);

    const updated = await client.query(
      `UPDATE users
       SET email_verified_at = COALESCE(email_verified_at, NOW()),
           account_status = CASE
             WHEN account_status = 'pending_verification' THEN 'active'
             ELSE account_status
           END
       WHERE id = $1 AND deleted_at IS NULL
       RETURNING id`,
      [row.user_id],
    );
    if (!updated.rows[0]) throw tokenError('verify', 'invalid');

    await client.query(
      'UPDATE email_verification_tokens SET used_at = NOW() WHERE id = $1',
      [row.id],
    );
    await recordAuthEvent(client, {
      userId: row.user_id,
      eventType: 'email_verified',
      ip,
      userAgent,
      metadata: {},
    });
    return { user: await loadPublicUser(client, row.user_id) };
  });
}

export async function resendVerification({ userId, ip, userAgent }) {
  return withTransaction(async (client) => {
    const account = await client.query(
      `SELECT id, email_verified_at, account_status, deleted_at
       FROM users
       WHERE id = $1
       FOR UPDATE`,
      [userId],
    );
    const user = account.rows[0];
    if (!user || user.deleted_at) {
      throw new AppError('Authentication is required', {
        status: 401,
        code: 'UNAUTHENTICATED',
      });
    }
    if (user.email_verified_at) return { token: null, user: await loadPublicUser(client, userId) };

    const token = await issueEmailVerification(client, userId);
    await recordAuthEvent(client, {
      userId,
      eventType: 'email_verification_sent',
      ip,
      userAgent,
      metadata: {},
    });
    return { token, user: await loadPublicUser(client, userId) };
  });
}

export async function recordAdminAccess({ userId, ip, userAgent }) {
  await withTransaction((client) => recordAuthEvent(client, {
    userId,
    eventType: 'admin_authenticated',
    ip,
    userAgent,
    metadata: {},
  }));
}

export async function changePassword({ userId, currentPassword, password, ip, userAgent }) {
  const passwordHash = await hashPassword(password);
  await withTransaction(async (client) => {
    const account = await client.query(
      `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [userId],
    );
    if (!account.rowCount) throw INVALID_CREDENTIALS();
    const matches = await verifyPassword(account.rows[0].password_hash, currentPassword);
    if (!matches) throw INVALID_CREDENTIALS();
    await client.query('UPDATE users SET password_hash = $2 WHERE id = $1', [userId, passwordHash]);
    await client.query(
      `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'revoke_all'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    await recordAuthEvent(client, {
      userId,
      eventType: 'sessions_revoked',
      ip,
      userAgent,
      metadata: { reason: 'password_changed' },
    });
  });
}

export async function deleteAccount({ userId, password, ip, userAgent }) {
  await withTransaction(async (client) => {
    const account = await client.query(
      `SELECT password_hash FROM users WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [userId],
    );
    if (!account.rowCount) throw INVALID_CREDENTIALS();
    const matches = await verifyPassword(account.rows[0].password_hash, password);
    if (!matches) throw INVALID_CREDENTIALS();
    await eraseLibrary(client, userId);
    await client.query('DELETE FROM email_verification_tokens WHERE user_id = $1', [userId]);
    await client.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [userId]);
    await client.query(
      `UPDATE sessions SET revoked_at = NOW(), revoke_reason = 'revoke_all'
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId],
    );
    const tombstone = `deleted-${userId}@users.invalid`;
    const retiredHash = await hashPassword(createSecret());
    await client.query(
      `UPDATE users
       SET deleted_at = NOW(),
           account_status = 'deactivated',
           display_name = 'Deleted account',
           email = $2,
           normalized_email = $2,
           password_hash = $3
       WHERE id = $1`,
      [userId, tombstone, retiredHash],
    );
    await recordAuthEvent(client, {
      userId,
      eventType: 'sessions_revoked',
      ip,
      userAgent,
      metadata: { reason: 'account_deleted' },
    });
  });
}
