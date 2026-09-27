import { getPool } from '../../db/pool.js';
import { checkRedis } from '../../redis/client.js';
import { logger } from '../../logger/index.js';
import { sanitize } from '../../errors/sanitize.js';

export function health(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    service: 'beezmovies-api',
  });
}

async function checkPostgres() {
  try {
    const result = await getPool().query(
      "SELECT value FROM app_meta WHERE key = 'foundation'",
    );
    if (result.rows[0]?.value === 'ready') return 'ok';
    return 'migrations_pending';
  } catch (error) {
    logger.error({
      err: sanitize(error.message),
      code: error.code,
    }, 'PostgreSQL readiness check failed');

    if (error.code === 'DB_NOT_CONFIGURED') return 'not_configured';
    if (error.code === '42P01') return 'migrations_pending';
    return 'unavailable';
  }
}

export async function ready(_req, res) {
  const postgres = await checkPostgres();
  const redis = await checkRedis();
  const isReady = postgres === 'ok';

  res.set('Cache-Control', 'no-store');
  res.status(isReady ? 200 : 503).json({
    status: isReady ? 'ok' : 'unavailable',
    checks: {
      postgres: { status: postgres, required: true },
      redis,
    },
  });
}
