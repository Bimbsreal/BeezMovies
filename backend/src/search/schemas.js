import { z } from 'zod';
import { DEFAULT_LIMIT, DEFAULT_PAGE, MAX_LIMIT, MAX_PAGE } from '../catalog/constants.js';
import { SEARCH_MAX_QUERY } from './constants.js';

const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const languageCode = z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/);
const countryCode = z.string().regex(/^[A-Z]{2}$/);

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

const searchQuery = z.object({
  q: z.string().trim().min(1).max(SEARCH_MAX_QUERY),
  page: positiveInt(DEFAULT_PAGE, MAX_PAGE).default(DEFAULT_PAGE),
  limit: positiveInt(DEFAULT_LIMIT, MAX_LIMIT).default(DEFAULT_LIMIT),
  genre: z.preprocess(blankToUndefined, slug.optional()),
  year: z.preprocess(blankToUndefined, z.coerce.number().int().min(1888).max(2100).optional()),
  language: z.preprocess(blankToUndefined, languageCode.optional()),
  country: z.preprocess(blankToUndefined, countryCode.optional()),
  type: z.preprocess(blankToUndefined, z.string().regex(/^[a-z_]+$/).max(32).optional()),
  collection: z.preprocess(blankToUndefined, slug.optional()),
  person: z.preprocess(blankToUndefined, z.string().uuid().optional()),
}).strict();

export const searchSchema = z.object({
  body: z.object({}).strict(),
  query: searchQuery,
  params: z.object({}).strict(),
});

export const suggestionSchema = z.object({
  body: z.object({}).strict(),
  query: z.object({
    q: z.string().trim().min(1).max(SEARCH_MAX_QUERY),
  }).strict(),
  params: z.object({}).strict(),
});
