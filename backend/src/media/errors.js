import { AppError } from '../errors/app-error.js';

export class MediaError extends AppError {
  constructor(code, message, status = 409) {
    super(message, { status, code });
    this.name = 'MediaError';
  }
}

export function mediaError(code) {
  const messages = {
    MEDIA_UNAVAILABLE: ['Download is not available for this title.', 409],
    PROVIDER_UNAVAILABLE: ['The media provider is unavailable.', 503],
    MEDIA_EXPIRED: ['This download link has expired.', 409],
    MEDIA_NOT_FOUND: ['Media was not found.', 404],
    PROVIDER_TIMEOUT: ['The media provider timed out.', 504],
    DOWNLOAD_NOT_SUPPORTED: ['This title cannot be downloaded.', 409],
  };
  const [message, status] = messages[code] || ['Download is not available for this title.', 409];
  return new MediaError(code, message, status);
}
