import test from 'node:test';
import assert from 'node:assert/strict';
import { publicTrailerUrl } from '../src/media/trailers.js';

test('public trailer URLs stay on the authorized host and a direct file', () => {
  assert.equal(publicTrailerUrl('https://videos.example.com/beezmovies/trailers/nosferatu'), null);
  assert.equal(publicTrailerUrl('https://cdn.example.com/preview.mp4'), null);
  assert.equal(publicTrailerUrl('http://videos.example.com/preview.mp4'), null);
  assert.equal(publicTrailerUrl('https://user:pass@videos.example.com/preview.mp4'), null);
  assert.equal(
    publicTrailerUrl('https://videos.example.com/preview.mp4'),
    'https://videos.example.com/preview.mp4',
  );
});
