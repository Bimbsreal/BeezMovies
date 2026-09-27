import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

export { ipKeyGenerator };
import { config } from '../config/index.js';

function isProbe(req) {
  const path = req.path || '';
  const original = req.originalUrl || '';
  return path === '/health'
    || path === '/ready'
    || path === '/health/live'
    || path === '/health/ready'
    || original.startsWith('/api/v1/health')
    || original.startsWith('/api/v1/ready')
    || original === '/health'
    || original.startsWith('/health/');
}

// Memory store is the single-process foundation.
// A Redis-backed store can replace it when shared limits are required.
export function createRateLimiter(options = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: config.isProduction ? 100 : 1000,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => config.isTest || isProbe(req),
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests',
      },
    },
    ...options,
  });
}

export const apiRateLimiter = createRateLimiter();

export function createDownloadLimiter() {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: config.isProduction ? 30 : 120,
    keyGenerator: (req) => {
      if (req.auth?.user?.id) return `account:${req.auth.user.id}`;
      return ipKeyGenerator(req.ip || '');
    },
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many download requests',
      },
    },
  });
}

export function createAuthAttemptLimiter(overrides = {}) {
  return createRateLimiter({
    windowMs: 15 * 60 * 1000,
    limit: config.isProduction ? 10 : 50,
    message: {
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many authentication attempts',
      },
    },
    ...overrides,
  });
}

export const authAttemptLimiter = createAuthAttemptLimiter();
