import { catalogCache, catalogCacheKeys } from '../catalog/cache.js';

const memory = new Map();
let generation = 1;
const stats = { hits: 0, misses: 0 };

function read(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

export function discoveryCacheStats() {
  return { ...stats, generation };
}

export function resetDiscoveryCacheStats() {
  stats.hits = 0;
  stats.misses = 0;
}

export async function discoveryCacheGet(name) {
  const key = `${name}:g${generation}`;
  const local = read(key);
  if (local) {
    stats.hits += 1;
    return local;
  }
  const stored = await catalogCache.get(catalogCacheKeys.discovery(key));
  if (!stored) {
    stats.misses += 1;
    return null;
  }
  memory.set(key, { value: stored, expiresAt: Date.now() + 60_000 });
  stats.hits += 1;
  return stored;
}

export async function discoveryCacheSet(name, value, ttlSeconds = 60) {
  const key = `${name}:g${generation}`;
  memory.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  await catalogCache.set(catalogCacheKeys.discovery(key), value, ttlSeconds);
}

export function invalidateDiscoveryCache() {
  generation += 1;
  memory.clear();
}
