export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 50;
export const MAX_PAGE = 10000;
export const LIST_CAP = 200;
export const CACHE_TTL_SECONDS = 60;

export const MOVIE_SORTS = {
  release_date: 'm.release_date',
  title: 'm.canonical_title',
  created_at: 'm.created_at',
  popularity: 'm.popularity',
};

export const PUBLIC_MOVIE_STATUS = 'active';
export const MOVIE_STATUSES = ['draft', 'active', 'archived'];
