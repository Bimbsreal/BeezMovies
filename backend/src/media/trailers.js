const TRAILER_HOSTS = new Set(['videos.example.com']);

export function publicTrailerUrl(value) {
  if (!value || typeof value !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null;
  if (!TRAILER_HOSTS.has(parsed.hostname)) return null;
  if (!/\.(mp4|webm|ogg)$/i.test(parsed.pathname)) return null;
  return parsed.toString();
}
