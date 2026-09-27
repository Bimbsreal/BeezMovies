const ADAPTER_METHODS = [
  'searchTitles',
  'getMovie',
  'getCredits',
  'getImages',
  'getExternalIdentifiers',
];

const DESCRIPTOR_FIELDS = [
  'name',
  'authentication',
  'endpoints',
  'rateLimit',
  'metadata',
  'attribution',
  'errors',
];

export function assertAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Metadata source adapter is required');
  }
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== 'function') {
      throw new TypeError(`Metadata source adapter is missing ${name}`);
    }
  }
  const descriptor = adapter.descriptor;
  if (!descriptor || typeof descriptor !== 'object') {
    throw new TypeError('Metadata source adapter is missing its descriptor');
  }
  for (const field of DESCRIPTOR_FIELDS) {
    const value = descriptor[field];
    const present = Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0;
    if (!present) throw new TypeError(`Metadata source adapter descriptor is missing ${field}`);
  }
  return adapter;
}
