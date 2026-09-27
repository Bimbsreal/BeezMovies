import { getPool } from '../db/pool.js';
import { withTransaction } from '../db/transaction.js';
import { logger } from '../logger/index.js';
import { SEARCH_BATCH_SIZE, SEARCH_EVENT_ATTEMPTS } from './constants.js';
import { invalidateSearchCache } from './cache.js';
import { loadSearchSources } from './document.js';

async function writeDocuments(client, version, sources) {
  for (const source of sources) {
    await client.query(
      `INSERT INTO search_documents (
         index_version, movie_id, status, slug, title, normalized_title, alternate_keys,
         title_text, people_text, genre_slugs, language_codes, country_codes, person_ids,
         collection_slug, release_year, popularity, search_vector, document, content_type_code
       )
       VALUES (
         $1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10::text[], $11::text[], $12::text[],
         $13::uuid[], $14, $15, $16,
         setweight(to_tsvector('simple', coalesce($5, '')), 'A')
           || setweight(to_tsvector('simple', coalesce($8, '')), 'A')
           || setweight(to_tsvector('simple', coalesce($9, '')), 'B')
           || setweight(to_tsvector('simple', coalesce($17, '')), 'C')
           || setweight(to_tsvector('simple', coalesce($18, '')), 'C')
           || setweight(to_tsvector('simple', coalesce($19, '')), 'B'),
         $20::jsonb,
         $21
       )
       ON CONFLICT (index_version, movie_id) DO UPDATE SET
         status = EXCLUDED.status,
         slug = EXCLUDED.slug,
         title = EXCLUDED.title,
         normalized_title = EXCLUDED.normalized_title,
         alternate_keys = EXCLUDED.alternate_keys,
         title_text = EXCLUDED.title_text,
         people_text = EXCLUDED.people_text,
         genre_slugs = EXCLUDED.genre_slugs,
         language_codes = EXCLUDED.language_codes,
         country_codes = EXCLUDED.country_codes,
         person_ids = EXCLUDED.person_ids,
         collection_slug = EXCLUDED.collection_slug,
         release_year = EXCLUDED.release_year,
         popularity = EXCLUDED.popularity,
         search_vector = EXCLUDED.search_vector,
         document = EXCLUDED.document,
         content_type_code = EXCLUDED.content_type_code,
         built_at = NOW()`,
      [
        version,
        source.movieId,
        source.status,
        source.slug,
        source.title,
        source.normalizedTitle,
        source.alternateKeys,
        source.titleText,
        source.peopleText,
        source.genreSlugs,
        source.languageCodes,
        source.countryCodes,
        source.personIds,
        source.collectionSlug,
        source.releaseYear,
        source.popularity,
        source.document.synopsis,
        source.document.tagline,
        source.genreText,
        JSON.stringify(source.document),
        source.contentTypeCode || 'movie',
      ],
    );
  }
}

export async function activeSearchVersions() {
  const rows = await getPool().query(
    `SELECT version, status FROM search_index_versions
     WHERE status IN ('active', 'building')
     ORDER BY version`,
  );
  return rows.rows;
}

export async function upsertMovieDocuments(movieIds) {
  const versions = await activeSearchVersions();
  if (versions.length === 0 || movieIds.length === 0) return 0;
  const unique = [...new Set(movieIds)];
  await withTransaction(async (client) => {
    const sources = await loadSearchSources(client, unique);
    for (const version of versions) {
      await writeDocuments(client, version.version, sources);
    }
  });
  invalidateSearchCache();
  return unique.length;
}

export async function removeMovieDocuments(movieId) {
  await getPool().query('DELETE FROM search_documents WHERE movie_id = $1', [movieId]);
  invalidateSearchCache();
}

async function openBuild() {
  const existing = await getPool().query(
    `SELECT version FROM search_index_versions WHERE status = 'building'`,
  );
  if (existing.rowCount) return { version: existing.rows[0].version, created: false };
  const created = await getPool().query(
    `INSERT INTO search_index_versions (status) VALUES ('building') RETURNING version`,
  );
  return { version: created.rows[0].version, created: true };
}

