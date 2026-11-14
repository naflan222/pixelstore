// Feed generation stays database-agnostic and never needs Meta API credentials.
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FIELDS, csvCell, imageUrl, catalogRow, buildFeed } = require('../server/meta-catalog');

function product(overrides = {}) {
  return {
    id: 42, name: 'GoPro HERO13 Black', description: 'Action camera',
    price: 105000, old_price: 140000, stock: 3, url_slug: 'gopro-hero13-black',
    image: 'img/product/hero13.png', brand: 'GoPro', mpn: '', gtin: '',
    ...overrides,
  };
}

test('CSV quotes commas, quotes and embedded newlines', () => {
  assert.equal(csvCell('A, "B"\nC'), '"A, ""B""\nC"');
  assert.deepEqual(FIELDS.slice(0, 3), ['id', 'title', 'description']);
});

test('uses latest stock and lists a promotion using regular and sale prices', () => {
  const row = catalogRow(product());
  assert.equal(row.id, 'PH-42');
  assert.equal(row.availability, 'in stock');
  assert.equal(row.price, '140000.00 LKR');
  assert.equal(row.sale_price, '105000.00 LKR');
  assert.equal(row.link, 'https://pixelhouse.lk/product/gopro-hero13-black');
  assert.equal(row.image_link, 'https://pixelhouse.lk/img/product/hero13.png');
  assert.equal(catalogRow(product({ stock: 0, old_price: null })).availability, 'out of stock');
  assert.equal(catalogRow(product({ old_price: null })).sale_price, '');
});

test('web-served uploaded primary photos get an HTTPS image endpoint', () => {
  const row = product({
    image: 'data:image/png;base64,aGVsbG8=',
    primary_image_id: 82,
  });
  assert.equal(imageUrl(row), 'https://pixelhouse.lk/meta-catalog/images/42?v=82');
  assert.equal(imageUrl({ ...row, image: 'data:' }),
    'https://pixelhouse.lk/meta-catalog/images/42?v=82');
});

test('rejects unserved and unsafe image paths', () => {
  assert.equal(imageUrl(product({ image: '../../secrets.png' })), null);
  assert.equal(imageUrl(product({ image: 'data:text/html;base64,abc' })), null);
  assert.equal(imageUrl(product({ image: 'javascript:alert(1)' })), null);
  assert.equal(imageUrl(product({ image: '/img/product/hero13.png' })),
    'https://pixelhouse.lk/img/product/hero13.png');
});

test('only valid products enter the feed, missing brand is explicit', () => {
  const items = [
    product({ id: 1, name: 'A, "quoted" camera', brand: '' }),
    product({ id: 2, price: 0 }),
    product({ id: 3, url_slug: '', image: 'img/product/3.png' }),
  ];
  const feed = buildFeed(items);
  assert.equal(feed.count, 1);
  assert.equal(feed.skipped, 2);
  assert.match(feed.csv, /"A, ""quoted"" camera"/);
  assert.match(feed.csv, /"Unbranded"/);
  assert.match(feed.csv, /"PH-1"/);
  assert.ok(!feed.csv.includes('"PH-2"'));
});
