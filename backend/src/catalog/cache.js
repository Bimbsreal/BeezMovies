import { getRedis } from '../redis/client.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';
import { CACHE_TTL_SECONDS } from './constants.js';

const PREFIX = 'beezmovies:catalog:';
const MEMORY_MAX = 100;
const memory = new Map();

function readMemory(name) {
  const entry = memory.get(name);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    memory.delete(name);
    return null;
  }
  return entry.value;
}

function writeMemory(name, value, ttlSeconds) {
  if (memory.size >= MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    memory.delete(oldest);
  }
  memory.set(name, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function key(name) {
  return `${PREFIX}${name}`;
}

export const catalogCacheKeys = {
  movieSlug(slug) {
    return key(`movie:slug:${slug}`);
  },
  genres() {
    return key('genres');
  },
  collections() {
    return key('collections');
  },
  discovery(name) {
    return key(`discovery:${name}`);
  },
};

async function redis() {
  const client = getRedis();
  if (!client) return null;
  return client;
}

export const catalogCache = {
  async get(name) {
    const local = readMemory(name);
    if (local) return local;
    const client = await redis();
    if (!client) return null;
    try {
      const raw = await client.get(name);
      if (!raw) return null;
      const value = JSON.parse(raw);
      writeMemory(name, value, CACHE_TTL_SECONDS);
      return value;
    } catch (error) {
      logger.warn({ err: sanitize(error.message) }, 'Catalog cache read skipped');
      return null;
    }
  },

  async set(name, value, ttlSeconds = CACHE_TTL_SECONDS) {
    writeMemory(name, value, ttlSeconds);
    const client = await redis();
    if (!client) return false;
    try {
      await client.set(name, JSON.stringify(value), 'EX', ttlSeconds);
      return true;
    } catch (error) {
      logger.warn({ err: sanitize(error.message) }, 'Catalog cache write skipped');
      return false;
    }
  },

  async invalidate(names) {
    for (const name of names) memory.delete(name);
    const client = await redis();
    if (!client || names.length === 0) return names.length;
    try {
      return await client.del(...names);
    } catch (error) {
      logger.warn({ err: sanitize(error.message) }, 'Catalog cache invalidation skipped');
      return 0;
    }
  },
};
