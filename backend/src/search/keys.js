export function searchableKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

export function searchCacheKey({ version, query, filters, page, limit }) {
  const parts = [
    `v${version}`,
    searchableKey(query),
    filters.genre || '',
    filters.year || '',
    filters.language || '',
    filters.country || '',
    filters.collection || '',
    filters.person || '',
    page,
    limit,
  ];
  return `search:${parts.join(':')}`;
}
