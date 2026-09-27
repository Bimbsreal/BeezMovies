import { pruneIngestionHistory } from './jobs.js';
import { enqueueDueSchedules } from './scheduler.js';
import { runAvailableJobs } from './pipeline.js';
import { logIngestion } from './log.js';
import { sanitize } from '../errors/sanitize.js';
import { flagEnabled } from '../ops/flags.js';

const SCHEDULE_GAP_MS = 15 * 60 * 1000;
let lastSchedule = 0;

export async function runScheduleTick(now = Date.now()) {
  if (now - lastSchedule < SCHEDULE_GAP_MS) return 0;
  lastSchedule = now;
  await pruneIngestionHistory();
  return enqueueDueSchedules(new Date(now));
}

export async function runIngestionCycle() {
  try {
    if (!(await flagEnabled('ingestion'))) return;
    await runScheduleTick();
    await runAvailableJobs();
  } catch (error) {
    logIngestion('INGESTION_FAILED', { code: sanitize(error.code || error.message) });
  }
}
