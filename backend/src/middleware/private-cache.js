export function privateCache(_req, res, next) {
  res.set('Cache-Control', 'private, no-store');
  next();
}
