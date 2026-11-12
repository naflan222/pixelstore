'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FILE_PATHS, cleanHref } = require('../js/storefront-routes');
const { freshSqlitePath, withServer } = require('./helpers');
const { ensureProductUrls } = require('../server/product-urls');

test('URL registry preserves filters, explicit pagination, hashes and external destinations', () => {
  assert.equal(cleanHref('/gpproducts2.html'), '/gopro-accessories?page=2');
  assert.equal(cleanHref('/gpproducts2.html?page=3&camera_type=mount&x=a%2Fb&x=c'), '/gopro-accessories?page=3&camera_type=mount&x=a%2Fb&x=c');
  assert.equal(cleanHref('/gpproducts2.html?page=1'), '/gopro-accessories');
  const products = { 'fhstick.html': '/product/floating-handle-stick-gopro', 'single-product.html': '/product/accessory-kit' };
  assert.equal(cleanHref('single-product.html?product=fhstick&utm_source=google#reviews', products), '/product/floating-handle-stick-gopro?utm_source=google#reviews');
  assert.equal(cleanHref('#reviews', products, 'https://pixelhouse.lk', '/product/floating-handle-stick-gopro'), '/product/floating-handle-stick-gopro#reviews');
  for (const value of ['https://example.com/products.html', 'mailto:contact@pixelhouse.lk', 'tel:0777466675', '/api/products']) assert.equal(cleanHref(value), value);
});

test('whole-site clean URLs preserve legacy routes, product identity, private caching and sitemap', async t => {
  await withServer(t, { DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(), NODE_ENV: 'test', SEED_DEMO_DATA: 'true' }, async ctx => {
    for (const [file, target] of Object.entries(FILE_PATHS)) {
      if (!fs.existsSync(path.join(__dirname, '..', file))) continue;
      const legacy = await fetch(ctx.base + '/' + file, { redirect: 'manual' });
      assert.equal(legacy.status, 301, file);
      assert.equal(legacy.headers.get('location'), target, file);
      const response = await fetch(ctx.base + target, { redirect: 'manual' });
      assert.equal(response.status, 200, target);
    }
    const redirect = await fetch(ctx.base + '/gpproducts2.html?page=3&camera_brand=GoPro&x=a%2Fb', { method: 'HEAD', redirect: 'manual' });
    assert.equal(redirect.status, 301);
    assert.equal(redirect.headers.get('location'), '/gopro-accessories?page=3&camera_brand=GoPro&x=a%2Fb');
    const slash = await fetch(ctx.base + '/products/?q=GoPro', { redirect: 'manual' });
    assert.equal(slash.headers.get('location'), '/products?q=GoPro');
    const page2 = await (await fetch(ctx.base + '/gopro-accessories?page=2&camera_brand=GoPro')).text();
    assert.match(page2, /rel="canonical" href="https:\/\/pixelhouse\.lk\/gopro-accessories\?page=2"/);
    for (const route of ['/login','/cart','/checkout','/profile','/my-order']) {
      const response = await fetch(ctx.base + route);
      assert.match(response.headers.get('cache-control'), /no-store/);
      assert.match(await response.text(), /noindex/);
    }
    const products = (await (await fetch(ctx.base + '/api/products')).json()).products;
    for (const product of products) {
      assert.match(product.url_path, /^\/product\/[a-z0-9-]+$/);
      const target = await fetch(ctx.base + product.url_path);
      assert.equal(target.status, 200, product.url_path);
      const html = await target.text();
      assert.ok(html.includes('rel="canonical" href="https://pixelhouse.lk' + product.url_path + '"'));
      assert.match(html, /<base href="\/">/);
      assert.ok(html.includes('data-product-slug="' + product.slug + '"'));
      for (const old of ['/single-product.html?product=' + product.slug, '/' + product.slug + '.html']) {
        const moved = await fetch(ctx.base + old, { redirect: 'manual' });
        assert.equal(moved.status, 301, old);
        assert.equal(moved.headers.get('location'), product.url_path);
      }
    }
    const before = await ctx.db.all('SELECT id, url_slug FROM products ORDER BY id');
    await ensureProductUrls(ctx.db); await ensureProductUrls(ctx.db);
    assert.deepEqual(await ctx.db.all('SELECT id, url_slug FROM products ORDER BY id'), before);
    const owner = ctx.makeSession(); await owner.post('/api/auth/login', { username: 'demo', password: 'demo1234' });
    const name = 'Duplicate Friendly Product';
    for (const slug of ['duplicate-one','duplicate-two']) {
      const added = await owner.post('/api/admin/products', { name, slug, price: 100, stock: 2, image: 'img/product/1.webp' });
      assert.equal(added.status, 201);
    }
    const first = (await owner.get('/api/products/duplicate-one')).data.product;
    const second = (await owner.get('/api/products/duplicate-two')).data.product;
    assert.equal(first.url_path, '/product/duplicate-friendly-product');
    const cachedCartAlias = await fetch(ctx.base + '/duplicate-one.html?utm_source=old-cart', { redirect: 'manual' });
    assert.equal(cachedCartAlias.status, 301);
    assert.equal(cachedCartAlias.headers.get('location'), first.url_path + '?utm_source=old-cart');
    assert.equal(second.url_path, '/product/duplicate-friendly-product-' + second.id);
    await ctx.db.run('UPDATE products SET name = ? WHERE id = ?', 'Changed product name', first.id);
    assert.equal((await owner.get('/api/products/duplicate-one')).data.product.url_path, first.url_path);
    await ctx.db.run("UPDATE products SET status = 'inactive' WHERE id = ?", second.id);
    assert.equal((await fetch(ctx.base + second.url_path)).status, 404);
    assert.equal((await fetch(ctx.base + '/product/not-a-real-product')).status, 404);
    const sitemap = await (await fetch(ctx.base + '/sitemap.xml')).text();
    assert.doesNotMatch(sitemap, /\.html|<loc>[^<]*(?:checkout|profile|login)/);
    const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
    assert.equal(locations.length, new Set(locations).size);
    assert.ok(locations.includes('https://pixelhouse.lk' + first.url_path));
    assert.ok(!locations.includes('https://pixelhouse.lk' + second.url_path));
  });
});
