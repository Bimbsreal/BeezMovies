import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from '../config/index.js';

export function securityMiddleware() {
  const router = express.Router();

  router.use(helmet({
    hsts: config.isProduction ? {
      maxAge: 15552000,
      includeSubDomains: false,
    } : false,
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  }));
  router.use((_req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    next();
  });
  router.use(cors({
    origin(origin, callback) {
      if (!origin || config.corsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-BeezMovies-Request'],
  }));
  router.use(express.json({ limit: config.bodyLimit }));
  router.use(express.urlencoded({ extended: false, limit: config.bodyLimit }));

  return router;
}
