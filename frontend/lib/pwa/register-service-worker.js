export function registerServiceWorker() {
  if (process.env.NODE_ENV !== 'production') return;
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then((registration) => {
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        if (!worker) return;
        worker.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            window.dispatchEvent(new CustomEvent('beezmovies:sw-update', {
              detail: { registration },
            }));
          }
        });
      });
    }).catch(() => {
      window.dispatchEvent(new CustomEvent('beezmovies:sw-failed'));
    });
  });
}

export function activateWaitingWorker(registration) {
  registration?.waiting?.postMessage({ type: 'SKIP_WAITING' });
}
