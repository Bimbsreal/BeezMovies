import pinoHttp from 'pino-http';
import { logger } from '../logger/index.js';

function redactMediaHandoff(url) {
  if (!url) return url;
  return url.replace(/\/media\/handoff\/[^/]+/, '/media/handoff/:token');
}

export const requestLogger = pinoHttp({
  logger,
  genReqId(req) {
    return req.id;
  },
  customProps(req) {
    return { requestId: req.id };
  },
  serializers: {
    req(req) {
      return {
        id: req.id,
        method: req.method,
        url: redactMediaHandoff(req.url?.split('?')[0]),
      };
    },
    res(res) {
      return { statusCode: res.statusCode };
    },
  },
});
