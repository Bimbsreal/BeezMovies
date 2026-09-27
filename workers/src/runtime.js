import { logger } from '../../backend/src/logger/index.js';
import { initRedis, closeRedis, getRedisStatus } from '../../backend/src/redis/client.js';
import { closePool } from '../../backend/src/db/pool.js';
import { sanitize } from '../../backend/src/errors/sanitize.js';

const handlers = new Map();
let started = false;

export function registerHandler(name, handler) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new TypeError('Handler name is required');
  }
  if (typeof handler !== 'function') {
    throw new TypeError(`Handler for ${name} must be a function`);
  }
  handlers.set(name, handler);
}

export function listHandlers() {
  return [...handlers.keys()];
}

export async function startWorker() {
  if (started) return;
  started = true;

  await initRedis();
  logger.info({
    redis: getRedisStatus(),
    handlers: listHandlers(),
  }, 'Worker runtime ready');

  // Signal listeners alone do not keep Node alive. This interval holds the
  // process open while no Redis socket or job handlers are active.
  const keepAlive = setInterval(() => {}, 60_000);

  await new Promise((resolve) => {
    const stop = (signal) => {
      clearInterval(keepAlive);
      logger.info({ signal }, 'Worker shutting down');
      closePool()
        .catch(() => {})
        .then(() => closeRedis())
        .catch((error) => {
          logger.error({ err: sanitize(error.message) }, 'Worker shutdown failed');
        })
        .finally(() => {
          logger.flush(() => {
            resolve();
            process.exit(0);
          });
        });
    };

    process.once('SIGINT', () => stop('SIGINT'));
    process.once('SIGTERM', () => stop('SIGTERM'));
  });
}
