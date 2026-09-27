import { createHash, randomBytes } from 'node:crypto';

export function createSecret() {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

export function normalizeEmail(email) {
  return email.trim().normalize('NFKC').toLowerCase();
}
