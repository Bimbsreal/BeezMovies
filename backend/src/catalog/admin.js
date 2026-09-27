import { catalogCache, catalogCacheKeys } from './cache.js';
import { invalidateDiscoveryCache } from '../discovery/cache.js';
import { invalidateSearchCache } from '../search/cache.js';

// Later ingestion and admin writes call this after a catalog change.
// There is no public write route in this phase.
export async function invalidateCatalogCache({ slug } = {}) {
  const names = [
    catalogCacheKeys.genres(),
    catalogCacheKeys.collections(),
  ];
  if (slug) names.push(catalogCacheKeys.movieSlug(slug));
  invalidateDiscoveryCache();
  invalidateSearchCache();
  return catalogCache.invalidate(names);
}
