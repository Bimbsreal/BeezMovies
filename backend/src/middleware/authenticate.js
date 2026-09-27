import { SESSION_COOKIE } from '../auth/constants.js';
import { clearSessionCookie, readCookie } from '../auth/cookies.js';
import { resolveSession, sessionError } from '../auth/service.js';

export async function optionalAuth(req, _res, next) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    if (!token) {
      req.auth = null;
      next();
      return;
    }
    const resolved = await resolveSession(token);
    req.auth = resolved.state === 'ok' ? resolved.auth : null;
    next();
  } catch (error) {
    next(error);
  }
}

export async function requireAuth(req, res, next) {
  try {
    const token = readCookie(req, SESSION_COOKIE);
    const resolved = await resolveSession(token);
    if (resolved.state !== 'ok') {
      if (token) clearSessionCookie(res);
      next(sessionError(resolved.state));
      return;
    }
    req.auth = resolved.auth;
    next();
  } catch (error) {
    next(error);
  }
}

