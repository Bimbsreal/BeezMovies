import { getRedis } from '../redis/client.js';
import { logger } from '../logger/index.js';
import { SEARCH_CACHE_TTL_SECONDS } from './constants.js';

const PREFIX = 'beezmovies:search:';
const memory = new Map();
const stats = { hits: 0, misses: 0 };
let generation = 0;

async function currentGeneration() {
  const client = getRedis();
  if (!client) return generation;
  try {
    const remote = Number(await client.get(`${PREFIX}generation`) || 0);
    if (remote > generation) {
      generation = remote;
      memory.clear();
    }
  } catch (error) {
    logger.warn({ code: error.code }, 'Search cache generation skipped');
  }
  return generation;
}

function readMemory(key) {
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return entry.value;
}

function writeMemory(key, value) {
  if (memory.size >= 50) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
  memory.set(key, {
    value,
    expiresAt: Date.now() + SEARCH_CACHE_TTL_SECONDS * 1000,
  });
}

export function searchCacheStats() {
  return { ...stats };
}

export function resetSearchCacheStats() {
  stats.hits = 0;
  stats.misses = 0;
}

export const searchCache = {
  async get(key) {
    const scoped = `${await currentGeneration()}:${key}`;
    const local = readMemory(scoped);
    if (local) {
      stats.hits += 1;
      return local;
    }
    const client = getRedis();
    if (!client) {
      stats.misses += 1;
      return null;
    }
    try {
      const raw = await client.get(`${PREFIX}${scoped}`);
      if (!raw) {
        stats.misses += 1;
        return null;
      }
      const value = JSON.parse(raw);
      writeMemory(scoped, value);
      stats.hits += 1;
      return value;
    } catch (error) {
      logger.warn({ code: error.code }, 'Search cache read skipped');
      stats.misses += 1;
      return null;
    }
  },

  async set(key, value) {
    const scoped = `${await currentGeneration()}:${key}`;
    writeMemory(scoped, value);
    const client = getRedis();
    if (!client) return false;
    try {
      await client.set(`${PREFIX}${scoped}`, JSON.stringify(value), 'EX', SEARCH_CACHE_TTL_SECONDS);
      return true;
    } catch (error) {
      logger.warn({ code: error.code }, 'Search cache write skipped');
      return false;
    }
  },
};

export function invalidateSearchCache() {
  generation += 1;
  memory.clear();
  const client = getRedis();
  if (!client) return;
  client.incr(`${PREFIX}generation`).then((value) => {
    const remote = Number(value) || generation;
    if (remote > generation) generation = remote;
  }).catch((error) => {
    logger.warn({ code: error.code }, 'Search cache invalidation skipped');
  });
}
