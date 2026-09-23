'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const {
  enhanceHtml,
  extractProduct,
  createHtmlHandler,
  createSitemapHandler,
} = require('../server/seo');

const root = path.join(__dirname, '..');

function read(filename) {
  return fs.readFileSync(path.join(root, filename), 'utf8');
}

test('homepage receives SEO metadata without removing storefront content', () => {
  const source = read('home.html');
  const result = enhanceHtml(source, 'home.html');

  assert.match(result, /<title>Pixel House Sri Lanka \| GoPro, DJI &amp; Insta360 Gear<\/title>/);
  assert.match(result, /<link rel="canonical" href="https:\/\/pixelhouse\.lk\/">/);
  assert.match(result, /<h1 class="visually-hidden">Action Cameras and Accessories in Sri Lanka<\/h1>/);
  assert.match(result, /"@type":"ElectronicsStore"/);
  assert.match(result, /"@type":"WebSite"/);
  assert.match(result, /GoPro, DJI &amp; Insta360 Accessories/);
  assert.match(result, /Rs\. 13,000/);
  assert.match(result, /href="style\.css"/);
  assert.match(result, /loading="lazy"/);
  assert.match(result, /decoding="async"/);
});

test('product page receives Product and Offer schema without fake ratings', () => {
  const source = read('wpdcase.html');
  const product = extractProduct(source);
  const result = enhanceHtml(source, 'wpdcase.html');

  assert.deepEqual(product, {
    name: 'Waterproof Diving Case',
    price: '4300',
    image: 'https://pixelhouse.lk/img/bg-img/wpdcase1.jpg',
  });
  assert.match(result, /<title>Waterproof Diving Case in Sri Lanka \| Pixel House<\/title>/);
  assert.match(result, /"@type":"Product"/);
  assert.match(result, /"priceCurrency":"LKR"/);
  assert.match(result, /"price":"4300"/);
  assert.doesNotMatch(result, /aggregateRating/);
  assert.doesNotMatch(source, /Very good product\.|4 ratings|100% Good Reviews/);
  assert.doesNotMatch(result, /Very good product\.|4 ratings|Flash sale end in/);
  assert.match(result, /No verified reviews yet/);
});

test('service worker refreshes deployed CSS and JavaScript before using cache', () => {
  const source = read('service-worker.js');

  assert.match(source, /pixelhouse-static-v2/);
  assert.match(source, /\['style', 'script'\]\.includes\(request\.destination\)/);
  assert.match(source, /fetch\(request\)[\s\S]*catch\(\(\) => caches\.match\(request\)\)/);
});

test('private transactional pages are explicitly excluded from indexing', () => {
  const source = read('cart.html');
  const result = enhanceHtml(source, 'cart.html');

  assert.match(result, /<meta name="robots" content="noindex,nofollow">/);
});

test('SEO enrichment is idempotent', () => {
  const once = enhanceHtml(read('home.html'), 'home.html');
  const twice = enhanceHtml(once, 'home.html');

  assert.equal((twice.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((twice.match(/data-seo-managed="true"/g) || []).length, 1);
  assert.equal((twice.match(/<h1\b/g) || []).length, 1);
});

test('Express serves enriched pages and a valid sitemap without redirects', async () => {
  const app = express();
  const htmlHandler = createHtmlHandler({ rootDir: root });
  app.get('/', htmlHandler);
  app.get(/^\/[A-Za-z0-9][A-Za-z0-9._-]*\.html$/, htmlHandler);
  app.get('/sitemap.xml', createSitemapHandler({ rootDir: root }));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });

  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const home = await fetch(`${base}/`);
    const homeText = await home.text();
    assert.equal(home.status, 200);
    assert.match(homeText, /rel="canonical" href="https:\/\/pixelhouse\.lk\/"/);

    const product = await fetch(`${base}/wpdcase.html`);
    const productText = await product.text();
    assert.equal(product.status, 200);
    assert.match(productText, /"@type":"Product"/);

    const sitemap = await fetch(`${base}/sitemap.xml`);
    const sitemapText = await sitemap.text();
    assert.equal(sitemap.status, 200);
    assert.match(sitemap.headers.get('content-type'), /application\/xml/);
    assert.match(sitemapText, /<loc>https:\/\/pixelhouse\.lk\/<\/loc>/);
    assert.match(sitemapText, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
    assert.doesNotMatch(sitemapText, /featured-products\.html|flash-sale\.html/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
