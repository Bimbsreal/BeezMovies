import { createHash } from 'node:crypto';

export function publicCacheHints(req, res, next) {
  const send = res.json.bind(res);
  res.json = (body) => {
    const cache = res.get('Cache-Control') || '';
    if (req.method === 'GET' && cache.startsWith('public')) {
      res.set('Vary', 'Accept-Encoding');
      const tag = `W/"${createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 27)}"`;
      res.set('ETag', tag);
      if (req.get('if-none-match') === tag) {
        res.status(304);
        return res.end();
      }
    }
    return send(body);
  };
  next();
}
