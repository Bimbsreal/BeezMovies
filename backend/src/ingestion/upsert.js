import { PROTECTED_PRIORITY, TRANSFORMATION_VERSION } from './constants.js';
import { IngestionError } from './errors.js';
import { shouldReplace, priorityFor } from './priority.js';
import { qualityIssues } from './quality-gate.js';
import { knownCountryId } from './countries.js';
import { importEpisodeBatch } from '../catalog/episodes.js';
import { contentTypeIdForCode, noteClassification, queueClassification } from '../catalog/industries.js';

async function languageId(client, code) {
  if (!code) return null;
  const row = await client.query(
    `INSERT INTO languages (code, name)
     VALUES ($1, $1)
     ON CONFLICT (code) DO UPDATE SET name = languages.name
     RETURNING id`,
    [code],
  );
  return row.rows[0].id;
}

async function countryId(client, code, review) {
  return knownCountryId(client, code, review);
}

async function genreId(client, genre) {
  const row = await client.query(
    `INSERT INTO genres (name, slug)
     VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = genres.name
     RETURNING id`,
    [genre.name, genre.slug],
  );
  return row.rows[0].id;
}

async function personId(client, name) {
  const found = await client.query(
    `SELECT id
     FROM people
     WHERE normalized_name = catalog_normalize_text($1)
       AND archived_at IS NULL
     ORDER BY created_at
     LIMIT 2`,
    [name],
  );
  if (found.rowCount > 1) return null;
  if (found.rowCount === 1) return found.rows[0].id;
  const created = await client.query(
    'INSERT INTO people (name) VALUES ($1) RETURNING id',
    [name],
  );
  return created.rows[0].id;
}

async function remember(client, movieId, field, source, normalized) {
  await client.query(
    `INSERT INTO catalog_field_provenance (
       movie_id, field_name, catalog_source_id, source_updated_at, transformation_version
     )
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (movie_id, field_name) DO UPDATE SET
       catalog_source_id = EXCLUDED.catalog_source_id,
       source_updated_at = EXCLUDED.source_updated_at,
       transformation_version = EXCLUDED.transformation_version,
       ingested_at = NOW()`,
    [movieId, field, source.id, normalized.sourceUpdatedAt, TRANSFORMATION_VERSION],
  );
}

async function provenanceMap(client, movieId) {
  const rows = await client.query(
    `SELECT p.field_name, p.source_updated_at, p.origin, r.priority, r.field_priority
     FROM catalog_field_provenance p
     LEFT JOIN catalog_source_runtime r ON r.catalog_source_id = p.catalog_source_id
     WHERE p.movie_id = $1`,
    [movieId],
  );
  return new Map(rows.rows.map((row) => [row.field_name, row]));
}

function storedPriority(row, field) {
  if (row?.origin === 'manual') return PROTECTED_PRIORITY + 1;
  if (!row) return null;
  const override = row.field_priority?.[field];
  if (Number.isInteger(override)) return override;
  return Number.isInteger(row.priority) ? row.priority : null;
}

