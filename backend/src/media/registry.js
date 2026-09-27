import { assertMediaAdapter } from './adapter.js';
import { developmentMediaAdapter } from './adapters/development.js';

const adapters = new Map();

export function registerMediaAdapter(slug, adapter) {
  assertMediaAdapter(adapter);
  adapters.set(slug, adapter);
}

export function getMediaAdapter(slug) {
  if (adapters.has(slug)) return adapters.get(slug);
  if (slug.startsWith('development-')) return developmentMediaAdapter;
  return null;
}

registerMediaAdapter('development-media', developmentMediaAdapter);
