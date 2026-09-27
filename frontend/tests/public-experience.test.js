import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { canRequestDownload, confirmedQuality, isPlayablePreview, jsonLd, previewUrl, releaseYear, trustedTrailerUrl } from '../lib/catalog/present.js';

const root = path.resolve(import.meta.dirname, '..');

test('public routes exist and download stays optional', () => {
  const pages = [
    'app/page.js',
    'app/movies/page.js',
    'app/movie/[slug]/page.js',
    'app/countries/page.js',
    'app/languages/page.js',
    'app/languages/[code]/page.js',
    'app/movies/[slug]/page.js',
    'app/genre/[slug]/page.js',
    'app/collection/[slug]/page.js',
    'app/search/page.js',
  ];
  for (const page of pages) {
    assert.equal(fs.existsSync(path.join(root, page)), true, page);
  }
  const download = fs.readFileSync(path.join(root, 'components/movies/download-button.js'), 'utf8');
  const hero = fs.readFileSync(path.join(root, 'components/movies/hero.js'), 'utf8');
  assert.match(download, /Download/);
  assert.equal(download.includes('Login required'), false);
  assert.equal(download.includes('window.open'), false);
  assert.match(download, /href\.startsWith\('\/'\)/);
  assert.match(hero, /View details/);
  assert.equal(hero.includes('DownloadButton'), false);
});

test('playable previews accept only direct https video files', () => {
  assert.equal(isPlayablePreview('https://videos.example.com/beezmovies/trailers/nosferatu'), false);
  assert.equal(isPlayablePreview('https://cdn.example.com/preview.mp4'), true);
  assert.equal(isPlayablePreview('http://cdn.example.com/preview.mp4'), false);
  assert.equal(trustedTrailerUrl('https://cdn.example.com/preview.mp4'), null);
  assert.equal(trustedTrailerUrl('https://videos.example.com/preview.mp4'), 'https://videos.example.com/preview.mp4');
  assert.equal(previewUrl({
    trailers: [{ type: 'trailer', url: 'https://videos.example.com/beezmovies/trailers/nosferatu' }],
  }), null);
  assert.equal(previewUrl({
    trailers: [{ type: 'trailer', url: 'https://videos.example.com/preview.mp4' }],
  }), 'https://videos.example.com/preview.mp4');
  assert.equal(confirmedQuality({ media: [{ quality: '1080p', availability: 'available' }] }), '1080p');
  assert.equal(confirmedQuality({ media: [{ quality: '4K', availability: 'available' }] }), null);
  assert.equal(releaseYear({ releaseYear: 1922 }), '1922');
  assert.equal(jsonLd({ name: '</script><script>alert(1)</script>' }).includes('<'), false);
  assert.equal(canRequestDownload({
    media: [{ mediaType: 'stream', availability: 'available' }],
  }), false);
  assert.equal(canRequestDownload({
    mediaState: { state: 'MEDIA_AVAILABLE' },
  }), true);
  assert.equal(canRequestDownload({
    mediaState: { state: 'REVIEW_REQUIRED' },
    media: [{ mediaType: 'download', availability: 'available' }],
  }), false);
  assert.equal(canRequestDownload({ media: [] }), false);
});

test('the trailer player stays separate from download and waits to load media', () => {
  const player = fs.readFileSync(path.join(root, 'components/movies/trailer-player.js'), 'utf8');
  const preview = fs.readFileSync(path.join(root, 'components/movies/preview-button.js'), 'utf8');
  const movie = fs.readFileSync(path.join(root, 'app/movie/[slug]/page.js'), 'utf8');
  const downloadSource = fs.readFileSync(path.join(root, 'components/movies/download-button.js'), 'utf8');
  assert.match(player, /preload="none"/);
  assert.match(player, /controlsList="nodownload/);
  assert.match(player, /releaseTrailer/);
  assert.match(player, /This trailer could not be played/);
  assert.equal(player.includes('window.open'), false);
  assert.match(preview, /TrailerPlayer/);
  assert.match(preview, /Escape/);
  assert.match(movie, /Trailer unavailable/);
  assert.match(movie, /mediaAvailabilityLabel/);
  assert.match(fs.readFileSync(path.join(root, 'lib/catalog/present.js'), 'utf8'), /Download unavailable/);
  assert.match(movie, /DownloadButton/);
  assert.match(player, /Mute/);
  assert.match(preview, /Play trailer/);
  assert.match(downloadSource, /Preparing download\.\.\./);
  assert.match(downloadSource, /Starting download\.\.\./);
  assert.match(downloadSource, /Provider temporarily unavailable/);
  assert.match(downloadSource, /Try again/);
  assert.equal(movie.includes('video.example'), false);
});

test('staging is not indexable and development stays indexable', async () => {
  const { allowIndexing } = await import('../lib/config.js');
  assert.equal(allowIndexing('production'), true);
  assert.equal(allowIndexing('staging'), false);
  assert.equal(allowIndexing('development'), true);
});
