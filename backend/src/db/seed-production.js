import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';
import { refuseProductionSeed } from './seed.js';

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  try {
    refuseProductionSeed();
  } catch (error) {
    logger.error({ err: sanitize(error.message) }, 'Production seed refused');
    process.exit(1);
  }
}
