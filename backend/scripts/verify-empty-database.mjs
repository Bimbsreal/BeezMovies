import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const THROWWAY = 'beezmovies_rc_verify';
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function redact(value) {
  return String(value).replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted]');
}

function assertThrowaway(name) {
  if (name !== THROWWAY) throw new Error('Refusing to touch a schema other than the throwaway');
}

dotenv.config({ path: path.join(backendRoot, '.env'), quiet: true });

const source = process.env.DATABASE_URL;
if (!source) {
  console.error('DATABASE_URL is not configured');
  process.exit(1);
}

const sourceUrl = new URL(source);
const currentName = sourceUrl.pathname.replace(/^\//, '');
if (currentName !== 'beezmovies') {
  console.error('Refusing to run unless DATABASE_URL points at the local beezmovies database');
  process.exit(1);
}

assertThrowaway(THROWWAY);
const admin = new pg.Client({ connectionString: source });

async function publicFingerprint(client) {
  const movies = await client.query(
    `SELECT COUNT(*)::int AS count, COALESCE(MAX(updated_at)::text, '') AS updated
     FROM public.movies`,
  );
  const migrations = await client.query('SELECT COUNT(*)::int AS count FROM public.schema_migrations');
  return `${movies.rows[0].count}:${movies.rows[0].updated}:${migrations.rows[0].count}`;
}

async function dropThrowaway(client) {
  assertThrowaway(THROWWAY);
  await client.query(`DROP SCHEMA IF EXISTS ${THROWWAY} CASCADE`);
}

try {
  await admin.connect();
  const before = await publicFingerprint(admin);
  await dropThrowaway(admin);
  await admin.query(`CREATE SCHEMA ${THROWWAY}`);
  console.log(`created_schema=${THROWWAY}`);

  const verifyUrl = new URL(source);
  verifyUrl.searchParams.set('options', `-csearch_path=${THROWWAY},public`);
  process.env.DATABASE_URL = verifyUrl.toString();
  process.env.NODE_ENV = 'development';

  const { seed } = await import('../src/db/seed.js');
  const { migrate } = await import('../src/db/migrate.js');
  const { getPool, closePool } = await import('../src/db/pool.js');
  const first = await migrate();
  const located = await getPool().query(
    `SELECT current_schema() AS schema, to_regclass($1) AS movies`,
    [`${THROWWAY}.movies`],
  );
  if (located.rows[0].schema !== THROWWAY || !located.rows[0].movies) {
    throw new Error('Migrations did not land in the throwaway schema');
  }
  const midway = await publicFingerprint(admin);
  if (before !== midway) throw new Error('Development catalog changed while applying migrations');
  const seeded = await seed();
  const repeated = await migrate();
  const migrations = await getPool().query('SELECT COUNT(*)::int AS count FROM schema_migrations');
  const movies = await getPool().query("SELECT COUNT(*)::int AS count FROM movies WHERE status = 'active'");
  const foundation = await getPool().query("SELECT value FROM app_meta WHERE key = 'foundation'");
  if (migrations.rows[0].count < 11) throw new Error('Expected every migration to apply');
  if (movies.rows[0].count < 1) throw new Error('Expected development seed movies');
  if (foundation.rows[0]?.value !== 'ready') throw new Error('Expected foundation readiness');
  if (repeated.applied !== 0) throw new Error('Second migration run was not idempotent');

  const { createApp } = await import('../src/app.js');
  const request = (await import('supertest')).default;
  const app = createApp();
  const health = await request(app).get('/api/v1/health');
  const ready = await request(app).get('/api/v1/ready');
  const list = await request(app).get('/api/v1/movies');
  if (health.status !== 200 || health.body.release) throw new Error('Health check failed on the throwaway schema');
  if (ready.status !== 200 || ready.body.checks?.postgres?.status !== 'ok') {
    throw new Error('Readiness failed on the throwaway schema');
  }
  if (list.status !== 200 || !Array.isArray(list.body.data) || list.body.data.length < 1) {
    throw new Error('Catalog did not start after seed');
  }
  await closePool();

  const after = await publicFingerprint(admin);
  if (before !== after) throw new Error('Development catalog changed during throwaway verification');
  console.log(`migrations=${migrations.rows[0].count} first_migrate=${first.applied} seed_files=${seeded.applied} second_migrate=${repeated.applied} health=${health.status} ready=${ready.status} movies=${list.status} public_unchanged=yes`);
} catch (error) {
  console.error(`empty-database verification failed: ${redact(error.message)}`);
  process.exitCode = 1;
} finally {
  try {
    const { closePool } = await import('../src/db/pool.js');
    await closePool();
  } catch { /* pool may already be closed */ }
  try {
    await dropThrowaway(admin);
    console.log(`dropped_schema=${THROWWAY}`);
  } catch (error) {
    console.error(`throwaway cleanup failed: ${redact(error.message)}`);
    process.exitCode = 1;
  }
  await admin.end();
}

process.exit(process.exitCode || 0);
