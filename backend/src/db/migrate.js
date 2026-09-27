import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from './pool.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';

const migrationsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/migrations',
);

// Serializes migrate/seed across processes. Locks are session-scoped, so the
// whole run stays on one connection.
const SCHEMA_LOCK = 8142001;

export async function withSchemaLock(work) {
  const client = await getPool().connect();
  let locked = false;

  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    locked = true;
    return await work(client);
  } finally {
    if (locked) {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => {});
    }
    client.release();
  }
}

export async function migrate() {
  return withSchemaLock(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    const applied = await client.query('SELECT name FROM schema_migrations');
    const appliedNames = new Set(applied.rows.map((row) => row.name));
    let count = 0;

    for (const file of files) {
      if (appliedNames.has(file)) continue;

      const sql = await readFile(path.join(migrationsDir, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        count += 1;
        logger.info({ migration: file }, 'Applied migration');
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ migration: file, err: sanitize(error.message) }, 'Migration failed');
        throw error;
      }
    }

    if (count === 0) {
      logger.info('Migrations are up to date');
    }

    return { applied: count };
  });
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  const finish = (code) => {
    process.exit(code);
  };

  migrate()
    .then(async () => {
      await closePool();
      finish(0);
    })
    .catch(async (error) => {
      logger.error({ err: sanitize(error.message) }, 'Migration run failed');
      await closePool();
      finish(1);
    });
}
