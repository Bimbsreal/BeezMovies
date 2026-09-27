import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { seed } from '../src/db/seed.js';
import { getPool, closePool } from '../src/db/pool.js';
import { closeRedis } from '../src/redis/client.js';

const app = createApp();
const csrf = { 'x-beezmovies-request': '1' };
const sessionId = '11111111-1111-4111-8111-111111111111';

before(async () => {
  await seed();
});

after(async () => {
  const pool = getPool();
  await pool.query('DELETE FROM monetization_events');
  await pool.query('DELETE FROM monetization_creatives');
  await pool.query(`UPDATE monetization_placements SET enabled = FALSE`);
  await pool.query(`UPDATE monetization_providers SET status = 'disabled'`);
  await closePool();
  await closeRedis();
});

async function adminCookie() {
  const login = await request(app).post('/api/v1/auth/login').set(csrf).send({
    email: 'admin@beezmovies.local',
    password: 'BeezLocalAdmin1',
  });
  assert.equal(login.status, 200);
  return login.headers['set-cookie'].find((line) => line.startsWith('beezmovies_session=')).split(';')[0];
}

async function enableHouseFeed(cookie) {
  const provider = await request(app).patch('/api/v1/admin/monetization/providers/house').set(csrf).set('Cookie', cookie).send({
    status: 'enabled', confirm: true,
  });
  assert.equal(provider.status, 200);
  assert.equal(provider.body.data.publicDelivery, 'active');
  const creative = await request(app).post('/api/v1/admin/monetization/creatives').set(csrf).set('Cookie', cookie).send({
    placement: 'IN_FEED_NATIVE',
    headline: 'A quiet note',
    body: 'House creative for the local catalog.',
    confirm: true,
  });
  assert.equal(creative.status, 201);
  const placement = await request(app).patch('/api/v1/admin/monetization/placements/IN_FEED_NATIVE').set(csrf).set('Cookie', cookie).send({
    enabled: true,
    desktopEnabled: true,
    mobileEnabled: false,
    providerSlug: 'house',
    priority: 10,
    frequencyLimit: 1,
    minIntervalSeconds: 3600,
    pageLimit: 1,
    confirm: true,
  });
  assert.equal(placement.status, 200);
}

test('monetization stays collapsed until a verified placement is enabled', async () => {
  const config = await request(app).get('/api/v1/monetization/config');
  assert.equal(config.status, 200);
  assert.deepEqual(config.body.data.placements, []);
  assert.equal(config.body.data.estimatedRevenue, undefined);

  const download = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(download.status, 200);
  assert.equal(download.body.data.state, 'ready');
  assert.equal(JSON.stringify(download.body).includes('placement'), false);

  const anonymous = await request(app).get('/api/v1/admin/monetization');
  assert.equal(anonymous.status, 401);
  const cookie = await adminCookie();
  const blocked = await request(app).patch('/api/v1/admin/monetization/providers/exoclick').set(csrf).set('Cookie', cookie).send({
    status: 'enabled', confirm: true,
  });
  assert.equal(blocked.body.data.publicDelivery, 'inactive');
  await enableHouseFeed(cookie);

  const enabled = await request(app).get('/api/v1/monetization/config');
  assert.equal(enabled.body.data.placements.length, 1);
  assert.equal(enabled.body.data.placements[0].slug, 'IN_FEED_NATIVE');
  assert.equal(enabled.body.data.placements[0].creative.label, 'Sponsored');
  assert.equal(enabled.body.data.placements[0].mobileEnabled, false);
  assert.equal(enabled.body.data.placements[0].desktopEnabled, true);
  assert.equal(JSON.stringify(enabled.body).includes('api_key'), false);

  const downloadWithAds = await request(app).post('/api/v1/movies/nosferatu/download').set(csrf).send({});
  assert.equal(downloadWithAds.status, 200);
  assert.equal(downloadWithAds.body.data.resourceType, 'download');

  const first = await request(app).post('/api/v1/monetization/events').set(csrf).send({
    type: 'impression', placement: 'IN_FEED_NATIVE', sessionId,
  });
  assert.equal(first.body.data.accepted, true);
  const second = await request(app).post('/api/v1/monetization/events').set(csrf).send({
    type: 'impression', placement: 'IN_FEED_NATIVE', sessionId,
  });
  assert.equal(second.body.data.accepted, false);
  assert.equal(second.body.data.reason, 'frequency');

  const revenue = await request(app).post('/api/v1/monetization/events').set(csrf).send({
    type: 'impression', placement: 'IN_FEED_NATIVE', sessionId, revenue: 50,
  });
  assert.equal(revenue.status, 400);

  const saved = await request(app).post('/api/v1/admin/monetization/affiliate-events').set(csrf).set('Cookie', cookie).send({
    provider: 'rapidgator',
    campaign: 'local-note',
    placement: 'FOOTER_NATIVE',
    conversionReference: 'ref-local-1',
    confirm: true,
  });
  assert.equal(saved.status, 201);
  const invalid = await request(app).post('/api/v1/admin/monetization/affiliate-events').set(csrf).set('Cookie', cookie).send({
    provider: 'rapidgator',
    campaign: 'local-note',
    placement: 'FOOTER_NATIVE',
    conversionReference: 'ref-local-2',
    revenue: 10,
    confirm: true,
  });
  assert.equal(invalid.status, 400);
  const redirect = await request(app).post('/api/v1/admin/monetization/affiliate-events').set(csrf).set('Cookie', cookie).send({
    provider: 'https://rapidgator.net/aff',
    campaign: 'local-note',
    placement: 'FOOTER_NATIVE',
    conversionReference: 'ref-local-3',
    confirm: true,
  });
  assert.equal(redirect.status, 400);
  const overview = await request(app).get('/api/v1/admin/monetization/revenue').set(csrf).set('Cookie', cookie);
  assert.equal(overview.body.data.estimatedRevenue, 'Not available');
  assert.equal(overview.body.data.recorded.affiliateEvents >= 1, true);
  assert.equal(JSON.stringify(overview.body).includes('password'), false);
});
