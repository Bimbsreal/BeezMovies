import test from 'node:test';
import assert from 'node:assert/strict';
import { getHome, getPopular, getRecent, getSearchSuggestions, getTrending, searchMovies } from '../lib/api/search.js';

test('search client functions target the versioned paths', () => {
  assert.equal(typeof searchMovies, 'function');
  assert.equal(typeof getSearchSuggestions, 'function');
  assert.equal(typeof getHome, 'function');
  assert.equal(typeof getTrending, 'function');
  assert.equal(typeof getPopular, 'function');
  assert.equal(typeof getRecent, 'function');
});
