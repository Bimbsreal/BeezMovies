const LOCAL_HANDOFF = 'beezmovies-local-handoff';
const LOCAL_DB_PASSWORD = 'beezmovies_local';

export function databaseNameFromUrl(url) {
  if (!url) return '';
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  } catch {
    return '';
  }
}

export function productionConfigErrors(env = process.env) {
  if ((env.NODE_ENV || '') !== 'production') return [];

  const errors = [];
  const databaseUrl = env.DATABASE_URL || '';
  const databaseName = databaseNameFromUrl(databaseUrl);

  if (!databaseUrl) {
    errors.push('DATABASE_URL is required');
  } else {
    if (databaseUrl.includes(LOCAL_DB_PASSWORD)) {
      errors.push('DATABASE_URL uses the development fixture');
    }
    if (databaseName === 'beezmovies' || databaseName === '') {
      errors.push('DATABASE_URL must name beezmovies_staging or beezmovies_production');
    }
    if (/@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(databaseUrl)) {
      errors.push('DATABASE_URL must not point at localhost');
    }
  }

  const handoff = env.MEDIA_HANDOFF_SECRET || '';
  if (!handoff) errors.push('MEDIA_HANDOFF_SECRET is required');
  if (handoff === LOCAL_HANDOFF) errors.push('MEDIA_HANDOFF_SECRET is the development fixture');

  const origins = String(env.CORS_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (
    origins.length === 0
    || origins.some((origin) => origin === '*' || origin.includes('localhost') || !origin.startsWith('https://'))
  ) {
    errors.push('CORS_ORIGIN must list https origins only');
  }

  const redisUrl = env.REDIS_URL || '';
  if (redisUrl && /@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/.test(redisUrl)) {
    errors.push('REDIS_URL must not point at localhost');
  }

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('NEXT_PUBLIC_')) continue;
    if (/SECRET|PASSWORD|TOKEN|DATABASE|HANDOFF|PRIVATE/i.test(key)) {
      errors.push(`${key} must not be public`);
    }
    if (value && (String(value).includes(LOCAL_HANDOFF) || String(value).includes(LOCAL_DB_PASSWORD))) {
      errors.push(`${key} contains a development fixture`);
    }
  }

  return errors;
}

export function assertProductionConfig(env = process.env) {
  const errors = productionConfigErrors(env);
  if (errors.length > 0) {
    throw new Error(`Refusing production start: ${errors.join('; ')}`);
  }
}

export function assertDevSeedAllowed({ nodeEnv, databaseUrl }) {
  const name = databaseNameFromUrl(databaseUrl);
  if (nodeEnv === 'production' || name === 'beezmovies_production' || name === 'beezmovies_staging') {
    throw new Error('Refusing to load development catalog seed into this environment');
  }
}
