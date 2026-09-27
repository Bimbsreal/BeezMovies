import Redis from 'ioredis';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';

let client = null;
let status = 'disabled';

export function getRedis() {
  return client;
}

export function getRedisStatus() {
  return status;
}

export async function initRedis() {
  if (!config.redisUrl) {
    status = 'disabled';
    client = null;
    logger.info('Redis is not configured; continuing without it');
    return null;
  }

  const candidate = new Redis(config.redisUrl, {
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 2000,
    retryStrategy: () => null,
  });

  candidate.on('error', (error) => {
    logger.warn({ err: sanitize(error.message) }, 'Redis client error');
  });

  try {
    await candidate.connect();
    const pong = await candidate.ping();
    if (pong !== 'PONG') {
      throw new Error('Redis ping failed');
    }
    client = candidate;
    status = 'ready';
    logger.info('Redis connected');
    return client;
  } catch (error) {
    status = 'unavailable';
    client = null;
    logger.warn({ err: sanitize(error.message) }, 'Redis is unavailable; continuing without it');
    candidate.disconnect();
    return null;
  }
}

export async function closeRedis() {
  if (!client) return;
  const current = client;
  client = null;
  status = 'disabled';
  try {
    await current.quit();
  } catch {
    current.disconnect();
  }
}

export async function checkRedis() {
  if (!config.redisUrl) {
    return { status: 'not_configured', required: false };
  }

  if (!client || status !== 'ready') {
    return { status: 'unavailable', required: false };
  }

  try {
    const pong = await client.ping();
    if (pong !== 'PONG') {
      return { status: 'unavailable', required: false };
    }
    return { status: 'ok', required: false };
  } catch (error) {
    logger.warn({ err: sanitize(error.message) }, 'Redis readiness check failed');
    status = 'unavailable';
    return { status: 'unavailable', required: false };
  }
}
