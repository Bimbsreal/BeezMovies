import { AppError } from '../errors/app-error.js';

export function notFound(_req, _res, next) {
  next(new AppError('Resource not found', { status: 404, code: 'NOT_FOUND' }));
}
