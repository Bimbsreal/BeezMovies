import { getPool } from '../db/pool.js';
import { FAILURES_DEGRADED, FAILURES_DISABLED } from './constants.js';

export async function recordSourceSuccess(sourceId, latencyMs) {
  await getPool().query(
    `UPDATE catalog_source_runtime
     SET success_count = success_count + 1,
         consecutive_failures = 0,
         total_latency_ms = total_latency_ms + $2,
         last_success_at = NOW(),
         last_error_code = NULL,
         health_status = 'healthy',
         disabled_until = NULL
     WHERE catalog_source_id = $1`,
    [sourceId, Math.max(0, Math.round(latencyMs))],
  );
  await getPool().query(
    `UPDATE catalog_sources
     SET last_synchronized_at = NOW()
     WHERE id = $1`,
    [sourceId],
  );
}

export async function recordSourceFailure(sourceId, code, { transient }) {
  if (!transient) {
    await getPool().query(
      `UPDATE catalog_source_runtime
       SET error_count = error_count + 1,
           last_failure_at = NOW(),
           last_error_code = $2
       WHERE catalog_source_id = $1`,
      [sourceId, code],
    );
    return;
  }

  await getPool().query(
    `UPDATE catalog_source_runtime
     SET error_count = error_count + 1,
         consecutive_failures = consecutive_failures + 1,
         last_failure_at = NOW(),
         last_error_code = $2,
         health_status = CASE
           WHEN consecutive_failures + 1 >= $3 THEN 'disabled'
           WHEN consecutive_failures + 1 >= $4 THEN 'degraded'
           ELSE health_status
         END,
         disabled_until = CASE
           WHEN consecutive_failures + 1 >= $3 THEN NOW() + INTERVAL '15 minutes'
           ELSE disabled_until
         END
     WHERE catalog_source_id = $1`,
    [sourceId, code, FAILURES_DISABLED, FAILURES_DEGRADED],
  );
}

export async function releaseDisabledSources() {
  await getPool().query(
    `UPDATE catalog_source_runtime
     SET health_status = 'degraded'
     WHERE health_status = 'disabled'
       AND disabled_until IS NOT NULL
       AND disabled_until <= NOW()`,
  );
}
