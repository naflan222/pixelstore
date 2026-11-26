'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { darazConfig, authorizationUrl, sign, seal, unseal, createClient } = require('../server/daraz-client');
const { inspectProduct } = require('../server/daraz-catalog');

const environment = {
  DARAZ_APP_KEY: 'fixture-key',
  DARAZ_APP_SECRET: 'fixture-secret',
  DARAZ_TOKEN_KEY: 'a0'.repeat(32),
  DARAZ_REDIRECT_URI: 'https://pixelhouse.lk/api/admin/daraz/callback'
};
const config = darazConfig(environment);

test('Daraz signing uses the API path and ASCII-sorted unencoded parameters', () => {
  const expected = crypto.createHmac('sha256', 'secret').update('/test/apibar2foo1foo_bar3foobar4').digest('hex').toUpperCase();
  assert.equal(sign('/test/api', { foo: '1', foobar: '4', foo_bar: '3', bar: '2', sign: 'ignored' }, 'secret'), expected);
});

test('seller authorization targets Sri Lanka and preserves callback and state', () => {
  const url = new URL(authorizationUrl(config, 'session-state'));
  assert.equal(url.origin, 'https://api.daraz.lk');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('state'), 'session-state');
  assert.equal(url.searchParams.get('redirect_uri'), environment.DARAZ_REDIRECT_URI);
  assert.equal(darazConfig({ ...environment, DARAZ_API_BASE_URL: 'https://example.com/rest' }), null);
});

test('encrypted credentials use random nonces and reject tampering', () => {
  const tokens = { accessToken: 'example-access', refreshToken: 'example-refresh' };
  const encrypted = seal(tokens, config.key);
  assert.notEqual(seal(tokens, config.key), encrypted);
  assert.deepEqual(unseal(encrypted, config.key), tokens);
  assert.throws(() => unseal(encrypted, Buffer.alloc(32)), /Reconnect/);
});

test('Daraz client signs read requests and honors a short throttle once', async () => {
  let calls = 0;
  const delays = [];
  const client = createClient(config, {
    clock: () => 1760000000000,
    wait: async ms => delays.push(ms),
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url.origin, 'https://api.daraz.lk');
      assert.equal(url.pathname, '/rest/products/get');
      assert.equal(options.redirect, 'error');
      const fields = Object.fromEntries(url.searchParams);
      assert.equal(fields.sign, sign('/products/get', fields, environment.DARAZ_APP_SECRET));
      return calls === 1
        ? new Response('{}', { status: 429, headers: { 'retry-after': '2' } })
        : Response.json({ code: '0', data: { products: [] } });
    }
  });
  assert.deepEqual(await client('/products/get', { limit: '1' }, { accessToken: 'example', retry: true }), { products: [] });
  assert.deepEqual(delays, [2000]);
});

test('single-use token exchange is posted once and provider errors stay private', async () => {
  let calls = 0;
  const client = createClient(config, {
    fetcher: async (url, options) => {
      calls++;
      assert.equal(url.href, 'https://api.daraz.com/rest/auth/token/create');
      assert.equal(options.method, 'POST');
      assert.equal(options.body.get('code'), 'one-use-code');
      return Response.json({ message: 'provider reflected one-use-code' }, { status: 500 });
    }
  });
  await assert.rejects(client('/auth/token/create', { code: 'one-use-code' }, { tokenEndpoint: true, method: 'POST' }),
    { message: 'Daraz is temporarily unavailable.' });
  assert.equal(calls, 1);
});

test('catalog dry run preserves zero stock and flags absent or duplicate listing data', () => {
  const product = { id: 1, name: 'Camera', sku: 'CAM', price: 105000, old_price: 140000, stock: 0 };
  const result = inspectProduct(product, 2, 0);
  assert.equal(result.stock, 0);
  assert.equal(result.regularPrice, 140000);
  assert.equal(result.promotionalPrice, 105000);
  assert.deepEqual(result.issues, ['Unique seller SKU', 'Description', 'Brand', 'Product image']);
});

test('admin OAuth state is single use and concurrent requests refresh once', async t => {
  const { freshSqlitePath, withServer } = require('./helpers');
  await withServer(t, { ...environment, DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(),
    SEED_DEMO_DATA: 'true' }, async ({ db, makeSession }) => {
    const base = '/api/admin/daraz';
    const seller = makeSession();
    assert.equal((await seller.get(base + '/preview')).status, 401);
    const login = await seller.post('/api/auth/login', { username: 'demo', password: 'demo1234' });
    assert.equal(login.status, 200);
    assert.equal((await seller.get(base + '/preview')).status, 200);

    const connect = await seller.post(base + '/connect');
    assert.equal(connect.status, 200);
    const { searchParams } = new URL(connect.data.url);
    const callback = base + '/callback?code=fixture&state=' + searchParams.get('state');
    assert.equal((await seller.get(base + '/callback?code=fixture&state=' + 'a'.repeat(43))).status, 409);
    const fetcher = global.fetch;
    let exchanges = 0;
    let refreshes = 0;
    const response = (access_token, expires_in) => Response.json({
      code: '0', country: 'lk', access_token, expires_in,
      refresh_token: 'fixture-refresh-' + access_token, refresh_expires_in: 86400
    });
    t.mock.method(global, 'fetch', async (url, options) => {
      const endpoint = new URL(url);
      if (endpoint.hostname === 'api.daraz.com') {
        if (endpoint.pathname.endsWith('/create')) {
          exchanges++;
          return response('initial', 25);
        }
        assert.equal(options.body.get('refresh_token'), 'fixture-refresh-initial');
        refreshes++;
        return response('rotated', 3600);
      }
      if (endpoint.hostname === 'api.daraz.lk') {
        assert.equal(endpoint.searchParams.get('access_token'), 'rotated');
        return Response.json({ code: '0', data: { products: [] } });
      }
      return fetcher(url, options);
    });

    assert.equal((await seller.get(callback)).status, 200);
    assert.equal((await seller.get(callback)).status, 409);
    assert.equal(exchanges, 1);
    for (const request of await Promise.all([seller.post(base + '/test'), seller.post(base + '/test')])) {
      assert.equal(request.status, 200);
    }
    assert.equal(refreshes, 1);
    const stored = await db.get('SELECT encrypted_tokens FROM daraz_authorization WHERE id = 1');
    assert.equal(unseal(stored.encrypted_tokens, config.key).accessToken, 'rotated');
    assert.equal((await seller.del(base + '/connection')).status, 204);
    assert.equal((await seller.get(base + '/status')).data.status, 'disconnected');
  });
});
