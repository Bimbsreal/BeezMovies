import { AppError } from '../errors/app-error.js';
import { resolveMovieDownload as resolve } from '../media/resolution.js';

export async function resolveMovieDownload(slug) {
  try {
    return await resolve(slug);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('Download is not available for this title.', {
      status: 409,
      code: 'MEDIA_UNAVAILABLE',
    });
  }
}
