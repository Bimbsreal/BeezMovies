import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../src/middleware/rate-limit.js';

test('rate limiter returns the shared error body', async () => {
  const app = express();
  app.use(createRateLimiter({
    windowMs: 60_000,
    limit: 1,
    skip: () => false,
  }));
  app.get('/limited', (_req, res) => {
    res.json({ ok: true });
  });

  const first = await request(app).get('/limited');
  const second = await request(app).get('/limited');

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.body.error.code, 'RATE_LIMITED');
  assert.equal(second.body.error.message, 'Too many requests');
});
