import { MEDIA_QUALITIES } from '../constants.js';
import { mediaError } from '../errors.js';
import { assertSafeReference } from '../validate.js';

function kind(reference) {
  return assertSafeReference(reference.external_reference);
}

export function localDevelopmentBody(reference) {
  const slug = String(reference.movieSlug || 'title').replace(/[^a-z0-9-]/g, '');
  return [
    'BeezMovies development handoff',
    `slug=${slug || 'title'}`,
    `quality=${reference.quality || 'unspecified'}`,
    'This file is generated on this machine.',
    'It is not a movie and it was not fetched from a provider.',
    '',
  ].join('\n');
}

export const developmentMediaAdapter = {
  async validateReference(reference) {
    kind(reference);
  },

  async checkAvailability(reference) {
    return this.getFileStatus(reference);
  },

  async getFileStatus(reference) {
    const value = kind(reference);
    if (value.startsWith('dev:unavailable')) return { availability: 'unavailable' };
    if (value.startsWith('dev:fail') || value.startsWith('dev:timeout')) return { availability: 'unavailable' };
    return { availability: 'available' };
  },

  async getMetadata(reference) {
    const value = kind(reference);
    return {
      quality: MEDIA_QUALITIES.includes(reference.quality) ? reference.quality : null,
      format: value.startsWith('dev:stream:') ? 'stream' : 'development-text',
      mediaType: value.startsWith('dev:stream:') ? 'stream' : 'download',
    };
  },

  async healthCheck() {
    return { status: 'available' };
  },

  async resolveMedia(reference) {
    const value = kind(reference);
    if (value.startsWith('dev:unavailable')) throw mediaError('MEDIA_UNAVAILABLE');
    if (value.startsWith('dev:expired')) {
      return { local: true, resourceType: 'download', expiresAt: '2000-01-01T00:00:00.000Z' };
    }
    if (value.startsWith('dev:fail')) throw mediaError('PROVIDER_UNAVAILABLE');
    if (value.startsWith('dev:timeout')) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      throw mediaError('PROVIDER_TIMEOUT');
    }
    if (value.startsWith('dev:stream:')) {
      return { local: true, resourceType: 'stream' };
    }
    if (value.startsWith('dev:ok:') || value.startsWith('dev-seed:')) {
      const slug = String(reference.movieSlug || 'title').replace(/[^a-z0-9-]/g, '') || 'title';
      return {
        local: true,
        resourceType: 'download',
        filename: `${slug}-development.txt`,
        contentType: 'text/plain; charset=utf-8',
        expiresInSeconds: 60,
      };
    }
    throw mediaError('MEDIA_NOT_FOUND');
  },

  async getDownloadReference(reference) {
    return this.getDownloadUrl(reference);
  },

  async getDownloadUrl(reference) {
    const resolved = await this.resolveMedia(reference);
    if (resolved.resourceType !== 'download') throw mediaError('DOWNLOAD_NOT_SUPPORTED');
    return { kind: 'local', filename: resolved.filename || null };
  },

  async getStreamUrl(reference) {
    const resolved = await this.resolveMedia(reference);
    if (resolved.resourceType !== 'stream') throw mediaError('DOWNLOAD_NOT_SUPPORTED');
    return { kind: 'local' };
  },

  readLocalBody(reference) {
    return localDevelopmentBody(reference);
  },
};
