import { isIP } from 'node:net';

const FORBIDDEN_METADATA = new Set([
  'password',
  'password_hash',
  'token',
  'secret',
  'session_token',
  'api_key',
  'apiKey',
]);

export function clientIp(req) {
  const value = req.ip;
  return value && isIP(value) ? value : null;
}

export function clientUserAgent(req) {
  const value = req.get('user-agent');
  if (!value) return null;
  return value.slice(0, 512);
}

export function safeMetadata(metadata = {}) {
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (FORBIDDEN_METADATA.has(key)) continue;
    clean[key] = value;
  }
  return clean;
}

export async function recordAuthEvent(client, {
  userId = null,
  eventType,
  ip = null,
  userAgent = null,
  metadata = {},
}) {
  await client.query(
    `INSERT INTO auth_events (user_id, event_type, ip_address, user_agent, metadata)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [userId, eventType, ip, userAgent, JSON.stringify(safeMetadata(metadata))],
  );
}
