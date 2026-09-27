import '../env.js';
import pino from 'pino';

const env = process.env.NODE_ENV || 'development';

export const logger = pino({
  level: env === 'test' ? 'silent' : process.env.LOG_LEVEL || 'info',
  base: { service: process.env.LOG_SERVICE || 'beezmovies-api' },
  ...(env === 'development'
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
          },
        },
      }
    : {}),
});
