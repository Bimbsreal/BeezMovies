import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';
import { closePool } from './pool.js';
import { seedStagingCatalog } from './seed.js';

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  seedStagingCatalog()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error({ err: sanitize(error.message) }, 'Staging seed refused');
      await closePool();
      process.exit(1);
    });
}
