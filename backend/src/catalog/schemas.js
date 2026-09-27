import { z } from 'zod';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT, MAX_PAGE } from './constants.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const languageCode = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/);
const countryCode = z.string().regex(/^[A-Z]{2}$/);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function blankToUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  return value;
}

function positiveInt(fallback, max) {
  return z.preprocess(
    (value) => (value === undefined || value === '' ? fallback : value),
    z.coerce.number().int().min(1).max(max),
  );
}

const listQuery = z.object({
  page: positiveInt(DEFAULT_PAGE, MAX_PAGE).default(DEFAULT_PAGE),
  limit: positiveInt(DEFAULT_LIMIT, MAX_LIMIT).default(DEFAULT_LIMIT),
  sort: z.preprocess(blankToUndefined, z.enum(['release_date', 'title', 'created_at', 'popularity']).default('release_date')),
  order: z.preprocess(blankToUndefined, z.enum(['asc', 'desc']).default('desc')),
  status: z.preprocess(blankToUndefined, z.enum(['draft', 'active', 'archived']).optional()),
  genre: z.preprocess(blankToUndefined, slug.optional()),
  year: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1888).max(2100).optional(),
  ),
  releasedFrom: z.preprocess(blankToUndefined, isoDate.optional()),
  releasedTo: z.preprocess(blankToUndefined, isoDate.optional()),
  language: z.preprocess(blankToUndefined, languageCode.optional()),
  country: z.preprocess(blankToUndefined, countryCode.optional()),
  type: z.preprocess(blankToUndefined, z.string().regex(/^[a-z_]+$/).max(32).optional()),
  collection: z.preprocess(blankToUndefined, slug.optional()),
  q: z.preprocess(blankToUndefined, z.string().trim().max(100).optional()),
}).strict();

function requestSchema(params, query = z.object({}).strict()) {
  return z.object({
    body: z.object({}).optional().default({}),
    params,
    query,
  });
}

export const movieListSchema = requestSchema(z.object({}).strict(), listQuery);
export const countryListSchema = requestSchema(z.object({}).strict());
export const countrySlugSchema = requestSchema(z.object({ slug }).strict());
export const countryMoviesSchema = requestSchema(
  z.object({ slug }).strict(),
  listQuery.omit({ country: true, status: true, q: true, collection: true, language: true, releasedFrom: true, releasedTo: true }),
);
export const genreMoviesSchema = requestSchema(
  z.object({ slug }).strict(),
  listQuery.omit({ genre: true }),
);
export const personMoviesSchema = requestSchema(
  z.object({ id: z.string().uuid() }).strict(),
  listQuery,
);
export const movieSlugSchema = requestSchema(z.object({ slug }).strict());
export const movieDownloadSchema = z.object({
  body: z.object({}).strict(),
  params: z.object({ slug }).strict(),
  query: z.object({}).strict(),
});
export const movieIdSchema = requestSchema(z.object({ id: z.string().uuid() }).strict());
export const languageListSchema = requestSchema(z.object({}).strict());
export const languageMoviesSchema = requestSchema(
  z.object({ code: languageCode }).strict(),
  listQuery.omit({ language: true, status: true, q: true, collection: true, releasedFrom: true, releasedTo: true }),
);
export const genreListSchema = requestSchema(z.object({}).strict());
export const industrySchema = requestSchema(
  z.object({ slug }).strict(),
  listQuery.pick({
    page: true,
    limit: true,
    sort: true,
    order: true,
    genre: true,
    year: true,
    type: true,
  }),
);
export const collectionListSchema = requestSchema(z.object({}).strict());
export const collectionSlugSchema = requestSchema(z.object({ slug }).strict());
export const personSchema = requestSchema(z.object({ id: z.string().uuid() }).strict());
