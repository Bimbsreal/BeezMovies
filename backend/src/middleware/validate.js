import { AppError } from '../errors/app-error.js';

export function validate(schema) {
  return (req, _res, next) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      next(new AppError('Request validation failed', {
        status: 400,
        code: 'VALIDATION_ERROR',
        details: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      }));
      return;
    }

    req.validated = result.data;
    next();
  };
}
