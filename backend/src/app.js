import express from 'express';
import { requestId } from './middleware/request-id.js';
import { requestLogger } from './middleware/request-logger.js';
import { securityMiddleware } from './middleware/security.js';
import { notFound } from './middleware/not-found.js';
import { errorHandler } from './middleware/error-handler.js';
import { v1Router } from './routes/v1/index.js';
import { health, ready } from './routes/v1/system.js';
import { asyncHandler } from './middleware/async-handler.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestId);
  app.use(requestLogger);
  app.use(securityMiddleware());
  app.get('/health', health);
  app.get('/health/live', health);
  app.get('/health/ready', asyncHandler(ready));
  app.use('/api/v1', v1Router);
  app.use(notFound);
  app.use(errorHandler);
  return app;
}