async function updateMovie(client, movieId, source, normalized) {
  const current = await client.query(
    `SELECT m.canonical_title, m.original_title, m.synopsis, m.tagline,
            m.release_date::text AS release_date, m.release_year, m.runtime_minutes, m.slug,
            l.code AS original_language
     FROM movies m
     LEFT JOIN languages l ON l.id = m.original_language_id
     WHERE m.id = $1`,
    [movieId],
  );
  const movie = current.rows[0];
  const known = await provenanceMap(client, movieId);
  const sets = [];
  const params = [movieId];
  const written = [];

  const consider = (field, column, existingValue, incomingValue) => {
    const prior = known.get(field);
    if (!shouldReplace({
      existingValue,
      incomingValue,
      existingPriority: storedPriority(prior, field),
      incomingPriority: priorityFor(source, field),
      existingUpdatedAt: prior?.source_updated_at ?? null,
      incomingUpdatedAt: normalized.sourceUpdatedAt,
    })) return;
    params.push(incomingValue);
    sets.push(`${column} = $${params.length}`);
    written.push(field);
  };

  consider('canonical_title', 'canonical_title', movie.canonical_title, normalized.displayTitle);
  consider('original_title', 'original_title', movie.original_title, normalized.originalTitle);
  consider('synopsis', 'synopsis', movie.synopsis, normalized.synopsis);
  consider('tagline', 'tagline', movie.tagline, normalized.tagline);
  consider('runtime_minutes', 'runtime_minutes', movie.runtime_minutes, normalized.runtimeMinutes);

  const priorRelease = known.get('release_date');
  if (shouldReplace({
    existingValue: movie.release_date,
    incomingValue: normalized.releaseDate,
    existingPriority: storedPriority(priorRelease, 'release_date'),
    incomingPriority: priorityFor(source, 'release_date'),
    existingUpdatedAt: priorRelease?.source_updated_at ?? null,
    incomingUpdatedAt: normalized.sourceUpdatedAt,
  })) {
    params.push(normalized.releaseDate, normalized.releaseYear);
    sets.push(`release_date = $${params.length - 1}`, `release_year = $${params.length}`);
    written.push('release_date', 'release_year');
  }

  if (normalized.originalLanguage && shouldReplace({
    existingValue: movie.original_language,
    incomingValue: normalized.originalLanguage,
    existingPriority: storedPriority(known.get('original_language_id'), 'original_language_id'),
    incomingPriority: priorityFor(source, 'original_language_id'),
    existingUpdatedAt: known.get('original_language_id')?.source_updated_at ?? null,
    incomingUpdatedAt: normalized.sourceUpdatedAt,
  })) {
    const id = await languageId(client, normalized.originalLanguage);
    params.push(id);
    sets.push(`original_language_id = $${params.length}`);
    written.push('original_language_id');
  }

  if (sets.length > 0) {
    await client.query(
      `UPDATE movies SET ${sets.join(', ')} WHERE id = $1`,
      params,
    );
  }
  for (const field of written) {
    await remember(client, movieId, field, source, normalized);
  }
  return movie.slug;
}

async function insertMovie(client, source, normalized) {
  const baseSlug = slugFromTitle(normalized.displayTitle);
  let slug = baseSlug;
  const language = await languageId(client, normalized.originalLanguage);
  const contentTypeId = await contentTypeIdForCode(client, normalized.contentType);

  for (let attempt = 1; attempt <= 20; attempt += 1) {
    await client.query('SAVEPOINT movie_slug');
    try {
      const inserted = await client.query(
        `INSERT INTO movies (
           canonical_title, original_title, slug, synopsis, tagline,
           release_date, release_year, runtime_minutes, status, original_language_id,
           content_type_id
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft', $9, $10)
         RETURNING id, slug`,
        [
          normalized.displayTitle,
          normalized.originalTitle,
          slug,
          normalized.synopsis,
          normalized.tagline,
          normalized.releaseDate,
          normalized.releaseYear,
          normalized.runtimeMinutes,
          language,
          contentTypeId,
        ],
      );
      await client.query('RELEASE SAVEPOINT movie_slug');
      const movie = inserted.rows[0];
      const fields = [
        ['canonical_title', normalized.displayTitle],
        ['original_title', normalized.originalTitle],
        ['synopsis', normalized.synopsis],
        ['tagline', normalized.tagline],
        ['release_date', normalized.releaseDate],
        ['release_year', normalized.releaseYear],
        ['runtime_minutes', normalized.runtimeMinutes],
        ['original_language_id', language],
      ];
      for (const [field, value] of fields) {
        if (value !== null && value !== undefined) {
          await remember(client, movie.id, field, source, normalized);
        }
      }
      return movie;
    } catch (error) {
      await client.query('ROLLBACK TO SAVEPOINT movie_slug');
      if (error.code !== '23505' || error.constraint !== 'movies_slug_key') throw error;
      slug = `${baseSlug}-${attempt + 1}`;
    }
  }

  throw new IngestionError('MALFORMED_METADATA', 'A unique movie slug could not be assigned', {
    transient: false,
  });
}

function slugFromTitle(title) {
  const slug = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new IngestionError('MALFORMED_METADATA', 'Title cannot become a slug', { transient: false });
  }
  return slug;
}

