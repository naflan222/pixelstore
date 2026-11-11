'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const express = require('express');

const {
  enhanceHtml,
  extractProduct,
  createHtmlHandler,
  createSitemapHandler,
  canonicalHomepageRedirect,
} = require('../server/seo');

const root = path.join(__dirname, '..');

function read(filename) {
  return fs.readFileSync(path.join(root, filename), 'utf8');
}

function stylesheetHref(html) {
  const match = html.match(/<link\b[^>]*\brel="stylesheet"[^>]*\bhref="(style\.css(?:\?[^"\s]+)?)"/);
  assert.ok(match, 'Page must load the storefront stylesheet');
  assert.ok(fs.existsSync(path.join(root, match[1].split('?')[0])));
  return match[1];
}

test('home aliases redirect once and preserve query strings without changing API or checkout routes', async () => {
  const app = express();
  app.use(canonicalHomepageRedirect);
  app.use((req, res) => res.status(200).send('unchanged'));
  const server = app.listen(0);
  await new Promise(resolve => server.on('listening', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const pathname of ['/home.html', '/index.html']) {
      const response = await fetch(`${base}${pathname}?utm_source=google&x=a%2Fb`, { redirect: 'manual' });
      assert.equal(response.status, 301);
      assert.equal(response.headers.get('location'), '/?utm_source=google&x=a%2Fb');
      const target = await fetch(new URL(response.headers.get('location'), base));
      assert.equal(target.status, 200);
    }
    assert.equal((await fetch(`${base}/home.html`, { method: 'HEAD', redirect: 'manual' })).status, 301);
    for (const pathname of ['/', '/api/products', '/checkout.html', '/admin/', '/products.html']) {
      assert.equal((await fetch(base + pathname, { redirect: 'manual' })).status, 200);
    }
    assert.equal((await fetch(`${base}/home.html`, { method: 'POST', redirect: 'manual' })).status, 200);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('homepage receives SEO metadata without removing storefront content', () => {
  const source = read('home.html');
  const result = enhanceHtml(source, 'home.html');

  assert.match(result, /<title>Cameras in Sri Lanka \| GoPro, DJI &amp; Insta360 \| PixelHouse<\/title>/);
  assert.match(result, /<link rel="canonical" href="https:\/\/pixelhouse\.lk\/">/);
  assert.match(result, /<h1 class="visually-hidden">Cameras and GoPro Accessories in Sri Lanka<\/h1>/);
  assert.match(result, /"@type":"ElectronicsStore"/);
  assert.match(result, /"@type":"WebSite"/);
  assert.match(result, /GoPro, DJI &amp; Insta360 Accessories/);
  assert.match(result, /Rs\. 13,000/);
  assert.equal(stylesheetHref(result), stylesheetHref(source), 'SEO must preserve the page stylesheet, including its cache version');
  assert.match(result, /loading="lazy"/);
  assert.match(result, /decoding="async"/);
});

test('keyword targets stay focused on relevant camera and accessory pages', () => {
  const cases = [
    ['products.html', 'Cameras &amp; Accessories in Sri Lanka | PixelHouse', 'Shop cameras, GoPro accessories, selfie sticks'],
    ['catagory.html', 'GoPro Accessories Sri Lanka | PixelHouse', 'Find GoPro accessories in Sri Lanka'],
    ['actioncamera.html', 'GoPro &amp; Action Cameras in Sri Lanka | PixelHouse', 'Compare GoPro and other action cameras'],
  ];

  for (const [filename, title, description] of cases) {
    const result = enhanceHtml(read(filename), filename);
    assert.ok(result.includes('<title>' + title + '</title>'), filename + ': correct SEO title');
    assert.ok(result.includes('content="' + description), filename + ': focused description');
    assert.ok(result.includes('rel="canonical" href="https://pixelhouse.lk/' + filename + '"'), filename + ': canonical');
    assert.doesNotMatch(result, /Canon cameras|Action Pro cameras/i, filename + ': must not claim unverified inventory');
  }
});

test('GoPro and DJI accessory categories explain the products and keep crawlable links', () => {
  const cases = [
    ['catagory.html', 'GoPro Accessories Sri Lanka | PixelHouse', 'GoPro Accessories in Sri Lanka', 'products.html?category=GoPro%20Accessories', 'helmetstrap.html'],
    ['gpproducts2.html', 'GoPro Mounts, Chargers &amp; Accessories Sri Lanka | PixelHouse', 'GoPro Accessories in Sri Lanka', 'products.html?category=GoPro%20Accessories', 'domeport.html'],
    ['osmocat.html', 'DJI Osmo Action Accessories Sri Lanka | PixelHouse', 'DJI Osmo Action Accessories in Sri Lanka', 'products.html?category=Osmo%20Accessories', 'osmocap.html'],
  ];
  for (const [filename, title, heading, related, product] of cases) {
    const source = read(filename);
    const result = enhanceHtml(source, filename);
    assert.ok(result.includes('<title>' + title + '</title>'), filename + ': SEO title');
    assert.ok(result.includes('<h1 class="h5 mb-2" id="accessory-guide-title">' + heading + '</h1>'), filename + ': visible category heading');
    assert.ok(source.indexOf('data-category-guide') > source.indexOf('</nav>'), filename + ': guide follows product pagination');
    assert.doesNotMatch(source, /Need a camera instead|Looking for other options|More GoPro Accessories in Sri Lanka/);
    assert.equal((result.match(/<h1\b/g) || []).length, 1, filename + ': one main heading');
    assert.ok(result.includes('href="' + related + '"'), filename + ': related category');
    assert.ok(result.includes('href="' + product + '"'), filename + ': product link');
    assert.ok(result.includes('rel="canonical" href="https://pixelhouse.lk/' + filename + '"'), filename + ': canonical');
    assert.ok(result.includes('data-catalog-category='), filename + ': existing catalog remains functional');
    assert.equal(stylesheetHref(result), stylesheetHref(source), filename + ': design stylesheet unchanged');
  }
  assert.match(read('osmocat.html'), /href="osmocat\.html" aria-current="page">1<\/a>/);
});

test('priority product snippets remain distinct with live catalog data', () => {
  const cases = [
    { filename: 'hero13.html', title: 'GoPro HERO13 Black Camera in Sri Lanka | Pixel House', amount: 105000 },
    { filename: '3mstick.html', title: '3M Selfie Stick in Sri Lanka | Price & Details | Pixel House', amount: 8000 },
  ];

  for (const { filename, title, amount } of cases) {
    const result = enhanceHtml(read(filename), filename, {
      slug: filename.replace('.html', ''),
      name: 'Catalog product name',
      description: 'Short generic catalog copy.',
      price: amount,
      stock: 2,
      status: 'active',
      image: 'img/product/hero13.png',
    });
    assert.ok(result.includes('<title>' + title.replace(/&/g, '&amp;') + '</title>'));
    assert.match(result, /<meta name="description" content="Explore the/);
    assert.doesNotMatch(result, /Short generic catalog copy/);
    assert.ok(result.includes('"price":"' + amount + '"'));
    assert.match(result, /"@type":"Product"/);
    assert.match(result, /rel="canonical"/);
  }
  assert.match(read('home.html'), /href="hero13\.html">GoPro HERO13 Black camera/);
  assert.match(read('catagory.html'), /href="3mstick\.html">3M selfie stick/);
});

test('product page receives Product and Offer schema without fake ratings', () => {
  const source = read('wpdcase.html');
  const product = extractProduct(source);
  const result = enhanceHtml(source, 'wpdcase.html', {
    name: 'Waterproof Diving Case', description: 'Protective underwater housing.',
    price: 4300, image: 'img/bg-img/wpdcase1.jpg', stock: 5, status: 'active',
    sku: 'PH-WPD-1', brand: 'Telesin', mpn: 'WPD-13', gtin: '12345670',
  });

  assert.deepEqual(product, {
    name: 'Waterproof Diving Case',
    price: '4300',
    image: 'https://pixelhouse.lk/img/bg-img/wpdcase1.jpg',
  });
  assert.match(result, /<title>Waterproof Diving Case in Sri Lanka \| Pixel House<\/title>/);
  assert.match(result, /"@type":"Product"/);
  assert.match(result, /"priceCurrency":"LKR"/);
  assert.match(result, /"price":"4300"/);
  assert.match(result, /"availability":"https:\/\/schema\.org\/InStock"/);
  assert.match(result, /"shippingDetails"/);
  assert.match(result, /"hasMerchantReturnPolicy"/);
  assert.match(result, /"brand":\{"@type":"Brand","name":"Telesin"\}/);
  assert.match(result, /"mpn":"WPD-13"/);
  assert.match(result, /"gtin":"12345670"/);
  assert.doesNotMatch(result, /aggregateRating/);
  assert.doesNotMatch(source, /Very good product\.|4 ratings|100% Good Reviews/);
  assert.doesNotMatch(result, /Very good product\.|4 ratings|Flash sale end in/);
  assert.match(result, /id="productRatingSummary" hidden/);
  assert.doesNotMatch(result, /No verified reviews yet/);
});

test('dynamic catalog product pages receive their own canonical and metadata', async () => {
  const app = express();
  app.get(/^\/[A-Za-z0-9][A-Za-z0-9._-]*\.html$/, createHtmlHandler({
    rootDir: root,
    productLookup: async (slug) => slug === 'new-tripod'
      ? { slug, name: 'New Tripod', description: 'A sturdy action-camera tripod.', price: 3200, image: 'img/product/1.webp', stock: 4, status: 'active' }
      : null,
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/single-product.html?product=new-tripod`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<title>New Tripod in Sri Lanka \| Pixel House<\/title>/);
    assert.match(html, /rel="canonical" href="https:\/\/pixelhouse\.lk\/single-product\.html\?product=new-tripod"/);
    assert.match(html, /"name":"New Tripod"/);

    const missing = await fetch(`${base}/single-product.html?product=deleted-item`);
    assert.equal(missing.status, 404);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('all-products HTML contains crawlable catalog cards before client JavaScript runs', async () => {
  const catalog = Array.from({ length: 13 }, (_, index) => ({
    id: index + 1,
    slug: 'gopro-mount-' + (index + 1),
    name: 'GoPro Mount ' + (index + 1),
    description: 'Adjustable GoPro camera mount',
    category: 'GoPro Accessories',
    price: 1400 + index,
    stock: index === 0 ? 0 : 4,
    image: 'img/product/1.webp',
  }));
  catalog.push({
    id: 14,
    slug: 'camping-lantern',
    name: 'Camping <Lantern>',
    description: 'Rechargeable LED light for camping',
    category: 'Camping Accessories',
    price: 2200,
    stock: 2,
    image: 'javascript:alert(1)',
  });

  const app = express();
  app.get('/products.html', createHtmlHandler({
    rootDir: root,
    catalogList: async () => catalog,
  }));
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(base + '/products.html');
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /<title>Cameras &amp; Accessories in Sri Lanka \| PixelHouse<\/title>/);
    assert.match(html, /id="allProductsCount"[^>]*>14 products<\/span>/);
    assert.match(html, /href="single-product\.html\?product=gopro-mount-1"/);
    assert.match(html, /GoPro Mount 1/);
    assert.match(html, /Rs\. 1,400\.00/);
    assert.match(html, /Out of Stock/);
    assert.equal((html.match(/class="product-title"/g) || []).length, 12);
    assert.match(html, /href="products\.html\?page=2"/);
    assert.match(html, /js\/api-client\.js/);

    const nextPage = await (await fetch(base + '/products.html?page=2')).text();
    assert.match(nextPage, /GoPro Mount 13/);
    assert.match(nextPage, /Camping &lt;Lantern&gt;/);
    assert.doesNotMatch(nextPage, /src="javascript:/);

    const filtered = await (await fetch(base + '/products.html?category=Camping%20Accessories')).text();
    assert.match(filtered, /Camping &lt;Lantern&gt;/);
    assert.doesNotMatch(filtered, /class="product-title"[^>]*>GoPro Mount/);
    assert.match(filtered, /id="allProductsCount"[^>]*>1 product<\/span>/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('legacy dynamic URLs for products with static pages redirect to the clean canonical URL', async () => {
  const app = express();
  app.get(/^\/[A-Za-z0-9][A-Za-z0-9._-]*\.html$/, createHtmlHandler({
    rootDir: root,
    productLookup: async () => {
      throw new Error('Static duplicate should redirect before the database lookup');
    },
  }));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/single-product.html?product=3mstick`, { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/3mstick.html');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('category pages declare their live catalog category', () => {
  const categories = [
    ['catagory.html', 'GoPro Accessories'],
    ['actioncamera.html', 'Action Cameras'],
    ['insta360-camera.html', 'Insta360 Camera'],
    ['dji-osmo-camera.html', 'DJI Osmo Camera'],
    ['360accesories.html', 'Insta360 Accessories'],
    ['osmocat.html', 'Osmo Accessories'],
  ];
  for (const [filename, category] of categories) {
    assert.match(read(filename), new RegExp(`data-catalog-category="${category}"`));
  }
});

test('service worker installs current assets and refreshes CSS and JavaScript before using cache', async () => {
  const listeners = {};
  const calls = [];
  let installedAssets;
  let offline = false;
  const fresh = { ok: true, clone: () => 'fresh-copy' };
  const cached = { cached: true };
  vm.runInNewContext(read('service-worker.js'), {
    URL,
    self: {
      location: { origin: 'https://pixelhouse.lk' },
      addEventListener: (name, handler) => { listeners[name] = handler; },
      skipWaiting: () => {},
    },
    caches: {
      open: async () => ({
        addAll: async assets => { installedAssets = Array.from(assets); },
        put: async () => { calls.push('put'); },
      }),
      match: async () => { calls.push('cache'); return cached; },
    },
    fetch: async () => {
      calls.push('network');
      if (offline) throw new Error('Offline');
      return fresh;
    },
  });
  let installation;
  listeners.install({ waitUntil: promise => { installation = promise; } });
  await installation;
  const stylesheet = '/' + stylesheetHref(read('home.html'));
  const client = read('home.html').match(/<script\b[^>]*src="(js\/api-client\.js(?:\?[^"\s]+)?)"/);
  assert.ok(client, 'Homepage must load the storefront client');
  assert.ok(installedAssets.includes(stylesheet), 'Offline shell must use the homepage stylesheet version');
  assert.ok(installedAssets.includes('/' + client[1]), 'Offline shell must use the homepage client version');
  for (const asset of installedAssets) {
    if (asset !== '/') assert.ok(fs.existsSync(path.join(root, asset.split('?')[0])), `Missing offline asset: ${asset}`);
  }

  for (const destination of ['style', 'script']) {
    const request = { method: 'GET', url: 'https://pixelhouse.lk/' + (destination === 'style' ? 'style.css' : 'js/api-client.js'), destination };
    for (const isOffline of [false, true]) {
      offline = isOffline;
      calls.length = 0;
      let response;
      listeners.fetch({ request, respondWith: promise => { response = promise; } });
      assert.ok(response, 'Static assets must be handled by the service worker');
      assert.equal(await response, isOffline ? cached : fresh);
      assert.equal(calls[0], 'network');
      assert.equal(calls.includes('cache'), isOffline, 'Cache is only used when the network fails');
      if (!isOffline) assert.ok(calls.includes('put'), 'Fresh assets must update the offline cache');
    }
  }

  for (const pathname of ['/api/products', '/api/checkout-settings', '/admin/', '/cart.html', '/checkout.html', '/profile.html']) {
    let intercepted = false;
    listeners.fetch({
      request: { method: 'GET', url: 'https://pixelhouse.lk' + pathname, mode: 'navigate' },
      respondWith: () => { intercepted = true; },
    });
    assert.equal(intercepted, false, `Private/live data must bypass the cache: ${pathname}`);
  }
});

test('homepage adventure banner uses the new photo and GoPro category pages expose the working camera filters', () => {
  assert.match(read('home.html'), /img\/core-img\/camera-adventure\.webp/);
  for (const filename of ['catagory.html', 'gpproducts2.html']) {
    const source = read(filename);
    assert.match(source, /aria-label="Filter products"/);
    assert.match(source, /data-camera-apply/);
    assert.doesNotMatch(source, /Zara|Gucci|Xtra Large/);
    assert.match(source, /data-catalog-category="GoPro Accessories"/);
  }
});

test('storefront exposes the requested footer and admin-managed homepage sections', () => {
  const home = read('home.html');
  const apiClient = read('js/api-client.js');
  const admin = read('admin/index.html');
  for (const key of ['featured_gear', 'top_products', 'weekly_best_sellers', 'featured_products']) {
    assert.match(home, new RegExp(`data-home-products="${key}"`));
  }
  assert.match(apiClient, /homepage-sections/);
  assert.match(apiClient, /Quick delivery/);
  assert.match(apiClient, /24\/7 support/);
  assert.match(apiClient, /Genuine products/);
  assert.match(apiClient, /Customer reviews/);
  assert.match(apiClient, /aria-label="Customer reviews"/);
  assert.match(apiClient, /data-manual-review-text/);
  assert.match(apiClient, /data-manual-review-author/);
  assert.match(apiClient, /data-manual-review-position/);
  assert.match(apiClient, /data-manual-review-next/);
  assert.match(apiClient, /data-manual-review-prev/);
  assert.match(apiClient, /data-customer-reviews/);
  assert.match(apiClient, /get\('\/reviews\/recent\?page=/);
  assert.match(apiClient, /wa\.me\/94777466675/);
  stylesheetHref(read('profile.html'));
  assert.match(admin, /Homepage product sections/);
  assert.match(read('shipping-policy.html'), /SHIPPING POLICY/);
  assert.ok(fs.existsSync(path.join(root, 'img/core-img/logo-mark-hd.png')));
  assert.ok(fs.existsSync(path.join(root, 'img/core-img/pixelhouse-footer-logo.jpg')));
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
  app.get('/sitemap.xml', createSitemapHandler({
    rootDir: root,
    productList: async () => [
      { slug: '3mstick', created_at: '2026-09-22' },
      { slug: 'new-tripod', created_at: '2026-09-23' },
    ],
  }));

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
    assert.match(sitemapText, /https:\/\/pixelhouse\.lk\/single-product\.html\?product=new-tripod/);
    assert.match(sitemapText, /https:\/\/pixelhouse\.lk\/3mstick\.html/);
    assert.doesNotMatch(sitemapText, /single-product\.html\?product=3mstick/);
    assert.equal((sitemapText.match(/https:\/\/pixelhouse\.lk\/3mstick\.html/g) || []).length, 1);
    assert.doesNotMatch(sitemapText, /featured-products\.html|flash-sale\.html/);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
