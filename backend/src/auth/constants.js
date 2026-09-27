export const SESSION_COOKIE = 'beezmovies_session';
export const REQUEST_HEADER = 'x-beezmovies-request';

export const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
export const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;

// OWASP Argon2id baseline: 19 MiB, 2 iterations, parallelism 1.
export const PASSWORD_HASH_PARAMS = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

export const AUTHENTICATABLE_STATUSES = new Set(['pending_verification', 'active']);
