export function omitDuplicateMovieRails(rails) {
  const seen = new Set();
  return rails.filter((rail) => {
    if (!rail.items?.length) return false;
    if (rail.kind !== 'movies') return true;
    const key = `${rail.source}|${rail.items.map((item) => item.slug).join('|')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rankRelated(movie, candidates, { collectionSlugs = [] } = {}) {
  const collection = new Set(collectionSlugs);
  const year = movie.releaseYear;
  const language = movie.originalLanguage?.code || null;
  return candidates
    .filter((item) => item.slug !== movie.slug)
    .map((item) => {
      let score = item.sharedGenres || 0;
      score *= 3;
      score += (item.sharedCountries || 0) * 2;
      if (language && item.originalLanguage?.code === language) score += 2;
      if (year && item.releaseYear && Math.abs(year - item.releaseYear) <= 10) score += 1;
      if (collection.has(item.slug)) score += 4;
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.item.slug.localeCompare(right.item.slug))
    .map((entry) => {
      const { sharedGenres, sharedCountries, ...item } = entry.item;
      return item;
    });
}
