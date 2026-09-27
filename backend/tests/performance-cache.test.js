import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCache, catalogCacheKeys } from '../src/catalog/cache.js';
import { invalidateSearchCache, searchCache } from '../src/search/cache.js';
import { PERFORMANCE_BUDGETS } from '../src/ops/budgets.js';

test('public catalog cache stays in memory when Redis is absent', async () => {
  const key = catalogCacheKeys.movieSlug('phase-41-cache');
  await catalogCache.set(key, { title: 'Phase' });
  assert.equal((await catalogCache.get(key)).title, 'Phase');
  await catalogCache.invalidate([key]);
  assert.equal(await catalogCache.get(key), null);
});

test('search invalidation drops only the previous generation', async () => {
  await searchCache.set('phase41', { ok: true });
  assert.deepEqual(await searchCache.get('phase41'), { ok: true });
  invalidateSearchCache();
  assert.equal(await searchCache.get('phase41'), null);
  await searchCache.set('phase41', { ok: true });
  assert.deepEqual(await searchCache.get('phase41'), { ok: true });
});

test('performance budgets stay numeric', () => {
  for (const value of Object.values(PERFORMANCE_BUDGETS)) {
    assert.equal(typeof value, 'number');
    assert.ok(value > 0);
  }
});
