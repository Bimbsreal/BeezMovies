import { publicConfig } from '../config';

const PRIVATE_PREFIXES = ['/admin', '/account', '/settings', '/my-list', '/login', '/register'];

export function recordClientEvent(event) {
  try {
    if (typeof window === 'undefined') return;
    if (PRIVATE_PREFIXES.some((prefix) => window.location.pathname.startsWith(prefix))) return;
    const id = window.crypto?.randomUUID?.();
    if (!id) return;
    const body = JSON.stringify({
      visitorKey: visitorKey(),
      events: [{ id, ...event }],
    });
    fetch(`${publicConfig.apiUrl}/analytics/events`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: {
        'Content-Type': 'application/json',
        'X-BeezMovies-Request': '1',
      },
      body,
    }).catch(() => {});
  } catch {
    // Analytics must not affect browsing.
  }
}

function visitorKey() {
  const existing = window.sessionStorage.getItem('beez_visit');
  if (existing) return existing;
  const created = window.crypto.randomUUID().replace(/-/g, '').slice(0, 24);
  window.sessionStorage.setItem('beez_visit', created);
  return created;
}
