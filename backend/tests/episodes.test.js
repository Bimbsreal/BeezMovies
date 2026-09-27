import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';
import { withTransaction } from '../src/db/transaction.js';
import { importEpisodeBatch, listEpisodeProgress } from '../src/catalog/episodes.js';
import { removeMovieDocuments, upsertMovieDocuments } from '../src/search/indexer.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const stamp = `p44${Date.now().toString(36)}`;
const slug = `phase-44-series-${stamp}`;
const episodeSlugs = [`phase-44-e1-${stamp}`, `phase-44-e2-${stamp}`];

let seriesId = null;

before(async () => {
  await seed();
});

after(async () => {
  await removeFixture();
  await closePool();
  await closeRedis();
});

async function removeFixture() {
  if (!seriesId) return;
  const pool = getPool();
  await pool.query(
    `DELETE FROM episode_progress
     WHERE episode_id IN (SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.series_id = $1)`,
    [seriesId],
  );
  await pool.query(
    `DELETE FROM media_references
     WHERE episode_id IN (SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.series_id = $1)
        OR movie_id = $1`,
    [seriesId],
  );
  await pool.query('DELETE FROM episodes WHERE season_id IN (SELECT id FROM seasons WHERE series_id = $1)', [seriesId]);
  await pool.query('DELETE FROM seasons WHERE series_id = $1', [seriesId]);
  await pool.query('DELETE FROM movie_genres WHERE movie_id = $1', [seriesId]);
  await pool.query('DELETE FROM movie_countries WHERE movie_id = $1', [seriesId]);
  await pool.query('DELETE FROM classification_reviews WHERE movie_id = $1', [seriesId]);
  await pool.query('DELETE FROM search_index_events WHERE movie_id = $1', [seriesId]);
  await removeMovieDocuments(seriesId);
  await pool.query('DELETE FROM movies WHERE id = $1', [seriesId]);
  seriesId = null;
}

