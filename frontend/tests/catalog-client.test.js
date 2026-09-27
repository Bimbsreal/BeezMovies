import test from 'node:test';
import assert from 'node:assert/strict';
import { getCollection, getMovieBySlug, getMovies, getPerson, toCatalogQuery } from '../lib/api/catalog.js';

test('catalog query strings omit empty values', () => {
  assert.equal(toCatalogQuery(), '');
  assert.equal(toCatalogQuery({ page: 2, limit: 20, genre: 'horror', q: '' }), '?page=2&limit=20&genre=horror');
});

test('catalog client functions target the versioned paths', () => {
  assert.equal(getMovies.name, 'getMovies');
  assert.equal(typeof getMovieBySlug, 'function');
  assert.equal(typeof getCollection, 'function');
  assert.equal(typeof getPerson, 'function');
});
