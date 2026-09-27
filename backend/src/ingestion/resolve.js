export function classifyCandidate(incoming, candidate) {
  const titleEqual = incoming.matchingTitle === candidate.matchingTitle;
  const signals = {
    titleEqual,
    yearEqual: false,
    runtimeDelta: null,
    directorOverlap: false,
    countryOverlap: false,
  };

  if (!titleEqual) return { confidence: 'low', signals };

  signals.yearEqual = incoming.releaseYear != null && incoming.releaseYear === candidate.releaseYear;
  if (!signals.yearEqual) return { confidence: 'low', signals };

  signals.runtimeDelta = incoming.runtimeMinutes == null || candidate.runtimeMinutes == null
    ? null
    : Math.abs(incoming.runtimeMinutes - candidate.runtimeMinutes);
  const runtimeClose = signals.runtimeDelta === null || signals.runtimeDelta <= 2;
  signals.directorOverlap = incoming.directors.some((name) => candidate.directors.includes(name));
  signals.countryOverlap = incoming.countries.some((code) => candidate.countries.includes(code));

  if (signals.directorOverlap && runtimeClose) return { confidence: 'high', signals };
  return { confidence: 'medium', signals };
}

async function candidateDetails(client, ids) {
  if (ids.length === 0) return new Map();
  const countries = await client.query(
    `SELECT mc.movie_id, c.code
     FROM movie_countries mc
     JOIN countries c ON c.id = mc.country_id
     WHERE mc.movie_id = ANY($1::uuid[])`,
    [ids],
  );
  const directors = await client.query(
    `SELECT cr.movie_id, p.normalized_name
     FROM movie_credits cr
     JOIN people p ON p.id = cr.person_id
     WHERE cr.movie_id = ANY($1::uuid[])
       AND lower(cr.job) = 'director'`,
    [ids],
  );

  const details = new Map(ids.map((id) => [id, { countries: [], directors: [] }]));
  for (const row of countries.rows) details.get(row.movie_id).countries.push(row.code);
  for (const row of directors.rows) details.get(row.movie_id).directors.push(row.normalized_name);
  return details;
}

export async function resolveMovie(client, source, normalized) {
  const own = await client.query(
    `SELECT movie_id
     FROM external_identifiers
     WHERE catalog_source_id = $1 AND external_id = $2`,
    [source.id, normalized.externalId],
  );
  if (own.rowCount) {
    return {
      confidence: 'high',
      reason: 'source-external-id',
      movieId: own.rows[0].movie_id,
      candidates: [],
    };
  }

  for (const cross of normalized.crossIdentifiers) {
    const found = await client.query(
      `SELECT ei.movie_id
       FROM external_identifiers ei
       JOIN catalog_sources s ON s.id = ei.catalog_source_id
       WHERE s.slug = $1
         AND ei.external_id = $2
         AND s.status = 'active'
         AND s.archived_at IS NULL`,
      [cross.source, cross.externalId],
    );
    if (found.rowCount) {
      return {
        confidence: 'high',
        reason: 'cross-source-id',
        movieId: found.rows[0].movie_id,
        candidates: [],
      };
    }
  }

  const found = await client.query(
    `SELECT m.id, m.normalized_title, m.release_year, m.runtime_minutes, m.status
     FROM movies m
     WHERE m.normalized_title = $1
       AND m.archived_at IS NULL
     ORDER BY m.created_at
     LIMIT 20`,
    [normalized.matchingTitle],
  );
  const details = await candidateDetails(client, found.rows.map((row) => row.id));
  const scored = found.rows.map((row) => {
    const extra = details.get(row.id);
    const decision = classifyCandidate(normalized, {
      matchingTitle: row.normalized_title,
      releaseYear: row.release_year,
      runtimeMinutes: row.runtime_minutes,
      directors: extra.directors,
      countries: extra.countries,
    });
    return {
      movieId: row.id,
      status: row.status,
      confidence: row.status === 'archived' ? 'medium' : decision.confidence,
      signals: decision.signals,
    };
  });

  const high = scored.filter((item) => item.confidence === 'high');
  if (high.length === 1) {
    return {
      confidence: 'high',
      reason: 'metadata-match',
      movieId: high[0].movieId,
      candidates: high,
    };
  }
  if (high.length > 1) {
    return { confidence: 'medium', reason: 'ambiguous-match', movieId: null, candidates: high };
  }

  const medium = scored.filter((item) => item.confidence === 'medium');
  if (medium.length > 0) {
    return { confidence: 'medium', reason: 'review-candidate', movieId: null, candidates: medium };
  }

  return { confidence: 'low', reason: 'separate-record', movieId: null, candidates: [] };
}
