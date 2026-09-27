import { mediaError } from './errors.js';

const BLOCKED = [
  'localhost',
  '127.0.0.1',
  '0.0.0.0',
  '::1',
  '169.254.169.254',
  'metadata.google.internal',
];

export function assertSafeReference(value) {
  if (typeof value !== 'string') throw mediaError('MEDIA_NOT_FOUND');
  const reference = value.trim();
  if (!reference || reference.length > 200) throw mediaError('MEDIA_NOT_FOUND');
  const lower = reference.toLowerCase();
  if (
    lower.includes('://')
    || lower.startsWith('//')
    || lower.startsWith('/')
    || lower.includes('@')
    || lower.includes('\\')
  ) {
    throw mediaError('MEDIA_NOT_FOUND');
  }
  for (const host of BLOCKED) {
    if (lower.includes(host)) throw mediaError('MEDIA_NOT_FOUND');
  }
  return reference;
}

export function assertApprovedDestination(url, hosts = []) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port) {
    throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  }
  if (!hosts.includes(parsed.hostname)) throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  return parsed.toString();
}

export function assertLocalResolution(resolved) {
  if (!resolved || resolved.local !== true) throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  if (resolved.resourceType !== 'download' && resolved.resourceType !== 'stream') {
    throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  }
  if (resolved.url || resolved.href) throw mediaError('DOWNLOAD_NOT_SUPPORTED');
  if (resolved.expiresAt && Date.parse(resolved.expiresAt) <= Date.now()) {
    throw mediaError('MEDIA_EXPIRED');
  }
  return resolved;
}
