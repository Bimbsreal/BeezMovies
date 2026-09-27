import { AppError } from '../errors/app-error.js';

export function requirePermission(slug) {
  return (req, _res, next) => {
    if (req.auth?.permissions?.includes(slug)) {
      next();
      return;
    }

    next(new AppError('You do not have access to this resource', {
      status: 403,
      code: 'FORBIDDEN',
    }));
  };
}

export const requireAdmin = requirePermission('admin.access');
