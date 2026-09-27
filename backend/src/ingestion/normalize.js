import { createHash } from 'node:crypto';
import { validateRawMovie } from './validate.js';
import { assertPlainText, canonicalGenre, displayText, matchingKey } from './titles.js';
import { IngestionError } from './errors.js';
import { sourceContentType } from '../catalog/industries.js';

function optionalText(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return assertPlainText(value, label);
}

function releaseParts(releaseDate) {
  if (!releaseDate) return { releaseDate: null, releaseYear: null };
  const [year, month, day] = releaseDate.split('-').map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new IngestionError('MALFORMED_METADATA', 'Release date is not a real calendar date', {
      transient: false,
    });
  }
  if (year < 1888 || year > 2100) {
    throw new IngestionError('MALFORMED_METADATA', 'Release year is outside the catalog range', {
      transient: false,
    });
  }
  return { releaseDate, releaseYear: year };
}

export function normalizeMovie(raw, allowedHosts = []) {
  const value = validateRawMovie(raw, allowedHosts);
  const title = assertPlainText(value.title, 'Title');
  const { releaseDate, releaseYear } = releaseParts(value.releaseDate ?? null);
  const credits = (value.credits ?? []).map((credit) => ({
    name: assertPlainText(credit.name, 'Person name'),
    matchingName: matchingKey(credit.name),
    department: assertPlainText(credit.department, 'Credit department'),
    job: assertPlainText(credit.job, 'Credit job'),
    characterName: optionalText(credit.characterName, 'Character name'),
    billingOrder: credit.billingOrder ?? null,
  }));

  return {
    externalId: value.externalId,
    displayTitle: title,
    matchingTitle: matchingKey(title),
    originalTitle: optionalText(value.originalTitle, 'Original title'),
    synopsis: optionalText(value.synopsis, 'Synopsis'),
    tagline: optionalText(value.tagline, 'Tagline'),
    releaseDate,
    releaseYear,
    runtimeMinutes: value.runtimeMinutes ?? null,
    originalLanguage: value.originalLanguage ?? null,
    genres: (value.genres ?? []).map((name) => canonicalGenre(name)),
    languages: [...new Set(value.languages ?? [])],
    countries: [...new Set(value.countries ?? [])],
    contentType: sourceContentType(value),
    seasons: (value.seasons ?? []).map((season) => ({
      number: season.number,
      title: optionalText(season.title, 'Season title'),
      synopsis: optionalText(season.synopsis, 'Season synopsis'),
      episodes: (season.episodes ?? []).map((episode) => ({
        number: episode.number,
        title: assertPlainText(episode.title, 'Episode title'),
        slug: episode.slug,
        synopsis: optionalText(episode.synopsis, 'Episode synopsis'),
        runtimeMinutes: episode.runtimeMinutes ?? null,
        releaseDate: episode.releaseDate ?? null,
        thumbnailUrl: episode.thumbnailUrl ?? null,
        externalId: episode.externalId ?? null,
      })),
    })),
    alternateTitles: (value.alternateTitles ?? []).map((item) => {
      const alternate = assertPlainText(item.title, 'Alternate title');
      return {
        title: alternate,
        matchingTitle: matchingKey(alternate),
        language: item.language ?? null,
        country: item.country ?? null,
      };
    }),
    credits,
    directors: credits
      .filter((credit) => credit.job.toLowerCase() === 'director')
      .map((credit) => credit.matchingName),
    images: (value.images ?? []).map((image) => ({
      type: image.type,
      url: image.url,
      width: image.width ?? null,
      height: image.height ?? null,
      language: image.language ?? null,
    })),
    videos: (value.videos ?? []).map((video) => ({
      type: video.type,
      url: video.url ?? null,
      externalId: video.externalId ?? null,
      official: video.official ?? false,
      language: video.language ?? null,
    })),
    collection: value.collection
      ? { name: assertPlainText(value.collection.name, 'Collection'), slug: value.collection.slug }
      : null,
    crossIdentifiers: value.crossIdentifiers ?? [],
    sourceUpdatedAt: value.sourceUpdatedAt ?? null,
    sourceUrl: value.sourceUrl ?? null,
  };
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function fingerprintValue(value) {
  return createHash('sha256').update(stable(value)).digest('hex');
}
