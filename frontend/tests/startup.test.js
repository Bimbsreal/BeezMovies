import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { STARTUP_ASSET, STARTUP_BEE, STARTUP_PHASES } from '../lib/startup/phases.js';
import { STARTUP_BOOT, STARTUP_SESSION_KEY, STARTUP_TIMING } from '../lib/startup/boot.js';

const root = path.resolve(import.meta.dirname, '..');

test('startup boot only marks an installed launch', () => {
  assert.match(STARTUP_BOOT, /display-mode: standalone/);
  assert.match(STARTUP_BOOT, /prefers-reduced-motion: reduce/);
  assert.match(STARTUP_BOOT, new RegExp(STARTUP_SESSION_KEY));
  assert.match(STARTUP_BOOT, /brief/);
  assert.match(STARTUP_BOOT, /cinematic/);
  assert.equal(STARTUP_BOOT.includes('Audio'), false);
  assert.equal(STARTUP_BOOT.includes('autoplay'), false);
  assert.equal(STARTUP_TIMING.cinematicMs <= 3000, true);
  assert.equal(STARTUP_TIMING.cinematicMs >= 1500, true);
  assert.equal(STARTUP_TIMING.briefMs < 1000, true);
});

test('startup sequence stays decorative and uses the official bee', () => {
  const source = fs.readFileSync(path.join(root, 'components/startup/startup-sequence.js'), 'utf8');
  const css = fs.readFileSync(path.join(root, 'app/globals.css'), 'utf8');
  assert.equal(source.startsWith("'use client'"), true);
  assert.match(source, /aria-hidden="true"/);
  assert.match(source, /STARTUP_BEE/);
  assert.match(source, /STARTUP_ASSET/);
  assert.equal(source.includes('new Audio'), false);
  assert.equal(source.includes('window.open'), false);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /startup-veil-out/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /#0b0d0f/);
  assert.equal(STARTUP_ASSET, '/branding/beezmovies-logo.jpg');
  assert.equal(STARTUP_BEE, '/branding/beezmovies-bee.png');
  assert.equal(fs.existsSync(path.join(root, 'public', 'branding', 'beezmovies-bee.png')), true);
  assert.deepEqual(STARTUP_PHASES.map((phase) => phase.id), [
    'bee-enter',
    'bee-flight',
    'wordmark',
    'cinematic-transition',
    'homepage',
  ]);
});

test('manifest and service worker expose installable brand icons', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'public', 'manifest.webmanifest'), 'utf8'));
  const worker = fs.readFileSync(path.join(root, 'public', 'sw.js'), 'utf8');
  assert.equal(manifest.icons[0].src, '/branding/beezmovies-logo.jpg');
  assert.equal(manifest.icons.some((icon) => icon.sizes === '192x192'), true);
  assert.equal(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any'), true);
  assert.equal(manifest.icons.some((icon) => icon.purpose === 'maskable'), true);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.background_color, '#0B0D0F');
  assert.equal(manifest.theme_color, '#0B0D0F');
  for (const icon of manifest.icons) {
    assert.equal(fs.existsSync(path.join(root, 'public', icon.src)), true, icon.src);
  }
  assert.match(worker, /beezmovies-bee\.png/);
  assert.match(worker, /icon-192\.png/);
  assert.match(worker, /icon-512\.png/);
});
