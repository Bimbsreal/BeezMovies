import crypto from 'node:crypto';

export function requestId(req, res, next) {
  const incoming = req.get('x-request-id') || '';
  const id = /^[A-Za-z0-9_-]{1,64}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  next();
}
