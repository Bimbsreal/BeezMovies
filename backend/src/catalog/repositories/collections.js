import { catalogQuery } from '../db.js';
import { LIST_CAP } from '../constants.js';

export async function listCollections() {
  const result = await catalogQuery(
    `SELECT col.slug, col.name, col.description, col.poster_url,
            COUNT(m.id)::int AS movie_count
     FROM collections col
     LEFT JOIN collection_movies cm ON cm.collection_id = col.id
     LEFT JOIN movies m ON m.id = cm.movie_id AND m.status = 'active'
     WHERE col.archived_at IS NULL
     GROUP BY col.id
     ORDER BY col.name ASC
     LIMIT $1`,
    [LIST_CAP],
  );
  return result.rows;
}

export async function findCollectionBySlug(slug) {
  const result = await catalogQuery(
    `SELECT id, slug, name, description, poster_url
     FROM collections
     WHERE slug = $1 AND archived_at IS NULL`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function findCollectionForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT col.slug, col.name, cm.sort_order
     FROM collection_movies cm
     JOIN collections col ON col.id = cm.collection_id
     WHERE cm.movie_id = $1 AND col.archived_at IS NULL`,
    [movieId],
  );
  const row = result.rows[0];
  if (!row) return null;
  return { slug: row.slug, name: row.name, sortOrder: row.sort_order };
}
