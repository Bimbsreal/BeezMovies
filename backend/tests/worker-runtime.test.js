import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHandler, listHandlers } from '../../workers/src/runtime.js';

test('worker registry stores handlers and rejects invalid ones', () => {
  assert.throws(() => registerHandler('catalog', 'nope'), TypeError);
  assert.deepEqual(listHandlers(), []);

  registerHandler('catalog', async () => {});
  assert.deepEqual(listHandlers(), ['catalog']);
});
