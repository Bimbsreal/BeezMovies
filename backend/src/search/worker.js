import { consumeSearchEvents, runPendingReindex } from './indexer.js';
import { logger } from '../logger/index.js';
import { flagEnabled } from '../ops/flags.js';

export async function runSearchCycle() {
  try {
    if (!(await flagEnabled('searchIndexing'))) return;
    await runPendingReindex();
    await consumeSearchEvents();
  } catch (error) {
    logger.error({ event: 'SEARCH_INDEX_FAILED', code: error.code || 'INDEX_FAILED' }, 'SEARCH_INDEX_FAILED');
  }
}
