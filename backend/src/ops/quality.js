import { getPool } from '../db/pool.js';
import { enqueueJob } from '../ingestion/jobs.js';

const LIMIT = 10;

export async function queueCatalogCorrections() {
  const rows = await getPool().query(
    `SELECT s.id, s.slug, ei.external_id
     FROM movies m
     JOIN external_identifiers ei ON ei.movie_id = m.id
     JOIN catalog_sources s ON s.id = ei.catalog_source_id
     WHERE m.status = 'active'
       AND m.archived_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM movie_images i
         WHERE i.movie_id = m.id AND i.image_type = 'poster'
       )
     ORDER BY m.updated_at ASC
     LIMIT $1`,
    [LIMIT],
  );
  let queued = 0;
  let skipped = 0;
  for (const row of rows.rows) {
    const result = await enqueueJob({
      source: { id: row.id, slug: row.slug },
      externalId: row.external_id,
      operation: 'refresh',
      jobType: 'metadata:upsert',
      payload: { origin: 'maintenance', discovery: 'MISSING_ARTWORK' },
    });
    if (result.created) queued += 1;
    else skipped += 1;
  }
  return { examined: rows.rowCount, queued, skipped, limit: LIMIT };
}
