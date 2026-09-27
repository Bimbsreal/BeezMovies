import { publicConfig } from '../config.js';

export class ApiError extends Error {
  constructor(message, { status = 500, code = 'INTERNAL_ERROR', details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export async function api(path, { method = 'GET', body, signal } = {}) {
  let response;
  try {
    response = await fetch(`${publicConfig.apiUrl}${path}`, {
      method,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        'X-BeezMovies-Request': '1',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
      throw new ApiError('The request timed out', { code: 'TIMEOUT' });
    }
    throw new ApiError('The API could not be reached', { code: 'NETWORK_ERROR' });
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(payload.error?.message || 'Request failed', {
      status: response.status,
      code: payload.error?.code,
      details: payload.error?.details,
    });
  }
  return payload;
}
