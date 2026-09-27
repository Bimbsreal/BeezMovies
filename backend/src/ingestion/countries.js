const ISO_CODE = /^[A-Z]{2}$/;

export async function knownCountryId(client, code, review = {}) {
  if (!code) return null;
  const row = await client.query('SELECT id FROM countries WHERE code = $1', [code]);
  if (row.rowCount) return row.rows[0].id;
  await queueCountryReview(client, {
    rawCode: code,
    movieId: review.movieId || null,
    sourceSlug: review.sourceSlug || null,
    reason: ISO_CODE.test(code) ? 'unknown' : 'invalid',
  });
  return null;
}

export async function queueCountryReview(client, { rawCode, movieId = null, sourceSlug = null, reason }) {
  const storedReason = reason === 'invalid' || reason === 'conflict' ? reason : 'unknown';
  await client.query(
    `INSERT INTO country_reviews (raw_code, movie_id, source_slug, reason)
     SELECT $1, $2, $3, $4
     WHERE NOT EXISTS (
       SELECT 1 FROM country_reviews
       WHERE status = 'pending'
         AND raw_code = $1
         AND reason = $4
         AND movie_id IS NOT DISTINCT FROM $2
     )`,
    [String(rawCode).slice(0, 32), movieId, sourceSlug, storedReason],
  );
}
