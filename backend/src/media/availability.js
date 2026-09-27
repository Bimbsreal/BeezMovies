const CODE = /^[A-Z]{2}$/;

function suppliedCountries(rows) {
  const codes = new Set();
  for (const row of rows) {
    const list = row.metadata?.countries;
    if (!Array.isArray(list)) continue;
    for (const code of list) {
      if (typeof code === 'string' && CODE.test(code)) codes.add(code);
    }
  }
  return codes.size ? [...codes].sort() : null;
}

function usable(row) {
  return row.mediaType === 'download'
    && row.status === 'available'
    && row.availability === 'available'
    && row.rights === 'AUTHORIZED'
    && row.providerStatus === 'active';
}

export function classifyMedia(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const countries = suppliedCountries(list);
  const downloads = list.filter((row) => row.mediaType === 'download');
  const authorized = downloads.filter(usable);
  const reachable = authorized.filter((row) => row.health !== 'unavailable' && row.health !== 'degraded');
  if (authorized.length > 0 && reachable.length === 0) {
    return { state: 'PROVIDER_ERROR', countries };
  }
  if (reachable.length > 0) return { state: 'MEDIA_AVAILABLE', countries };
  if (list.some((row) => row.rights === 'PENDING_REVIEW')) {
    return { state: 'REVIEW_REQUIRED', countries };
  }
  if (downloads.some((row) => row.status === 'pending' || row.availability === 'unknown')) {
    return { state: 'MEDIA_PENDING', countries };
  }
  return { state: 'MEDIA_UNAVAILABLE', countries };
}
