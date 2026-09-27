export const AD_TIMEOUT_MS = 1500;
export const SIDE_RAIL_MIN_WIDTH = 1800;

export function placementVisible(placement, { viewport = 1280, consentGranted = true, consentRequired = false } = {}) {
  if (!placement || placement.mode !== 'house' || !placement.creative) return false;
  if (consentRequired && !consentGranted) return false;
  const mobile = viewport < 768;
  if (placement.slug === 'DESKTOP_SIDE_RAIL') return viewport >= SIDE_RAIL_MIN_WIDTH && placement.desktopEnabled;
  if (mobile) return Boolean(placement.mobileEnabled);
  return Boolean(placement.desktopEnabled);
}

export function nextPreviewPhase(phase, event) {
  if (phase === 'content') return 'content';
  if (event === 'ready') return 'advertisement';
  if (event === 'failure' || event === 'timeout' || event === 'skip' || event === 'complete') return 'content';
  return 'content';
}

export function withTimeout(work, timeoutMs = AD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
    Promise.resolve()
      .then(work)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}
