import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';
import { validate } from '../src/middleware/validate.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import { AppError } from '../src/errors/app-error.js';
import { createApp } from '../src/app.js';

test('unknown routes use the shared error body', async () => {
  const response = await request(createApp()).get('/api/v1/does-not-exist');

  assert.equal(response.status, 404);
  assert.deepEqual(response.body, {
    error: {
      code: 'NOT_FOUND',
      message: 'Resource not found',
    },
  });
});

test('validation errors identify the field and success passes parsed input', async () => {
  const app = express();
  const schema = z.object({
    body: z.object({
      title: z.string().min(1),
    }),
  });

  app.use(express.json());
  app.post('/example', validate(schema), (req, res) => {
    res.json({ title: req.validated.body.title });
  });
  app.use(errorHandler);

  const invalid = await request(app).post('/example').send({});
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');
  assert.equal(invalid.body.error.details[0].path, 'body.title');

  const valid = await request(app).post('/example').send({ title: 'Hive' });
  assert.equal(valid.status, 200);
  assert.equal(valid.body.title, 'Hive');
});

test('server errors hide stacks and connection strings', async () => {
  const app = express();
  app.get('/boom', (_req, _res, next) => {
    next(new Error('connect postgresql://beezmovies:beezmovies_local@localhost:5432/beezmovies failed'));
  });
  app.use(errorHandler);

  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    const development = await request(app).get('/boom');
    assert.equal(development.status, 500);
    assert.equal(development.body.error.code, 'INTERNAL_ERROR');
    assert.match(development.body.error.message, /\[redacted\]/);
    assert.match(development.body.error.debug, /\[redacted\]/);
    assert.equal(JSON.stringify(development.body).includes('beezmovies_local'), false);

    process.env.NODE_ENV = 'production';
    const production = await request(app).get('/boom');
    assert.equal(production.status, 500);
    assert.equal(production.body.error.message, 'Internal server error');
    assert.equal(production.body.error.debug, undefined);
    assert.equal(JSON.stringify(production.body).includes('beezmovies_local'), false);
    assert.equal(JSON.stringify(production.body).includes('at '), false);
  } finally {
    process.env.NODE_ENV = previous;
  }
});

test('application errors keep their public message', async () => {
  const app = express();
  app.get('/missing', (_req, _res, next) => {
    next(new AppError('Resource not found', { status: 404, code: 'NOT_FOUND' }));
  });
  app.use(errorHandler);

  const response = await request(app).get('/missing');
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'NOT_FOUND');
  assert.equal(response.body.error.debug, undefined);
});
