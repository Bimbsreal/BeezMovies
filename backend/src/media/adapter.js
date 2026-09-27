import { ADAPTER_METHODS } from './constants.js';

export function assertMediaAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') {
    throw new TypeError('Media provider adapter is required');
  }
  for (const name of ADAPTER_METHODS) {
    if (typeof adapter[name] !== 'function') {
      throw new TypeError(`Media provider adapter is missing ${name}`);
    }
  }
  return adapter;
}
