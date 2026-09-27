import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertDevSeedAllowed,
  databaseNameFromUrl,
  productionConfigErrors,
} from '../src/config/release.js';

const productionEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:secret@db.internal:5432/beezmovies_production?sslmode=verify-full',
  MEDIA_HANDOFF_SECRET: 'unique-handoff',
  CORS_ORIGIN: 'https://beezmovies.example',
  REDIS_URL: '',
};

test('production configuration accepts a private staging or production profile', () => {
  assert.deepEqual(productionConfigErrors(productionEnv), []);
  assert.deepEqual(productionConfigErrors({
    ...productionEnv,
    DATABASE_URL: 'postgresql://app:secret@db.internal:5432/beezmovies_staging?sslmode=verify-full',
  }), []);
});

test('production configuration rejects development fixtures and public secrets', () => {
  const errors = productionConfigErrors({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://beezmovies:beezmovies_local@localhost:5432/beezmovies',
    MEDIA_HANDOFF_SECRET: 'beezmovies-local-handoff',
    CORS_ORIGIN: 'http://localhost:3000',
    REDIS_URL: 'redis://127.0.0.1:6379',
    NEXT_PUBLIC_DATABASE_URL: 'postgresql://db',
  });
  assert.ok(errors.some((item) => item.includes('development fixture')));
  assert.ok(errors.some((item) => item.includes('localhost')));
  assert.ok(errors.some((item) => item.includes('CORS_ORIGIN')));
  assert.ok(errors.some((item) => item.includes('NEXT_PUBLIC_DATABASE_URL')));
});

test('development configuration is not rejected by the production gate', () => {
  assert.deepEqual(productionConfigErrors({ NODE_ENV: 'development' }), []);
  assert.equal(databaseNameFromUrl(productionEnv.DATABASE_URL), 'beezmovies_production');
});

test('development seed cannot target staging or production', () => {
  assert.doesNotThrow(() => assertDevSeedAllowed({
    nodeEnv: 'development',
    databaseUrl: 'postgresql://beezmovies:beezmovies_local@localhost:5432/beezmovies',
  }));
  assert.throws(() => assertDevSeedAllowed({
    nodeEnv: 'development',
    databaseUrl: 'postgresql://app:secret@db.internal:5432/beezmovies_staging',
  }), /Refusing to load development catalog seed/);
  assert.throws(() => assertDevSeedAllowed({
    nodeEnv: 'production',
    databaseUrl: 'postgresql://app:secret@db.internal:5432/beezmovies_production?sslmode=verify-full',
  }), /Refusing to load development catalog seed/);
});
