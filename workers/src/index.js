import { registerHandler, startWorker } from './runtime.js';
import { assertProductionConfig } from '../../backend/src/config/release.js';
import { sanitize } from '../../backend/src/errors/sanitize.js';
import { logger } from '../../backend/src/logger/index.js';
import { closeRedis } from '../../backend/src/redis/client.js';
import { runIngestionCycle } from '../../backend/src/ingestion/worker.js';
import { runSearchCycle } from '../../backend/src/search/worker.js';
import { recordWorkerHeartbeat } from '../../backend/src/ops/status.js';
import { syncOperationalIncidents } from '../../backend/src/ops/incidents.js';
import { getPool } from '../../backend/src/db/pool.js';
import { sweepOneMediaReference } from '../../backend/src/media/sweep.js';

try {
  assertProductionConfig();
} catch (error) {
  logger.error({ err: sanitize(error.message) }, 'Production configuration rejected');
  process.exit(1);
}

registerHandler('metadata', runIngestionCycle);
registerHandler('search', runSearchCycle);

const running = new Set();
const HANDLER_TIMEOUT_MS = 20_000;

function runBounded(name, fn) {
  if (running.has(name)) return Promise.resolve();
  running.add(name);
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger.error({ handler: name }, 'Worker handler timed out');
      resolve();
    }, HANDLER_TIMEOUT_MS);
  });
  return Promise.race([Promise.resolve().then(fn), timeout])
    .catch((error) => {
      logger.error({ handler: name, err: sanitize(error.message) }, 'Worker handler failed');
    })
    .finally(() => {
      clearTimeout(timer);
      running.delete(name);
    });
}

let lastIncidentScan = 0;

async function scanIncidents() {
  const now = Date.now();
  if (now - lastIncidentScan < 15 * 60 * 1000) return;
  lastIncidentScan = now;
  let databaseStatus = 'ok';
  try {
    await getPool().query('SELECT 1');
  } catch {
    databaseStatus = 'unavailable';
  }
  try {
    await syncOperationalIncidents(databaseStatus);
  } catch (error) {
    logger.error({ err: sanitize(error.message) }, 'Incident scan failed');
  }
}

const timer = setInterval(() => {
  Promise.all([
    runBounded('metadata', runIngestionCycle),
    runBounded('search', runSearchCycle),
    runBounded('media-health', sweepOneMediaReference),
  ])
    .then(() => recordWorkerHeartbeat())
    .then(() => scanIncidents())
    .catch((error) => {
      logger.error({ err: sanitize(error.message) }, 'Worker cycle failed');
    });
}, 5000);
timer.unref();

startWorker().catch(async (error) => {
  logger.error({ err: sanitize(error.message) }, 'Worker runtime failed');
  await closeRedis();
  process.exit(1);
});
