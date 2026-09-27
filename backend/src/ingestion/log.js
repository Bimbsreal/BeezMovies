import { logger } from '../logger/index.js';

export function logIngestion(event, fields) {
  logger.info({ event, ...fields }, event);
}
