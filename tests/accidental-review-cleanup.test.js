const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hideAccidentalStoreReview } = require('../server/review-cleanup');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pixelhouse-review-cleanup-'));
process.env.DB_ENGINE = process.env.CLEANUP_TEST_ENGINE === 'postgres' ? 'postgres' : 'sqlite';
process.env.SQLITE_DB_PATH = path.join(directory, 'test.db');
process.env.SEED_DEMO_DATA = 'true';
process.env.NODE_ENV = 'test';
delete process.env.DATABASE_URL;
if (process.env.DB_ENGINE === 'postgres') process.env.PG_MEM_TEST = '1';
const db = require('../server/database');

test('cleanup hides only the exact accidental rating, preserves other reviews and recalculates its product once', async t => {
  await db.init();
  t.after(async () => { await db.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const customer = await db.get('SELECT id FROM users LIMIT 1');
  const store = await db.insert('INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)',
    'Pixelhouse', 'store@example.test', 'unused-test-hash');
  const product = await db.get("SELECT id FROM products WHERE slug = 'wpdcase'");
  const otherProduct = await db.get("SELECT id FROM products WHERE slug = 'fhstick'");
  const timestamp = '2026-11-04 01:46:08';
  for (const [id, user, productId, rating, comment] of [
    [2, store.id, product.id, 5, ''],
    [3, customer.id, product.id, 3, 'A real customer review'],
    [4, store.id, product.id, 4, 'Another legitimate review from the same account'],
    [5, customer.id, otherProduct.id, 5, 'Another product customer review'],
  ]) await db.run(`INSERT INTO reviews (id, user_id, product_id, rating, comment, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`, id, user, productId, rating, comment, timestamp);
  await db.run('UPDATE products SET rating = 4, rating_count = 3 WHERE id = ?', product.id);

  // Every identity/detail guard must match. The review ID alone is insufficient.
  for (const [column, wrong, correct] of [
    ['user_id', customer.id, store.id], ['product_id', otherProduct.id, product.id],
    ['rating', 4, 5], ['comment', 'A real written review', ''],
    ['created_at', '2026-11-05 01:46:08', timestamp],
  ]) {
    await db.run(`UPDATE reviews SET ${column} = ? WHERE id = 2`, wrong);
    assert.equal(await hideAccidentalStoreReview(db), false, column);
    assert.equal((await db.get('SELECT is_visible FROM reviews WHERE id = 2')).is_visible, 1);
    await db.run(`UPDATE reviews SET ${column} = ? WHERE id = 2`, correct);
  }
  assert.equal(Number((await db.get('SELECT COUNT(*) AS total FROM audit_logs')).total), 0);

  // pg-mem cannot prove rollback. SQLite exercises failure after the hide write.
  if (db.engine === 'sqlite') {
    const failingDb = { ...db, transaction: callback => db.transaction(tx => callback({ ...tx,
      run: async (sql, ...args) => {
        if (sql.startsWith('UPDATE products')) throw new Error('Injected aggregate failure');
        return tx.run(sql, ...args);
      },
    })) };
    await assert.rejects(hideAccidentalStoreReview(failingDb), /Injected aggregate failure/);
    assert.equal((await db.get('SELECT is_visible FROM reviews WHERE id = 2')).is_visible, 1);
    assert.equal((await db.get('SELECT rating_count FROM products WHERE id = ?', product.id)).rating_count, 3);
  }

  const before = await db.all('SELECT id, user_id, product_id, rating, comment, is_visible FROM reviews ORDER BY id');
  assert.equal(await hideAccidentalStoreReview(db), true);
  const after = await db.all('SELECT id, user_id, product_id, rating, comment, is_visible FROM reviews ORDER BY id');
  assert.deepEqual(after.map(review => ({ ...review })),
    before.map(review => ({ ...review, is_visible: review.id === 2 ? 0 : review.is_visible })));
  const aggregate = await db.get('SELECT rating, rating_count FROM products WHERE id = ?', product.id);
  assert.equal(aggregate.rating, 3.5);
  assert.equal(aggregate.rating_count, 2);
  assert.equal(await hideAccidentalStoreReview(db), false);
  const audit = await db.all("SELECT entity_id FROM audit_logs WHERE action = 'hid accidental store review'");
  assert.deepEqual(audit.map(row => row.entity_id), ['2']);
});
