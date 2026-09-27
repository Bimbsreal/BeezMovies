import { IngestionError } from '../errors.js';

const SOURCE = 'development-metadata';

const records = {
  'dev-meta:nosferatu': {
    externalId: 'dev-meta:nosferatu',
    title: 'Nosferatu',
    originalTitle: 'Nosferatu',
    synopsis: 'A local metadata sample for the public-domain film Nosferatu.',
    releaseDate: '1922-03-15',
    runtimeMinutes: 94,
    originalLanguage: 'de',
    genres: ['Horror'],
    languages: ['de'],
    countries: ['DE'],
    alternateTitles: [{ title: 'Nosferatu: A Symphony of Horror', language: 'en' }],
    credits: [
      { name: 'F. W. Murnau', department: 'Directing', job: 'Director', billingOrder: 0 },
      { name: 'Max Schreck', department: 'Acting', job: 'Actor', characterName: 'Count Orlok', billingOrder: 1 },
    ],
    images: [{
      type: 'poster',
      url: 'https://images.example.com/beezmovies/posters/nosferatu-meta.jpg',
      width: 1000,
      height: 1500,
    }],
    videos: [{
      type: 'trailer',
      url: 'https://videos.example.com/beezmovies/trailers/nosferatu-meta',
      official: true,
    }],
    crossIdentifiers: [{ source: 'development-seed', externalId: 'dev-seed:movie:nosferatu' }],
    sourceUpdatedAt: '2024-01-01T00:00:00.000Z',
  },
  'dev-meta:metropolis': {
    externalId: 'dev-meta:metropolis',
    title: 'Metropolis',
    originalTitle: 'Metropolis',
    synopsis: 'A public-domain science-fiction film used as a local ingestion sample.',
    releaseDate: '1927-01-10',
    runtimeMinutes: 153,
    originalLanguage: 'de',
    genres: ['Science Fiction', 'Drama'],
    languages: ['de'],
    countries: ['DE'],
    credits: [
      { name: 'Fritz Lang', department: 'Directing', job: 'Director', billingOrder: 0 },
    ],
    images: [{
      type: 'poster',
      url: 'https://images.example.com/beezmovies/posters/metropolis.jpg',
      width: 1000,
      height: 1500,
    }],
    videos: [{
      type: 'trailer',
      url: 'https://videos.example.com/beezmovies/trailers/metropolis',
      official: true,
    }],
    sourceUpdatedAt: '2024-06-01T00:00:00.000Z',
  },
  'dev-meta:nosferatu-lookalike': {
    externalId: 'dev-meta:nosferatu-lookalike',
    title: 'Nosferatu',
    synopsis: 'A same-title sample that must stay a review candidate.',
    releaseDate: '1922-03-15',
    runtimeMinutes: 140,
    originalLanguage: 'fr',
    genres: ['Horror'],
    countries: ['FR'],
    credits: [
      { name: 'Ada Lookalike', department: 'Directing', job: 'Director', billingOrder: 0 },
    ],
    sourceUpdatedAt: '2024-02-01T00:00:00.000Z',
  },
  'dev-meta:nosferatu-remake-sample': {
    externalId: 'dev-meta:nosferatu-remake-sample',
    title: 'Nosferatu',
    synopsis: 'A later-year sample that must stay a separate catalog record.',
    releaseDate: '1999-01-01',
    runtimeMinutes: 90,
    originalLanguage: 'en',
    countries: ['US'],
    sourceUpdatedAt: '2024-03-01T00:00:00.000Z',
  },
  'dev-meta:great-train-robbery': {
    externalId: 'dev-meta:great-train-robbery',
    title: 'The Great Train Robbery',
    synopsis: 'A public-domain short used to exercise collection synchronization.',
    releaseDate: '1903-12-01',
    runtimeMinutes: 12,
    originalLanguage: 'en',
    genres: ['Action'],
    countries: ['US'],
    collection: { name: 'Phase Five Sample Reels', slug: 'phase5-sample-reels' },
    sourceUpdatedAt: '2024-04-01T00:00:00.000Z',
  },
};

const searchIds = ['dev-meta:nosferatu', 'dev-meta:metropolis'];

function clone(value) {
  return structuredClone(value);
}

export const developmentMetadataAdapter = {
  slug: SOURCE,
  descriptor: {
    name: 'Development metadata',
    authentication: 'none',
    endpoints: ['searchTitles', 'getMovie', 'getCredits', 'getImages', 'getExternalIdentifiers'],
    rateLimit: 'catalog_source_runtime',
    metadata: [
      'title', 'originalTitle', 'synopsis', 'releaseDate', 'runtimeMinutes',
      'language', 'country', 'genres', 'credits', 'images', 'externalIds',
    ],
    attribution: 'development-metadata',
    errors: ['SOURCE_UNAVAILABLE', 'INVALID_SOURCE_ID', 'MALFORMED_METADATA'],
  },
  async searchTitles() {
    return searchIds.map((externalId) => ({
      externalId,
      title: records[externalId].title,
    }));
  },
  async listPage({ cursor = 0, limit = 25 } = {}) {
    const start = Number.isInteger(cursor) && cursor > 0 ? cursor : 0;
    const size = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 25) : 25;
    const page = searchIds.slice(start, start + size);
    const next = start + page.length;
    return {
      total: searchIds.length,
      cursor: start,
      nextCursor: next < searchIds.length ? next : null,
      items: page.map((externalId) => ({
        externalId,
        title: records[externalId].title,
      })),
    };
  },
  async getMovie(externalId) {
    if (externalId === 'dev-meta:unavailable') {
      throw new IngestionError('SOURCE_UNAVAILABLE', 'Development source is temporarily unavailable', {
        transient: true,
      });
    }
    if (externalId === 'dev-meta:malformed') {
      return { externalId, title: '<script>alert(1)</script>' };
    }
    const record = records[externalId];
    if (!record) {
      throw new IngestionError('INVALID_SOURCE_ID', 'Development source has no record for that id', {
        transient: false,
      });
    }
    return clone(record);
  },
  async getCredits(externalId) {
    const movie = await this.getMovie(externalId);
    return movie.credits ?? [];
  },
  async getImages(externalId) {
    const movie = await this.getMovie(externalId);
    return movie.images ?? [];
  },
  async getExternalIdentifiers(externalId) {
    const movie = await this.getMovie(externalId);
    return [
      { source: SOURCE, externalId: movie.externalId },
      ...(movie.crossIdentifiers ?? []),
    ];
  },
};
