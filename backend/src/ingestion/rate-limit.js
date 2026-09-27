import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';

const STALE_IN_FLIGHT_MS = 5 * 60 * 1000;

export async function reserveSource(client, source) {
  const locked = await client.query(
    `SELECT min_interval_ms, concurrency_limit, in_flight, last_request_at
     FROM catalog_source_runtime
     WHERE catalog_source_id = $1
     FOR UPDATE`,
    [source.id],
  );
  const row = locked.rows[0];
  const lastRequest = row.last_request_at ? new Date(row.last_request_at).getTime() : 0;
  const age = lastRequest ? Date.now() - lastRequest : STALE_IN_FLIGHT_MS + 1;
  let inFlight = row.in_flight;
  if (age > STALE_IN_FLIGHT_MS) inFlight = 0;

  const minIntervalMs = row.min_interval_ms;
  if (minIntervalMs > 0 && lastRequest && age < minIntervalMs) {
    return { ok: false, waitMs: minIntervalMs - age };
  }
  if (inFlight >= row.concurrency_limit) {
    return { ok: false, waitMs: Math.max(minIntervalMs, 1000) };
  }

  await client.query(
    `UPDATE catalog_source_runtime
     SET in_flight = $2, last_request_at = NOW()
     WHERE catalog_source_id = $1`,
    [source.id, inFlight + 1],
  );
  return { ok: true, waitMs: 0 };
}

export async function releaseSource(sourceId) {
  await getPool().query(
    `UPDATE catalog_source_runtime
     SET in_flight = GREATEST(in_flight - 1, 0)
     WHERE catalog_source_id = $1`,
    [sourceId],
  );
}

export async function withReservedSource(source, work) {
  const gate = await withTransaction(async (client) => reserveSource(client, source));
  if (!gate.ok) return gate;
  try {
    return { ok: true, value: await work() };
  } finally {
    await releaseSource(source.id);
  }
}
