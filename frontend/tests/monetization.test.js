import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { nextPreviewPhase, placementVisible, withTimeout } from '../lib/monetization/policy.js';

const root = path.resolve(import.meta.dirname, '..');

test('placements stay collapsed unless the viewport and consent allow a house creative', () => {
  const placement = {
    slug: 'IN_FEED_NATIVE',
    mode: 'house',
    desktopEnabled: true,
    mobileEnabled: false,
    creative: { headline: 'Note' },
  };
  assert.equal(placementVisible(placement, { viewport: 1280 }), true);
  assert.equal(placementVisible(placement, { viewport: 390 }), false);
  assert.equal(placementVisible({ ...placement, mode: 'collapse', creative: null }, { viewport: 1280 }), false);
  assert.equal(placementVisible({
    ...placement,
    slug: 'DESKTOP_SIDE_RAIL',
  }, { viewport: 1400 }), false);
  assert.equal(placementVisible({
    ...placement,
    slug: 'DESKTOP_SIDE_RAIL',
  }, { viewport: 1900 }), true);
  assert.equal(placementVisible(placement, { viewport: 1280, consentRequired: true, consentGranted: false }), false);
});

test('a trailer advertisement failure returns to the trailer', () => {
  assert.equal(nextPreviewPhase('advertisement', 'failure'), 'content');
  assert.equal(nextPreviewPhase('advertisement', 'timeout'), 'content');
  assert.equal(nextPreviewPhase('content', 'failure'), 'content');
});

test('a slow advertising response collapses instead of blocking playback', async () => {
  await assert.rejects(withTimeout(() => new Promise(() => {}), 20));
});

test('public advertising code does not request notifications or alter downloads', () => {
  const sponsored = fs.readFileSync(path.join(root, 'components/monetization/sponsored-content.js'), 'utf8');
  const preview = fs.readFileSync(path.join(root, 'components/movies/preview-button.js'), 'utf8');
  const download = fs.readFileSync(path.join(root, 'components/movies/download-button.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  assert.equal(sponsored.includes('Notification'), false);
  assert.equal(sponsored.includes('window.open'), false);
  assert.match(sponsored, /Sponsored/);
  assert.match(sponsored, /aria-label="Sponsored"/);
  assert.match(sponsored, /Dismiss/);
  assert.equal(preview.includes('Notification'), false);
  assert.match(preview, /Continue to trailer/);
  assert.equal(download.includes('monetization'), false);
  assert.match(css, /min-height: 7\.5rem/);
});
