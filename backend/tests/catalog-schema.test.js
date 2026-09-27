import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

after(async () => {
  await closePool();
  await closeRedis();
});

test('seeded catalog relationships stay in PostgreSQL', async () => {
  await seed();
  const pool = getPool();

  const graph = await pool.query(`
    SELECT
      m.slug,
      m.normalized_title,
      m.status,
      g.slug AS genre,
      p.name AS person,
      c.job,
      col.slug AS collection,
      cm.sort_order,
      pr.slug AS provider,
      mr.external_reference,
      mr.metadata ->> 'note' AS media_note
    FROM movies m
    JOIN movie_genres mg ON mg.movie_id = m.id
    JOIN genres g ON g.id = mg.genre_id
    JOIN movie_credits c ON c.movie_id = m.id
    JOIN people p ON p.id = c.person_id
    LEFT JOIN collection_movies cm ON cm.movie_id = m.id
    LEFT JOIN collections col ON col.id = cm.collection_id
    LEFT JOIN media_references mr ON mr.movie_id = m.id
    LEFT JOIN providers pr ON pr.id = mr.provider_id
    WHERE m.slug = 'nosferatu'
      AND g.slug = 'horror'
      AND c.job = 'Director'
  `);

  assert.equal(graph.rowCount, 2);
  const example = graph.rows.find((row) => row.provider === 'example-media');
  const development = graph.rows.find((row) => row.provider === 'development-media');
  assert.equal(example.normalized_title, 'nosferatu');
  assert.equal(example.person, 'F. W. Murnau');
  assert.equal(example.collection, 'expressionist-shadows');
  assert.equal(example.sort_order, 1);
  assert.match(example.media_note, /placeholder/);
  assert.equal(development.external_reference, 'dev:ok:nosferatu');

  const sources = await pool.query(`
    SELECT cs.slug
    FROM external_identifiers ei
    JOIN catalog_sources cs ON cs.id = ei.catalog_source_id
    JOIN movies m ON m.id = ei.movie_id
    WHERE m.slug = 'nosferatu'
    ORDER BY cs.slug
  `);
  assert.deepEqual(
    sources.rows.map((row) => row.slug),
    ['development-seed', 'example-metadata'],
  );

  const binaries = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND udt_name = 'bytea'
  `);
  assert.equal(binaries.rowCount, 0);

  const indexes = await pool.query(`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = ANY($1::text[])
  `, [[
    'movies_slug_key',
    'idx_movies_normalized_title',
    'idx_movies_dedup_title_year',
    'idx_movies_status',
    'idx_movies_release_date',
    'external_identifiers_source_external_key',
    'idx_external_identifiers_external_id',
    'idx_people_normalized_name',
  ]]);
  assert.equal(indexes.rowCount, 8);
});

test('catalog constraints protect identity, status, secrets, and deletes', async () => {
  await seed();

  await expectSqlState(
    `INSERT INTO movies (canonical_title, slug) VALUES ('Other', 'nosferatu')`,
    '23505',
  );
  await expectSqlState(
    `INSERT INTO movies (canonical_title, slug, status) VALUES ('Other', 'other-film', 'published')`,
    '23514',
  );
  await expectSqlState(
    `DELETE FROM movies WHERE slug = 'nosferatu'`,
    '23001',
  );
  await expectSqlState(
    `INSERT INTO providers (name, slug, provider_type, configuration)
     VALUES ('Secret', 'secret-provider', 'media', '{"api_key":"nope"}'::jsonb)`,
    '23514',
  );
  await expectSqlState(
    `INSERT INTO external_identifiers (movie_id, catalog_source_id, external_id)
     SELECT id, '77777777-7777-4777-8777-777777777702', 'example-metadata:nosferatu'
     FROM movies
     WHERE slug = 'night-of-the-living-dead'`,
    '23505',
  );
});

async function expectSqlState(sql, code) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await assert.rejects(
      () => client.query(sql),
      (error) => error.code === code,
    );
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}
