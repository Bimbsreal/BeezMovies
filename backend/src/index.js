import { createApp } from './app.js';
import { config } from './config/index.js';
import { assertProductionConfig } from './config/release.js';
import { logger } from './logger/index.js';
import { sanitize } from './errors/sanitize.js';
import { getPool, closePool } from './db/pool.js';
import { initRedis, closeRedis } from './redis/client.js';

const app = createApp();
const SHUTDOWN_GRACE_MS = 10_000;

async function shutdown(server, signal) {
  logger.info({ signal }, 'Shutting down');

  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
      resolve();
    }, SHUTDOWN_GRACE_MS);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });

  await closePool();
  await closeRedis();
}

async function start() {
  try {
    assertProductionConfig();
  } catch (error) {
    logger.error({ err: sanitize(error.message) }, 'Production configuration rejected');
    process.exit(1);
  }

  if (!config.databaseUrl) {
    logger.error('DATABASE_URL is required');
    process.exit(1);
  }

  try {
    await getPool().query('SELECT 1');
    logger.info('PostgreSQL connection established');
  } catch (error) {
    logger.warn({
      err: sanitize(error.message),
    }, 'PostgreSQL is not reachable; /api/v1/ready will report unavailable');
  }

  await initRedis();

  const server = app.listen(config.port);
  server.requestTimeout = 30_000;
  server.headersTimeout = 20_000;
  server.keepAliveTimeout = 5_000;
  server.on('listening', () => {
    logger.info({ port: config.port }, 'BeezMovies API listening');
  });

  let shuttingDown = false;

  async function handleSignal(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    try {
      await shutdown(server, signal);
      process.exit(0);
    } catch (error) {
      logger.error({ err: sanitize(error.message) }, 'Error during shutdown');
      process.exit(1);
    }
  }

  process.on('SIGINT', () => {
    handleSignal('SIGINT');
  });
  process.on('SIGTERM', () => {
    handleSignal('SIGTERM');
  });
  process.on('unhandledRejection', (error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: sanitize(message) }, 'Unhandled rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.error({ err: sanitize(error.message) }, 'Uncaught exception');
    process.exit(1);
  });

  server.on('error', (error) => {
    logger.error({ err: sanitize(error.message) }, 'HTTP server failed');
    process.exit(1);
  });
}

start();
