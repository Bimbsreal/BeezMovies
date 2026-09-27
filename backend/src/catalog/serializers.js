import { publicTrailerUrl } from '../media/trailers.js';

function dateText(value) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function numberOrNull(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function language(code, name) {
  if (!code) return null;
  return { code, name };
}

export function serializeGenre(row) {
  return {
    slug: row.slug,
    name: row.name,
    ...(row.movie_count === undefined ? {} : { movieCount: Number(row.movie_count) }),
  };
}

export function serializeCollectionSummary(row) {
  return {
    slug: row.slug,
    name: row.name,
    description: row.description,
    posterUrl: row.poster_url,
    ...(row.movie_count === undefined ? {} : { movieCount: Number(row.movie_count) }),
  };
}

export function serializePerson(row) {
  return {
    id: row.id,
    name: row.name,
    biography: row.biography,
    birthDate: dateText(row.birth_date),
    deathDate: dateText(row.death_date),
    profileImageUrl: row.profile_image_url,
  };
}

export function serializeMovieSummary(row) {
  const poster = row.poster?.url ? {
    url: row.poster.url,
    width: row.poster.width ?? null,
    height: row.poster.height ?? null,
  } : null;
  const title = row.canonical_title;
  const description = row.synopsis || row.tagline || null;

  return {
    slug: row.slug,
    title,
    originalTitle: row.original_title,
    synopsis: row.synopsis,
    tagline: row.tagline,
    releaseDate: dateText(row.release_date),
    releaseYear: row.release_year,
    runtimeMinutes: row.runtime_minutes,
    status: row.status,
    adult: row.adult,
    popularity: numberOrNull(row.popularity),
    originalLanguage: language(row.original_language_code, row.original_language_name),
    contentType: row.content_type_code ? { code: row.content_type_code, name: row.content_type_name } : null,
    genres: [...(row.genres || [])].sort((left, right) => left.slug.localeCompare(right.slug)),
    poster,
    seo: {
      title,
      description,
      path: `/movie/${row.slug}`,
      image: poster?.url ?? null,
    },
  };
}

export function serializeMovieDetail(row, related, { includeId = false } = {}) {
  const summary = serializeMovieSummary({
    ...row,
    genres: related.genres,
    poster: related.images.find((image) => image.image_type === 'poster') || null,
  });

  return {
    ...(includeId ? { id: row.id } : {}),
    ...summary,
    languages: related.languages,
    countries: related.countries,
    industryLabels: related.industryLabels || [],
    alternateTitles: related.alternateTitles,
    synopses: related.synopses || [],
    images: related.images.map(serializeImage),
    trailers: related.videos.map(serializeVideo),
    credits: related.credits.map(serializeCredit),
    collection: related.collection,
    externalIdentifiers: related.externalIdentifiers,
    ratings: related.ratings,
    media: related.media,
    mediaState: related.mediaState || { state: 'MEDIA_UNAVAILABLE', countries: null },
    tags: related.tags,
  };
}

function publicImageUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    if (path.endsWith('.svg') || path.endsWith('.svgz')) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function serializeImage(row) {
  return {
    type: row.image_type,
    url: publicImageUrl(row.url),
    width: row.width,
    height: row.height,
    language: language(row.language_code, row.language_name),
    priority: row.priority,
  };
}

function serializeVideo(row) {
  return {
    type: row.video_type,
    url: publicTrailerUrl(row.url),
    language: language(row.language_code, row.language_name),
    official: row.official,
    durationSeconds: row.duration_seconds,
  };
}

function serializeCredit(row) {
  return {
    personId: row.person_id,
    name: row.person_name,
    department: row.department,
    job: row.job,
    characterName: row.character_name,
    billingOrder: row.billing_order,
  };
}

export function pagination(page, limit, total) {
  return {
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit),
  };
}
