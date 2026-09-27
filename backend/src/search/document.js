import { serializeMovieSummary } from '../catalog/serializers.js';

function groupBy(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const list = grouped.get(row.movie_id) || [];
    list.push(row);
    grouped.set(row.movie_id, list);
  }
  return grouped;
}

export async function loadSearchSources(client, ids) {
  if (ids.length === 0) return [];

  const movies = await client.query(
    `SELECT m.id, m.slug, m.canonical_title, m.normalized_title, m.original_title,
            m.synopsis, m.tagline, m.release_date::text AS release_date, m.release_year,
            m.runtime_minutes, m.status, m.adult, m.popularity,
            l.code AS original_language_code, l.name AS original_language_name,
            ct.code AS content_type_code, ct.name AS content_type_name,
            (
              SELECT jsonb_build_object('url', mi.url, 'width', mi.width, 'height', mi.height)
              FROM movie_images mi
              WHERE mi.movie_id = m.id AND mi.image_type = 'poster'
              ORDER BY mi.priority ASC, mi.created_at ASC
              LIMIT 1
            ) AS poster
     FROM movies m
     LEFT JOIN languages l ON l.id = m.original_language_id
     LEFT JOIN content_types ct ON ct.id = m.content_type_id
     WHERE m.id = ANY($1::uuid[])`,
    [ids],
  );
  const genres = await client.query(
    `SELECT mg.movie_id, g.slug, g.name
     FROM movie_genres mg
     JOIN genres g ON g.id = mg.genre_id
     WHERE mg.movie_id = ANY($1::uuid[])`,
    [ids],
  );
  const alternates = await client.query(
    `SELECT movie_id, title, normalized_title
     FROM alternate_titles
     WHERE movie_id = ANY($1::uuid[]) AND status = 'verified'`,
    [ids],
  );
  const people = await client.query(
    `SELECT cr.movie_id, cr.person_id, p.name
     FROM movie_credits cr
     JOIN people p ON p.id = cr.person_id
     WHERE cr.movie_id = ANY($1::uuid[]) AND p.archived_at IS NULL`,
    [ids],
  );
  const languages = await client.query(
    `SELECT ml.movie_id, lang.code
     FROM movie_languages ml
     JOIN languages lang ON lang.id = ml.language_id
     WHERE ml.movie_id = ANY($1::uuid[])`,
    [ids],
  );
  const countries = await client.query(
    `SELECT mc.movie_id, c.code
     FROM movie_countries mc
     JOIN countries c ON c.id = mc.country_id
     WHERE mc.movie_id = ANY($1::uuid[])`,
    [ids],
  );
  const collections = await client.query(
    `SELECT cm.movie_id, col.slug, col.name
     FROM collection_movies cm
     JOIN collections col ON col.id = cm.collection_id
     WHERE cm.movie_id = ANY($1::uuid[]) AND col.archived_at IS NULL`,
    [ids],
  );

  const genreMap = groupBy(genres.rows);
  const alternateMap = groupBy(alternates.rows);
  const peopleMap = groupBy(people.rows);
  const languageMap = groupBy(languages.rows);
  const countryMap = groupBy(countries.rows);
  const collectionMap = new Map(collections.rows.map((row) => [row.movie_id, row]));

  return movies.rows.map((movie) => {
    const movieGenres = (genreMap.get(movie.id) || []).map((row) => ({
      slug: row.slug,
      name: row.name,
    }));
    const movieAlternates = alternateMap.get(movie.id) || [];
    const moviePeople = peopleMap.get(movie.id) || [];
    const languageCodes = [...new Set([
      ...(languageMap.get(movie.id) || []).map((row) => row.code),
      movie.original_language_code,
    ].filter(Boolean))];
    const summary = serializeMovieSummary({ ...movie, genres: movieGenres });
    const alternateKeys = [...new Set(movieAlternates.map((row) => row.normalized_title).filter(Boolean))];
    const titleText = [
      movie.canonical_title,
      movie.original_title,
      ...movieAlternates.map((row) => row.title),
      ...moviePeople.map((row) => row.name),
    ].filter(Boolean).join(' ').slice(0, 4000);
    const peopleText = moviePeople.map((row) => row.name).join(' ').slice(0, 2000);
    const collection = collectionMap.get(movie.id) || null;

    return {
      movieId: movie.id,
      status: movie.status === 'review' || movie.status === 'approved' ? 'draft' : movie.status,
      slug: movie.slug,
      title: movie.canonical_title,
      normalizedTitle: movie.normalized_title,
      alternateKeys,
      titleText,
      peopleText,
      genreSlugs: movieGenres.map((row) => row.slug),
      genreText: movieGenres.map((row) => row.name).join(' '),
      languageCodes,
      countryCodes: (countryMap.get(movie.id) || []).map((row) => row.code),
      contentTypeCode: movie.content_type_code || 'movie',
      personIds: [...new Set(moviePeople.map((row) => row.person_id))],
      collectionSlug: collection?.slug ?? null,
      releaseYear: movie.release_year,
      popularity: movie.popularity,
      document: {
        ...summary,
        collection: collection ? { slug: collection.slug, name: collection.name } : null,
      },
    };
  });
}
