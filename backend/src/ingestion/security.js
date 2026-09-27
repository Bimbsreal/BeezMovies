import { IngestionError } from './errors.js';

function isBlockedAddress(host) {
  const normalized = host.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized === '0.0.0.0') return true;

  const v4 = normalized.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!v4) {
    return normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || normalized.startsWith('fe80')
      || normalized.startsWith('ff');
  }

  const parts = v4.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

export function assertSafeMetadataUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata URL is invalid', { transient: false });
  }

  if (url.protocol !== 'https:') {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata URL must use https', { transient: false });
  }
  if (url.username || url.password) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata URL cannot include credentials', { transient: false });
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  const blockedName = !host
    || host === 'localhost'
    || host.endsWith('.localhost')
    || host.endsWith('.local')
    || host.endsWith('.internal');

  if (blockedName || /^\d+$/.test(host) || host.startsWith('0x') || isBlockedAddress(host)) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata URL host is not allowed', { transient: false });
  }

  if (url.href.length > 2048) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata URL is too long', { transient: false });
  }

  return url;
}

export function assertAllowedHost(value, allowedHosts = []) {
  const url = assertSafeMetadataUrl(value);
  const host = url.hostname.toLowerCase();
  if (allowedHosts.length > 0 && !allowedHosts.map((item) => item.toLowerCase()).includes(host)) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata URL host is not allowed for this source', {
      transient: false,
    });
  }
  return url;
}

export function assertResponsePolicy({
  status,
  contentType,
  contentLength = 0,
  maxBytes = 1_000_000,
  retryAfterMs = null,
}) {
  if (status >= 300 && status < 400) {
    throw new IngestionError('SOURCE_REDIRECT', 'Metadata redirects are not followed', { transient: false });
  }
  if (status === 429) {
    throw new IngestionError('SOURCE_RATE_LIMITED', 'Metadata source asked us to wait', {
      transient: true,
      retryAfterMs,
    });
  }
  if (status >= 500) {
    throw new IngestionError('SOURCE_UNAVAILABLE', 'Metadata source is unavailable', { transient: true });
  }
  if (status !== 200) {
    throw new IngestionError('SOURCE_UNAVAILABLE', 'Metadata source rejected the request', { transient: false });
  }
  if (!String(contentType || '').toLowerCase().includes('application/json')) {
    throw new IngestionError('UNSUPPORTED_RECORD', 'Metadata response must be JSON', { transient: false });
  }
  if (Number(contentLength) > maxBytes) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata response is too large', { transient: false });
  }
}
