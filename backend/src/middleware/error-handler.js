import { AppError } from '../errors/app-error.js';
import { config } from '../config/index.js';
import { logger } from '../logger/index.js';
import { sanitize } from '../errors/sanitize.js';
import { recordErrorStatus } from '../analytics/record.js';

export function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code && typeof err.code === 'string' ? err.code : 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';
  let details = err instanceof AppError ? err.details : undefined;

  if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
    details = undefined;
  } else if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body must be valid JSON';
    details = undefined;
  } else if (!(err instanceof AppError)) {
    status = status >= 400 && status < 500 ? status : 500;
    code = status === 500 ? 'INTERNAL_ERROR' : code;
  }

  if (status >= 500) {
    logger.error({
      requestId: req.id,
      code,
      err: sanitize(err.message),
    }, 'Request failed');
    message = config.isProduction ? 'Internal server error' : sanitize(message);
  } else {
    message = sanitize(message);
    logger.warn({ requestId: req.id, code, status }, message);
  }

  const payload = {
    error: {
      code: status >= 500 && !(err instanceof AppError) ? 'INTERNAL_ERROR' : code,
      message,
    },
  };

  if (err instanceof AppError && status >= 500) {
    payload.error.code = err.code || 'INTERNAL_ERROR';
  }

  if (details) {
    payload.error.details = details;
  }

  if (!req.originalUrl?.startsWith('/api/v1/analytics')) {
    recordErrorStatus(status);
  }

  if (!config.isProduction && status >= 500 && err.stack) {
    payload.error.debug = sanitize(err.stack);
  }

  res.status(status).json(payload);
}