async function syncRelationships(client, movieId, source, normalized) {
  const spoken = new Set(normalized.languages);
  if (normalized.originalLanguage) spoken.add(normalized.originalLanguage);
  for (const code of spoken) {
    const id = await languageId(client, code);
    await client.query(
      `INSERT INTO movie_languages (movie_id, language_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [movieId, id],
    );
  }

  const review = { movieId, sourceSlug: source.slug };
  for (const code of normalized.countries) {
    const id = await countryId(client, code, review);
    if (!id) continue;
    await client.query(
      `INSERT INTO movie_countries (movie_id, country_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [movieId, id],
    );
  }

  for (const genre of normalized.genres) {
    const id = await genreId(client, genre);
    await client.query(
      `INSERT INTO movie_genres (movie_id, genre_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [movieId, id],
    );
  }

  for (const alternate of normalized.alternateTitles) {
    await client.query(
      `INSERT INTO alternate_titles (movie_id, title, language_id, country_id, catalog_source_id, status)
       VALUES ($1, $2, $3, $4, $5, 'review')
       ON CONFLICT ON CONSTRAINT alternate_titles_identity_key DO NOTHING`,
      [
        movieId,
        alternate.title,
        await languageId(client, alternate.language),
        alternate.country ? await countryId(client, alternate.country, review) : null,
        source.id,
      ],
    );
  }

  for (const credit of normalized.credits) {
    const person = await personId(client, credit.name);
    if (!person) continue;
    await client.query(
      `INSERT INTO movie_credits (
         movie_id, person_id, department, job, character_name, billing_order, catalog_source_id
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT ON CONSTRAINT movie_credits_identity_key DO NOTHING`,
      [
        movieId,
        person,
        credit.department,
        credit.job,
        credit.characterName,
        credit.billingOrder,
        source.id,
      ],
    );
  }

  for (const image of normalized.images) {
    await client.query(
      `INSERT INTO movie_images (
         movie_id, image_type, url, width, height, language_id, catalog_source_id, priority
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, 100
       WHERE NOT EXISTS (
         SELECT 1 FROM movie_images WHERE movie_id = $1 AND url = $3
       )`,
      [
        movieId,
        image.type,
        image.url,
        image.width,
        image.height,
        await languageId(client, image.language),
        source.id,
      ],
    );
  }

  const incomingTrailerUrls = normalized.videos
    .filter((video) => video.type === 'trailer' && video.url)
    .map((video) => video.url);
  await client.query(
    `UPDATE movie_videos
     SET available = FALSE
     WHERE movie_id = $1
       AND catalog_source_id = $2
       AND video_type = 'trailer'
       AND url IS NOT NULL
       AND NOT (url = ANY($3::text[]))`,
    [movieId, source.id, incomingTrailerUrls],
  );

  for (const video of normalized.videos) {
    await client.query(
      `INSERT INTO movie_videos (
         movie_id, video_type, url, external_id, official, language_id, catalog_source_id, priority
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, 100
       WHERE NOT EXISTS (
         SELECT 1 FROM movie_videos
         WHERE movie_id = $1 AND url IS NOT DISTINCT FROM $3 AND external_id IS NOT DISTINCT FROM $4
       )`,
      [
        movieId,
        video.type,
        video.url,
        video.externalId,
        video.official,
        await languageId(client, video.language),
        source.id,
      ],
    );
  }

  if (normalized.collection) {
    const membership = await client.query(
      'SELECT collection_id FROM collection_movies WHERE movie_id = $1',
      [movieId],
    );
    if (!membership.rowCount) {
      const collection = await client.query(
        `INSERT INTO collections (name, slug)
         VALUES ($1, $2)
         ON CONFLICT (slug) DO UPDATE SET name = collections.name
         RETURNING id`,
        [normalized.collection.name, normalized.collection.slug],
      );
      const order = await client.query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order
         FROM collection_movies
         WHERE collection_id = $1`,
        [collection.rows[0].id],
      );
      await client.query(
        `INSERT INTO collection_movies (collection_id, movie_id, sort_order)
         VALUES ($1, $2, $3)`,
        [collection.rows[0].id, movieId, order.rows[0].next_order],
      );
    }
  }
}

async function attachIdentifier(client, movieId, source, externalId) {
  const current = await client.query(
    `SELECT external_id
     FROM external_identifiers
     WHERE movie_id = $1 AND catalog_source_id = $2`,
    [movieId, source.id],
  );
  if (current.rowCount && current.rows[0].external_id !== externalId) return;
  if (current.rowCount) {
    await client.query(
      `UPDATE external_identifiers
       SET last_synchronized_at = NOW()
       WHERE movie_id = $1 AND catalog_source_id = $2`,
      [movieId, source.id],
    );
    return;
  }

  const attached = await client.query(
    `INSERT INTO external_identifiers (movie_id, catalog_source_id, external_id, last_synchronized_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (catalog_source_id, external_id) DO UPDATE
     SET last_synchronized_at = NOW()
     WHERE external_identifiers.movie_id = EXCLUDED.movie_id
     RETURNING movie_id`,
    [movieId, source.id, externalId],
  );
  if (!attached.rowCount) {
    throw new IngestionError('MALFORMED_METADATA', 'External id already belongs to another movie', {
      transient: false,
    });
  }
}

async function storeRecord(client, job, source, raw, normalized, fingerprint) {
  await client.query(
    `INSERT INTO ingestion_records (
       job_id, catalog_source_id, external_id, raw_payload, normalized_payload,
       source_url, source_updated_at, transformation_version, fingerprint
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9)`,
    [
      job.id,
      source.id,
      normalized.externalId,
      JSON.stringify(raw),
      JSON.stringify(normalized),
      normalized.sourceUrl,
      normalized.sourceUpdatedAt,
      TRANSFORMATION_VERSION,
      fingerprint,
    ],
  );
}

async function storeReviews(client, job, normalized, candidates) {
  for (const candidate of candidates.slice(0, 5)) {
    await client.query(
      `INSERT INTO ingestion_reviews (
         job_id, candidate_movie_id, external_id, confidence, signals, status
       )
       SELECT $1, $2, $3, 'medium', $4::jsonb, 'pending'
       WHERE NOT EXISTS (
         SELECT 1 FROM ingestion_reviews
         WHERE external_id = $3 AND candidate_movie_id = $2 AND status = 'pending'
       )`,
      [job.id, candidate.movieId, normalized.externalId, JSON.stringify(candidate.signals ?? {})],
    );
  }
}

export async function importMovie(client, {
  job,
  source,
  raw,
  normalized,
  match,
  fingerprint,
}) {
  await storeRecord(client, job, source, raw, normalized, fingerprint);

  if (match.confidence === 'medium') {
    await storeReviews(client, job, normalized, match.candidates);
    return { action: 'review', movieId: null, slug: null, reason: match.reason };
  }

  let movieId = match.movieId;
  let slug;
  let action;
  if (match.confidence === 'high') {
    slug = await updateMovie(client, movieId, source, normalized);
    action = 'updated';
  } else {
    const created = await insertMovie(client, source, normalized);
    movieId = created.id;
    slug = created.slug;
    action = 'created';
  }

  await syncRelationships(client, movieId, source, normalized);
  const resolvedTypeId = await contentTypeIdForCode(client, normalized.contentType);
  await noteClassification(client, movieId, normalized, resolvedTypeId);
  if (action === 'updated' && resolvedTypeId) {
    const current = await client.query('SELECT content_type_id FROM movies WHERE id = $1', [movieId]);
    if (current.rows[0]?.content_type_id && current.rows[0].content_type_id !== resolvedTypeId) {
      await queueClassification(client, {
        movieId,
        field: 'content_type',
        rawValue: normalized.contentType,
        reason: 'conflict',
      });
    }
  }
  await attachIdentifier(client, movieId, source, normalized.externalId);
  await client.query(
    `INSERT INTO search_index_events (event_name, movie_id, slug)
     VALUES ('movie.catalog.updated', $1, $2)`,
    [movieId, slug],
  );

  let episodes = [];
  if (normalized.contentType === 'series' && normalized.seasons?.length) {
    episodes = await importEpisodeBatch(client, movieId, normalized.seasons);
  }

  const issues = action === 'created' ? qualityIssues(normalized) : [];
  if (action === 'created' && normalized.contentType && !resolvedTypeId) issues.push('content_type');
  let publication = action === 'created' ? 'pending_review' : 'unchanged';
  if (action === 'created' && issues.length === 0) {
    await client.query(
      `UPDATE movies SET status = 'active' WHERE id = $1 AND status = 'draft'`,
      [movieId],
    );
    publication = 'published';
  }

  return { action, movieId, slug, reason: match.reason, publication, issues, episodes };
}