test('episodic records stay empty until a real source exists, and a failed episode does not abort the batch', async () => {
  const pool = getPool();
  const empty = await request(app).get('/api/v1/shows/nosferatu').set(csrf);
  assert.equal(empty.status, 404);
  const seededEpisodes = await pool.query('SELECT COUNT(*)::int AS total FROM episodes');
  const before = seededEpisodes.rows[0].total;

  const inserted = await pool.query(
    `INSERT INTO movies (canonical_title, original_title, slug, synopsis, release_year, status, content_type_id, original_language_id)
     VALUES (
       'Phase Forty Four', 'Phase Forty Four', $1, 'A temporary episodic fixture.', 1970, 'draft',
       (SELECT id FROM content_types WHERE code = 'series'),
       (SELECT id FROM languages WHERE code = 'en')
     )
     RETURNING id`,
    [slug],
  );
  seriesId = inserted.rows[0].id;
  await pool.query(
    `INSERT INTO movie_countries (movie_id, country_id)
     SELECT $1, id FROM countries WHERE code = 'NG'`,
    [seriesId],
  );
  const drama = await pool.query(`SELECT id FROM genres WHERE slug = 'drama' AND archived_at IS NULL`);
  if (drama.rowCount) {
    await pool.query('INSERT INTO movie_genres (movie_id, genre_id) VALUES ($1, $2)', [seriesId, drama.rows[0].id]);
  }

  let first;
  await withTransaction(async (client) => {
    first = await importEpisodeBatch(client, seriesId, [
      { number: 0, title: 'Missing', episodes: [{ number: 1, title: 'Nope', slug: `phase-44-bad-season-${stamp}` }] },
      {
        number: 1,
        title: 'Season 1',
        episodes: [
          { number: 1, title: 'Arrival', slug: episodeSlugs[0], synopsis: 'The first chapter.', runtimeMinutes: 24, externalId: `phase-44:${stamp}:1` },
          { number: 2, title: 'Departure', slug: episodeSlugs[1], synopsis: 'The second chapter.', runtimeMinutes: 26 },
          { number: 3, title: 'Broken', slug: 'NOT A SLUG' },
        ],
      },
    ]);
  });
  assert.equal(first.find((row) => row.season === 0).ok, false);
  assert.equal(first.find((row) => row.episode === 1).ok, true);
  assert.equal(first.find((row) => row.episode === 3).ok, false);

  let second;
  await withTransaction(async (client) => {
    second = await importEpisodeBatch(client, seriesId, [{
      number: 1,
      title: 'Season 1',
      episodes: [
        { number: 1, title: 'Arrival', slug: episodeSlugs[0], externalId: `phase-44:${stamp}:1` },
        { number: 4, title: 'Duplicate source', slug: `phase-44-e4-${stamp}`, externalId: `phase-44:${stamp}:1` },
      ],
    }]);
  });
  assert.equal(second.find((row) => row.episode === 4).ok, false);
  const counts = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM seasons WHERE series_id = $1) AS seasons,
       (SELECT COUNT(*)::int FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.series_id = $1) AS episodes`,
    [seriesId],
  );
  assert.equal(counts.rows[0].seasons, 1);
  assert.equal(counts.rows[0].episodes, 2);

  const hidden = await request(app).get(`/api/v1/shows/${slug}`).set(csrf);
  assert.equal(hidden.status, 404);

  await pool.query(`UPDATE seasons SET status = 'active' WHERE series_id = $1`, [seriesId]);
  await pool.query(
    `UPDATE episodes SET status = 'active'
     WHERE season_id IN (SELECT id FROM seasons WHERE series_id = $1)`,
    [seriesId],
  );
  await pool.query(
    `INSERT INTO episodes (season_id, episode_number, title, slug, status)
     SELECT id, 9, 'Unpublished', $2, 'draft' FROM seasons WHERE series_id = $1`,
    [seriesId, `phase-44-draft-${stamp}`],
  );
  await pool.query(`UPDATE movies SET status = 'active' WHERE id = $1`, [seriesId]);
  await upsertMovieDocuments([seriesId]);

  const series = await request(app).get(`/api/v1/shows/${slug}`);
  assert.equal(series.status, 200);
  assert.equal(series.body.data.contentType.name, 'Series');
  assert.equal(series.body.data.seasons.length, 1);
  assert.equal(series.body.data.seasons[0].title, 'Season 1');
  assert.equal(series.body.data.seasons[0].episodeCount, 2);
  assert.equal(series.body.data.countries[0].slug, 'nigeria');
  assert.equal(series.body.data.industryLabels[0].label, 'Nollywood Series');
  assert.equal(series.body.data.industryLabels[0].href, '/series/nollywood');
  assert.deepEqual(series.body.data.related, []);

  const movieRoute = await request(app).get(`/api/v1/movies/${slug}`);
  assert.equal(movieRoute.status, 404);
  const seriesFile = await request(app).post(`/api/v1/movies/${slug}/download`).set(csrf).send({});
  assert.equal(seriesFile.status, 409);
  assert.equal(seriesFile.body.error.code, 'DOWNLOAD_NOT_SUPPORTED');

  const season = await request(app).get(`/api/v1/shows/${slug}/seasons/1`);
  assert.equal(season.status, 200);
  assert.equal(season.body.data.length, 2);
  assert.equal(season.body.data[0].mediaState.state, 'MEDIA_UNAVAILABLE');
  assert.equal(season.body.data.some((row) => row.number === 9), false);

  const episode = await request(app).get(`/api/v1/shows/${slug}/seasons/1/episodes/1`);
  assert.equal(episode.status, 200);
  assert.equal(episode.body.data.episode.title, 'Arrival');
  assert.equal(episode.body.data.next.title, 'Departure');
  assert.equal(episode.body.data.previous, null);
  const missing = await request(app).get(`/api/v1/shows/${slug}/seasons/1/episodes/9`);
  assert.equal(missing.status, 404);
  const download = await request(app).post(`/api/v1/shows/${slug}/seasons/1/episodes/1/download`).set(csrf).send({});
  assert.equal(download.status, 409);

  const anonymousProgress = await request(app).get('/api/v1/me/progress').set(csrf);
  assert.equal(anonymousProgress.status, 401);
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  const cookie = login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
  const episodeRow = await pool.query(
    `SELECT e.id FROM episodes e JOIN seasons s ON s.id = e.season_id WHERE s.series_id = $1 AND e.episode_number = 1`,
    [seriesId],
  );
  const saved = await request(app).put(`/api/v1/me/progress/${episodeRow.rows[0].id}`).set(csrf).set('Cookie', cookie).send({
    positionSeconds: 90,
    confirm: true,
  });
  assert.equal(saved.status, 200);
  const progress = await request(app).get('/api/v1/me/progress').set(csrf).set('Cookie', cookie);
  assert.equal(progress.body.data.stored, false);
  assert.deepEqual(progress.body.data.items, []);
  assert.equal(progress.body.data.episodes[0].episode, 1);
  assert.equal(progress.body.data.episodes[0].season, 1);
  assert.match(progress.headers['cache-control'], /private/);
  const stranger = await listEpisodeProgress('ffffffff-ffff-4fff-8fff-ffffffffffff');
  assert.equal(stranger.some((row) => row.seriesSlug === slug), false);

  const found = await request(app).get('/api/v1/search').query({ q: 'Phase Forty Four' });
  assert.equal(found.status, 200);
  assert.equal(found.body.data[0].slug, slug);
  assert.equal(found.body.data[0].contentType.name, 'Series');
  assert.ok(found.body.episodes.some((row) => row.kind === 'episode' && row.episode === 1));
  assert.ok(found.body.episodes.some((row) => row.kind === 'season'));

  const board = await request(app).get('/api/v1/admin/series').set(csrf);
  assert.equal(board.status, 401);
  const inspected = await request(app).get('/api/v1/admin/series').set(csrf).set('Cookie', cookie);
  assert.equal(inspected.status, 200);
  assert.ok(inspected.body.data.some((row) => row.slug === slug && row.status === 'active' && row.seasons === 1));

  const stillThere = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(stillThere.status, 200);

  await removeFixture();
  const afterDelete = await pool.query('SELECT COUNT(*)::int AS total FROM episodes');
  assert.equal(afterDelete.rows[0].total, before);
  const gone = await request(app).get(`/api/v1/shows/${slug}`);
  assert.equal(gone.status, 404);
});
