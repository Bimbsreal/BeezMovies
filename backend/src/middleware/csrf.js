import { AppError } from '../errors/app-error.js';
import { REQUEST_HEADER } from '../auth/constants.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireBrowserRequestHeader(req, _res, next) {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  if (req.get(REQUEST_HEADER) === '1') {
    next();
    return;
  }

  next(new AppError('This request was rejected', {
    status: 403,
    code: 'CSRF_REJECTED',
  }));
}
