import { getPool } from '../db/pool.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';
import { AppError } from '../errors/app-error.js';

export async function catalogQuery(text, params = []) {
  try {
    return await getPool().query(text, params);
  } catch (error) {
    logger.error({
      err: sanitize(error.message),
      code: error.code,
    }, 'Catalog query failed');
    throw new AppError('The catalog is temporarily unavailable', {
      status: 500,
      code: 'CATALOG_UNAVAILABLE',
    });
  }
}
