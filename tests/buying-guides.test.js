'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const express = require('express');
const { createHtmlHandler, createSitemapHandler, enhanceHtml } = require('../server/seo');
const { ROUTE_FILES, FILE_PATHS } = require('../server/storefront-urls');
const guides = require('../server/guide-pages.json');
const { applyBuyingCopy } = require('../server/buying-copy');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
test('guides are crawlable, canonical, linked and included once in the sitemap', async () => {
  const app = express();
  app.get(Object.keys(ROUTE_FILES), createHtmlHandler({ rootDir: root }));
  app.get('/sitemap.xml', createSitemapHandler({ rootDir: root }));
  const server = app.listen(0); await new Promise(resolve => server.on('listening', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    const sitemap = await (await fetch(base + '/sitemap.xml')).text();
    for (const [file, guide] of Object.entries(guides)) {
      assert.equal(FILE_PATHS[file], guide.route);
      const response = await fetch(base + guide.route); assert.equal(response.status, 200);
      const html = await response.text();
      assert.match(html, /name="robots" content="index,follow/);
      assert.ok(html.includes('rel="canonical" href="https://pixelhouse.lk' + guide.route + '"'));
      assert.equal((html.match(/<h1\b/g) || []).length, 1);
      assert.ok(sitemap.includes('<loc>https://pixelhouse.lk' + guide.route + '</loc>'));
      assert.match(html, /<base href="\/">/);
      assert.doesNotMatch(html, /class="sale-price"/);
      const graph = JSON.parse(html.match(/<script type="application\/ld\+json" data-seo-managed="true">([\s\S]*?)<\/script>/)[1])['@graph'];
      assert.equal(graph.some(node => node['@type'] === 'Article'), file !== 'guides.html');
      for (const match of html.matchAll(/href="(\/guides[^"#?]*)"/g)) assert.ok(Object.values(guides).some(g => g.route === match[1]), match[1]);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
});
test('product advice preserves admin text, escapes it, and never leaks to unrelated products', () => {
  const source = read('hero13.html');
  const product = { slug: 'hero13', description: '<img onerror=bad> Admin updated copy', name: 'GoPro', price: 123, stock: 0 };
  const output = enhanceHtml(source, 'hero13.html', product);
  assert.match(output, /&lt;img onerror=bad&gt; Admin updated copy/);
  assert.match(output, /data-buying-copy="hero13"/);
  assert.match(output, /"price":"123"/);
  assert.match(output, /https:\/\/schema.org\/OutOfStock/);
  assert.match(output, /href="\/guides\/choosing-action-camera-sri-lanka"/);
  assert.equal(applyBuyingCopy(source, 'hero13.html', { slug: 'different-item' }), source);
  assert.equal(applyBuyingCopy(read('gbattery.html'), 'gbattery.html', { slug: 'gbattery' }), read('gbattery.html'));
  const chest = applyBuyingCopy(read('single-product.html'), 'single-product.html', { slug: 'imported-chest', url_slug: 'adjustable-chest-strap-camera-mount', description: 'Live chest description' });
  assert.match(chest, /A hands-free viewpoint/);
  assert.doesNotMatch(chest, /This complete action camera accessory kit/);
});
