import { z } from 'zod';
import { IngestionError } from './errors.js';
import { assertAllowedHost } from './security.js';

const languageCode = z.string().regex(/^[a-z]{2,3}$/);
const countryCode = z.string().regex(/^[A-Z]{2}$/);
const externalId = z.string().regex(/^[A-Za-z0-9:._-]{1,200}$/);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function httpsReference(allowedHosts) {
  return z.string().max(2048).superRefine((value, ctx) => {
    try {
      assertAllowedHost(value, allowedHosts);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error.message });
    }
  });
}

export function rawMovieSchema(allowedHosts = []) {
  const url = httpsReference(allowedHosts);
  return z.object({
    externalId,
    title: z.string().min(1).max(300),
    originalTitle: z.string().max(300).nullable().optional(),
    synopsis: z.string().max(5000).nullable().optional(),
    tagline: z.string().max(300).nullable().optional(),
    releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    runtimeMinutes: z.number().int().positive().max(2000).nullable().optional(),
    originalLanguage: languageCode.nullable().optional(),
    genres: z.array(z.string().min(1).max(80)).max(20).optional(),
    languages: z.array(languageCode).max(20).optional(),
    countries: z.array(countryCode).max(20).optional(),
    contentType: z.string().regex(/^[a-z_]{1,32}$/).optional(),
    seasons: z.array(z.object({
      number: z.number().int().min(1).max(200),
      title: z.string().max(200).nullable().optional(),
      synopsis: z.string().max(4000).nullable().optional(),
      episodes: z.array(z.object({
        number: z.number().int().min(1).max(500),
        title: z.string().min(1).max(200),
        slug,
        synopsis: z.string().max(4000).nullable().optional(),
        runtimeMinutes: z.number().int().positive().max(2000).nullable().optional(),
        releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
        thumbnailUrl: z.string().max(2048).nullable().optional(),
        externalId: externalId.nullable().optional(),
      }).strict()).max(50).optional(),
    }).strict()).max(20).optional(),
    alternateTitles: z.array(z.object({
      title: z.string().min(1).max(300),
      language: languageCode.nullable().optional(),
      country: countryCode.nullable().optional(),
    }).strict()).max(30).optional(),
    credits: z.array(z.object({
      name: z.string().min(1).max(200),
      department: z.string().min(1).max(80),
      job: z.string().min(1).max(80),
      characterName: z.string().max(200).nullable().optional(),
      billingOrder: z.number().int().min(0).max(1000).nullable().optional(),
    }).strict()).max(100).optional(),
    images: z.array(z.object({
      type: z.enum(['poster', 'backdrop', 'logo', 'still', 'thumbnail']),
      url,
      width: z.number().int().positive().max(10000).nullable().optional(),
      height: z.number().int().positive().max(10000).nullable().optional(),
      language: languageCode.nullable().optional(),
    }).strict()).max(20).optional(),
    videos: z.array(z.object({
      type: z.enum(['trailer', 'teaser', 'clip', 'featurette']),
      url: url.nullable().optional(),
      externalId: externalId.nullable().optional(),
      official: z.boolean().optional(),
      language: languageCode.nullable().optional(),
    }).strict().refine((video) => video.url || video.externalId, {
      message: 'A trailer needs a url or an external id',
    })).max(20).optional(),
    collection: z.object({
      name: z.string().min(1).max(200),
      slug,
    }).strict().nullable().optional(),
    crossIdentifiers: z.array(z.object({
      source: slug,
      externalId,
    }).strict()).max(10).optional(),
    sourceUpdatedAt: z.string().datetime().nullable().optional(),
    sourceUrl: url.nullable().optional(),
  }).strict();
}

export function validateRawMovie(raw, allowedHosts = []) {
  const parsed = rawMovieSchema(allowedHosts).safeParse(raw);
  if (!parsed.success) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata failed validation', { transient: false });
  }
  const encoded = JSON.stringify(parsed.data);
  if (encoded.length > 100_000) {
    throw new IngestionError('MALFORMED_METADATA', 'Metadata payload is too large', { transient: false });
  }
  return parsed.data;
}
