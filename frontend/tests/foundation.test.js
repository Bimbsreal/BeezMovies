import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { STARTUP_ASSET, STARTUP_PHASES } from '../lib/startup/phases.js';

const root = path.resolve(import.meta.dirname, '..');
const OFFICIAL_LOGO_SHA256 = 'B6E6D88E2BCB126B63134AA8700BBF589DC58A3AA3C6BD5BD567CBB70A999E29';

test('official logo bytes are unchanged', () => {
  const logoPath = path.join(root, 'public', 'branding', 'beezmovies-logo.jpg');
  const hash = crypto.createHash('sha256').update(fs.readFileSync(logoPath)).digest('hex');
  assert.equal(hash.toUpperCase(), OFFICIAL_LOGO_SHA256);
  assert.equal(STARTUP_ASSET, '/branding/beezmovies-logo.jpg');
});

test('startup sequence keeps the planned phase order', () => {
  assert.deepEqual(STARTUP_PHASES.map((phase) => phase.id), [
    'bee-enter',
    'bee-flight',
    'wordmark',
    'cinematic-transition',
    'homepage',
  ]);
});

test('web manifest points at the official logo', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.name, 'BeezMovies');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.background_color, '#0B0D0F');
  assert.equal(manifest.theme_color, '#0B0D0F');
  assert.equal(manifest.icons[0].src, '/branding/beezmovies-logo.jpg');
});

test('service worker does not cache API or authorized responses', () => {
  const source = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.match(source, /pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /\/account/);
  assert.match(source, /authorization/);
  assert.match(source, /SKIP_WAITING/);
  assert.match(source, /beezmovies-static-v4/);
  assert.match(source, /\/admin/);
  assert.match(source, /offline\.html/);
});
