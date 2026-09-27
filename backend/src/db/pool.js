import pg from 'pg';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';

const { Pool } = pg;

let pool;

export function getPool() {
  if (!config.databaseUrl) {
    const error = new Error('DATABASE_URL is not configured');
    error.code = 'DB_NOT_CONFIGURED';
    throw error;
  }

  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      max: Number(process.env.PG_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      query_timeout: Number(process.env.PG_QUERY_TIMEOUT_MS || 20_000),
      allowExitOnIdle: true,
    });

    pool.on('error', (error) => {
      logger.error({ err: sanitize(error.message) }, 'Unexpected PostgreSQL client error');
    });
  }

  return pool;
}

export function poolStats() {
  const max = Number(process.env.PG_POOL_MAX || 10);
  if (!pool) return { max, total: 0, idle: 0, waiting: 0 };
  return {
    max: pool.options.max,
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = null;

  let timer;
  try {
    await Promise.race([
      current.end(),
      new Promise((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
