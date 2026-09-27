import '../env.js';

function read(name, fallback = '') {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return value;
}

export const config = {
  get env() {
    return read('NODE_ENV', 'development');
  },
  get isProduction() {
    return this.env === 'production';
  },
  get isTest() {
    return this.env === 'test';
  },
  get port() {
    const port = Number(read('PORT', '5000'));
    return Number.isInteger(port) && port > 0 ? port : 5000;
  },
  get databaseUrl() {
    return read('DATABASE_URL');
  },
  get redisUrl() {
    return read('REDIS_URL');
  },
  get corsOrigins() {
    return read('CORS_ORIGIN', 'http://localhost:3000')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean);
  },
  get logLevel() {
    return read('LOG_LEVEL', 'info');
  },
  get bodyLimit() {
    return read('BODY_LIMIT', '1mb');
  },
  get downloadHosts() {
    return read('MEDIA_DOWNLOAD_HOSTS', '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  },
  get mediaProviders() {
    return read('MEDIA_PROVIDERS', 'development-media')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  },
  get handoffSecret() {
    const configured = read('MEDIA_HANDOFF_SECRET', '');
    if (configured) return configured;
    if (this.isProduction) return '';
    return 'beezmovies-local-handoff';
  },
};
