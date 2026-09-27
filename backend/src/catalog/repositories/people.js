import { catalogQuery } from '../db.js';

export async function findPersonById(id) {
  const result = await catalogQuery(
    `SELECT id, name, biography, birth_date::text AS birth_date,
            death_date::text AS death_date, profile_image_url
     FROM people
     WHERE id = $1 AND archived_at IS NULL`,
    [id],
  );
  return result.rows[0] || null;
}

export async function listCreditsForMovie(movieId) {
  const result = await catalogQuery(
    `SELECT c.person_id, p.name AS person_name, c.department, c.job,
            c.character_name, c.billing_order
     FROM movie_credits c
     JOIN people p ON p.id = c.person_id
     WHERE c.movie_id = $1 AND p.archived_at IS NULL
     ORDER BY c.billing_order ASC NULLS LAST, p.name ASC`,
    [movieId],
  );
  return result.rows;
}