export async function rebuildSearchIndex({ batchSize = SEARCH_BATCH_SIZE } = {}) {
  const build = await openBuild();
  const version = build.version;
  let processed = 0;

  try {
    let offset = 0;
    for (;;) {
      const page = await getPool().query(
        `SELECT id FROM movies ORDER BY created_at, id LIMIT $1 OFFSET $2`,
        [batchSize, offset],
      );
      if (!page.rowCount) break;
      const ids = page.rows.map((row) => row.id);
      await withTransaction(async (client) => {
        const sources = await loadSearchSources(client, ids);
        await writeDocuments(client, version, sources);
      });
      processed += ids.length;
      offset += ids.length;
      if (page.rowCount < batchSize) break;
    }

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE search_index_versions
         SET status = 'retired'
         WHERE status = 'active' AND version <> $1`,
        [version],
      );
      await client.query(
        `UPDATE search_index_versions
         SET status = 'active', activated_at = NOW(), document_count = $2, error_code = NULL
         WHERE version = $1`,
        [version, processed],
      );
      await client.query(
        `DELETE FROM search_documents
         WHERE index_version IN (
           SELECT version FROM search_index_versions WHERE status = 'retired'
         )`,
      );
      await client.query(`DELETE FROM search_index_versions WHERE status = 'retired'`);
    });
    invalidateSearchCache();
    logger.info({ event: 'SEARCH_INDEX_REBUILT', version, processed }, 'SEARCH_INDEX_REBUILT');
    return { version, processed };
  } catch (error) {
    await getPool().query(
      `UPDATE search_index_versions SET status = 'failed', error_code = 'INDEX_FAILED' WHERE version = $1 AND status = 'building'`,
      [version],
    );
    logger.error({ event: 'SEARCH_INDEX_FAILED', code: error.code || 'INDEX_FAILED' }, 'SEARCH_INDEX_FAILED');
    throw error;
  }
}

export async function consumeSearchEvents({ limit = 25 } = {}) {
  const versions = await activeSearchVersions();
  const events = await getPool().query(
    `SELECT id, event_name, movie_id
     FROM search_index_events
     WHERE consumed_at IS NULL AND attempt_count < $2
     ORDER BY occurred_at
     LIMIT $1`,
    [limit, SEARCH_EVENT_ATTEMPTS],
  );
  let processed = 0;

  for (const event of events.rows) {
    try {
      if (versions.length === 0 && event.event_name !== 'movie.catalog.deleted') {
        break;
      }
      if (event.event_name === 'movie.catalog.deleted') {
        await removeMovieDocuments(event.movie_id);
      } else {
        await upsertMovieDocuments([event.movie_id]);
      }
      await getPool().query(
        `UPDATE search_index_events
         SET consumed_at = NOW(), last_error_code = NULL
         WHERE id = $1`,
        [event.id],
      );
      processed += 1;
    } catch (error) {
      const failed = await getPool().query(
        `UPDATE search_index_events
         SET attempt_count = attempt_count + 1,
             last_error_code = 'INDEX_FAILED',
             consumed_at = CASE
               WHEN attempt_count + 1 >= $2 THEN NOW()
               ELSE consumed_at
             END
         WHERE id = $1
         RETURNING attempt_count`,
        [event.id, SEARCH_EVENT_ATTEMPTS],
      );
      logger.error({
        event: 'SEARCH_INDEX_FAILED',
        eventId: event.id,
        attempt: failed.rows[0]?.attempt_count,
        code: error.code || 'INDEX_FAILED',
      }, 'SEARCH_INDEX_FAILED');
    }
  }

  return processed;
}

export async function enqueueReindex() {
  const existing = await getPool().query(
    `SELECT id, status, index_version, processed, created_at
     FROM search_reindex_jobs
     WHERE status = 'pending'
     LIMIT 1`,
  );
  if (existing.rowCount) return { job: existing.rows[0], created: false };
  try {
    const created = await getPool().query(
      `INSERT INTO search_reindex_jobs (status) VALUES ('pending') RETURNING id, status, index_version, processed, created_at`,
    );
    return { job: created.rows[0], created: true };
  } catch (error) {
    if (error.code !== '23505') throw error;
    const again = await getPool().query(
      `SELECT id, status, index_version, processed, created_at
       FROM search_reindex_jobs WHERE status = 'pending' LIMIT 1`,
    );
    return { job: again.rows[0], created: false };
  }
}

export async function runPendingReindex() {
  const claimedId = await withTransaction(async (client) => {
    const selected = await client.query(
      `SELECT id
       FROM search_reindex_jobs
       WHERE status = 'pending'
       ORDER BY created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1`,
    );
    if (!selected.rowCount) return null;
    await client.query(
      `UPDATE search_reindex_jobs
       SET status = 'processing', started_at = NOW()
       WHERE id = $1`,
      [selected.rows[0].id],
    );
    return selected.rows[0].id;
  });
  if (!claimedId) return null;
  try {
    const result = await rebuildSearchIndex();
    await getPool().query(
      `UPDATE search_reindex_jobs
       SET status = 'completed', index_version = $2, processed = $3, completed_at = NOW()
       WHERE id = $1`,
      [claimedId, result.version, result.processed],
    );
    return result;
  } catch (error) {
    await getPool().query(
      `UPDATE search_reindex_jobs
       SET status = 'failed', error_code = 'INDEX_FAILED', completed_at = NOW()
       WHERE id = $1`,
      [claimedId],
    );
    logger.error({ event: 'SEARCH_INDEX_FAILED', jobId: claimedId, code: error.code || 'INDEX_FAILED' }, 'SEARCH_INDEX_FAILED');
    return { failed: true };
  }
}
