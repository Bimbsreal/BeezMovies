import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';
import { closePool } from './pool.js';
import { migrate, withSchemaLock } from './migrate.js';
import { hashPassword } from '../auth/passwords.js';
import { assertDevSeedAllowed, databaseNameFromUrl } from '../config/release.js';

export const DEV_ADMIN_EMAIL = 'admin@beezmovies.local';
export const DEV_ADMIN_PASSWORD = 'BeezLocalAdmin1';
const DEV_ADMIN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';

const seedsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../database/seeds',
);

export async function seed() {
  assertDevSeedAllowed({ nodeEnv: config.env, databaseUrl: config.databaseUrl });

  await migrate();
  const adminPasswordHash = await hashPassword(DEV_ADMIN_PASSWORD);

  return withSchemaLock(async (client) => {
    const files = (await readdir(seedsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    let count = 0;

    for (const file of files) {
      const sql = await readFile(path.join(seedsDir, file), 'utf8');

      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        count += 1;
        logger.info({ seed: file }, 'Applied development seed');
      } catch (error) {
        await client.query('ROLLBACK');
        logger.error({ seed: file, err: sanitize(error.message) }, 'Development seed failed');
        throw error;
      }
    }

    await seedDevAdmin(client, adminPasswordHash);
    return { applied: count };
  });
}

export async function seedStagingCatalog() {
  if (process.env.BEEZ_SEED_TARGET !== 'staging') {
    throw new Error('Refusing staging seed without BEEZ_SEED_TARGET=staging');
  }
  if (databaseNameFromUrl(config.databaseUrl) !== 'beezmovies_staging') {
    throw new Error('Refusing staging seed unless the database name is beezmovies_staging');
  }

  await migrate();
  return withSchemaLock(async (client) => {
    const sql = await readFile(path.join(seedsDir, '001_catalog_dev.sql'), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    return { applied: 1, admin: false };
  });
}

export function refuseProductionSeed() {
  throw new Error('Production has no seed. Catalog rows come from authorized ingestion.');
}

async function seedDevAdmin(client, passwordHash) {
  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO users (
         id, email, normalized_email, password_hash, display_name, account_status, email_verified_at
       ) VALUES ($1, $2, $2, $3, 'Local Admin', 'active', NOW())
       ON CONFLICT (normalized_email) WHERE deleted_at IS NULL
       DO UPDATE SET
         password_hash = EXCLUDED.password_hash,
         account_status = 'active',
         email_verified_at = COALESCE(users.email_verified_at, NOW())`,
      [DEV_ADMIN_ID, DEV_ADMIN_EMAIL, passwordHash],
    );
    await client.query(
      `INSERT INTO user_roles (user_id, role_id)
       SELECT u.id, r.id
       FROM users u
       JOIN roles r ON r.slug IN ('user', 'admin', 'super_admin')
       WHERE u.normalized_email = $1 AND u.deleted_at IS NULL
       ON CONFLICT DO NOTHING`,
      [DEV_ADMIN_EMAIL],
    );
    await client.query('COMMIT');
    logger.info({ email: DEV_ADMIN_EMAIL }, 'Development admin is ready');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const isDirectRun = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  seed()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error({ err: sanitize(error.message) }, 'Seed run failed');
      await closePool();
      process.exit(1);
    });
}
