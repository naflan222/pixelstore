const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelhouse-public-reviews-'));
process.env.SQLITE_DB_PATH = path.join(dir, 'test.db');
process.env.DB_ENGINE = process.env.REVIEWS_TEST_ENGINE === 'postgres' ? 'postgres' : 'sqlite';
if (process.env.DB_ENGINE === 'postgres') process.env.PG_MEM_TEST = '1';
delete process.env.DATABASE_URL;
process.env.SEED_DEMO_DATA = 'true';
process.env.NODE_ENV = 'test';
const db = require('../server/database');
const router = require('../server/routes');

async function readReviews(query = {}) {
  const route = router.stack.find(layer => layer.route && layer.route.path === '/reviews/recent').route;
  const response = { statusCode: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.data = value; } };
  await route.stack[0].handle({ query }, response);
  return response;
}

test('public review pagination exposes every published review but no hidden or inactive-product reviews', async t => {
  await db.init();
  t.after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const user = await db.get('SELECT id FROM users LIMIT 1');
  const product = await db.get('SELECT id FROM products LIMIT 1');
  for (let i = 0; i < 15; i++) await db.run('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)',
    user.id, product.id, 5, i === 14 ? '' : 'Published ' + i);
  await db.run('INSERT INTO reviews (user_id, product_id, rating, comment, is_visible) VALUES (?, ?, ?, ?, 0)',
    user.id, product.id, 1, 'Hidden review');
  const inactive = await db.get('SELECT id FROM products WHERE id != ? LIMIT 1', product.id);
  await db.run("UPDATE products SET status = 'inactive' WHERE id = ?", inactive.id);
  await db.run('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)', user.id, inactive.id, 5, 'Inactive product');

  const found = [];
  for (let page = 1; page <= 3; page++) {
    const response = await readReviews({ page: String(page) });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['Cache-Control'], 'no-store');
    assert.deepEqual(response.data.pagination, { page, pages: 3, total: 15, limit: 6 });
    assert.equal(response.data.reviews.length, page === 3 ? 3 : 6);
    found.push(...response.data.reviews);
  }
  assert.equal(new Set(found.map(review => review.id)).size, 15);
  assert.ok(found.some(review => review.comment === ''), 'Rating-only reviews must remain visible');
  assert.ok(found.every(review => !['Hidden review', 'Inactive product'].includes(review.comment)));
  assert.ok(found.every(review => review.username && review.product_slug && !('email' in review)));
  assert.equal((await readReviews({ page: '999' })).data.pagination.page, 3);
  for (const query of [{ page: '0' }, { page: '1.5' }, { page: 'bad' }, { limit: '25' }, { limit: '-1' }])
    assert.equal((await readReviews(query)).statusCode, 400);
  await db.run('UPDATE reviews SET is_visible = 0');
  const empty = await readReviews();
  assert.deepEqual(empty.data.reviews, []);
  assert.equal(empty.data.pagination.total, 0);
});
