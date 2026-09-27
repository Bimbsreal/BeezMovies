import { getPool } from '../db/pool.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';

const DEFAULTS = {
  maintenance: {
    enabled: false,
    message: 'BeezMovies is temporarily unavailable while maintenance finishes.',
  },
  feature_flags: {
    ingestion: true,
    searchIndexing: true,
    advertising: true,
  },
  backup_status: {
    lastSuccessAt: null,
    lastFailureAt: null,
    maxAgeHours: 26,
    sizeBytes: null,
  },
};

let cache = { at: 0, rows: null };

export function clearOperationsCache() {
  cache = { at: 0, rows: null };
}

async function loadRows() {
  if (cache.rows && Date.now() - cache.at < 2000) return cache.rows;
  try {
    const result = await getPool().query(
      `SELECT key, value FROM platform_settings
       WHERE key IN ('maintenance', 'feature_flags', 'backup_status')`,
    );
    cache = { at: Date.now(), rows: result.rows };
    return result.rows;
  } catch (error) {
    logger.warn({ err: sanitize(error.message), code: error.code }, 'Operations settings unavailable');
    return [];
  }
}

function valueFor(rows, key) {
  const found = rows.find((row) => row.key === key);
  return { ...DEFAULTS[key], ...(found?.value || {}) };
}

export async function maintenanceState() {
  const rows = await loadRows();
  const state = valueFor(rows, 'maintenance');
  return {
    enabled: state.enabled === true,
    message: String(state.message || DEFAULTS.maintenance.message).slice(0, 180),
  };
}

export function blocksPublicRequest(path, enabled) {
  if (!enabled) return false;
  return !/^\/(?:health|ready|auth|admin)(?:\/|$)/.test(path);
}

export async function flagEnabled(name) {
  const rows = await loadRows();
  const flags = valueFor(rows, 'feature_flags');
  if (name === 'advertising') return flags.advertising === true;
  if (name === 'ingestion') return flags.ingestion !== false;
  if (name === 'searchIndexing') return flags.searchIndexing !== false;
  return false;
}

export async function backupState() {
  const rows = await loadRows();
  return valueFor(rows, 'backup_status');
}
