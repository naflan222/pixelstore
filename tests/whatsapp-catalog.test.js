'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildFeed } = require('../server/meta-catalog');
const { whatsappImageFor, buildWhatsAppFeed } = require('../server/whatsapp-catalog');

const product = (id, overrides = {}) => ({
  id, name: 'GoPro Accessory ' + id, description: 'Mount and adapter',
  price: 800, old_price: 1200, stock: 3, url_slug: 'mount-' + id,
  image: 'img/product/18.png', brand: '', mpn: '', gtin: '',
  ...overrides,
});

test('WhatsApp image URL is separate from the original website image', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-wa-'));
  try {
    fs.writeFileSync(path.join(dir, 'PH-1.jpg'), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const products = [product(1), product(2, { stock: 0 })];
    const oldFeed = buildFeed(products);
    const feed = buildWhatsAppFeed(products, { cardDir: dir });
    assert.equal(feed.count, 2);
    assert.equal(feed.redesigned, 1);
    assert.equal(feed.fallback, 1);
    assert.equal(feed.skipped, 0);
    assert.match(feed.csv, /https:\/\/pixelhouse\.lk\/img\/whatsapp-cards\/PH-1\.jpg/);
    assert.match(feed.csv, /https:\/\/pixelhouse\.lk\/img\/product\/18\.png/);
    assert.match(feed.csv, /"PH-1"/);
    assert.match(feed.csv, /"PH-2"/);
    assert.match(feed.csv, /"out of stock"/);
    assert.match(feed.csv, /"1200\.00 LKR"/);
    // Import into Meta is manual: the existing feed and source photos
    // still use their original unmodified image links.
    assert.doesNotMatch(oldFeed.csv, /img\/whatsapp-cards/);
    assert.equal(products[0].image, 'img/product/18.png');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Never construct custom URLs for arbitrary or unsafe IDs', () => {
  assert.equal(
    whatsappImageFor({id: '../broken', image_link: 'https://pixelhouse.lk/img/product/18.png'}),
    'https://pixelhouse.lk/img/product/18.png'
  );
});

test('Unusable products are omitted consistently in both feeds', () => {
  const products = [product(1), product(2, { price: 0 }), product(3, { image: '' })];
  const feed = buildWhatsAppFeed(products);
  assert.equal(feed.skipped, 2);
  assert.equal(feed.count, 1);
});
