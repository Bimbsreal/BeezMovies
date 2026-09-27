import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config/index.js';
import { HANDOFF_TTL_SECONDS } from './constants.js';
import { mediaError } from './errors.js';

function secret() {
  const value = config.handoffSecret;
  if (!value) throw mediaError('PROVIDER_UNAVAILABLE');
  return value;
}

export function mintHandoff({ referenceId, kind }) {
  const payload = Buffer.from(JSON.stringify({
    ref: referenceId,
    kind,
    exp: Math.floor(Date.now() / 1000) + HANDOFF_TTL_SECONDS,
  })).toString('base64url');
  const signature = createHmac('sha256', secret()).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function readHandoff(token) {
  if (typeof token !== 'string' || !token.includes('.')) throw mediaError('MEDIA_EXPIRED');
  const [payload, signature] = token.split('.');
  if (!payload || !signature || token.split('.').length !== 2) throw mediaError('MEDIA_EXPIRED');
  const expected = createHmac('sha256', secret()).update(payload).digest('base64url');
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    throw mediaError('MEDIA_EXPIRED');
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw mediaError('MEDIA_EXPIRED');
  }
  if (!parsed?.ref || !parsed.exp || parsed.kind !== 'download') throw mediaError('MEDIA_EXPIRED');
  if (parsed.exp <= Math.floor(Date.now() / 1000)) throw mediaError('MEDIA_EXPIRED');
  return parsed;
}
