// End-to-end migration test: boots the app on SQLite, generates rich data
// through the real API (users, sessions, carts, coupons, orders, payments,
// reviews, contact, vendors, banners, resets, notifications, audit), then
// runs the one-way SQLite -> PostgreSQL import in-process against an empty
// pg-mem destination and asserts the separate verifier reports a clean
// migration. Also covers: dry-run writes nothing, second import aborts on a
// non-empty destination, and the source file is never modified.
const assert = require('node:assert/strict');
const fs = require('fs');
const test = require('node:test');
const { freshSqlitePath, makeSession } = require('./helpers');

function stripLineComments(sql) {
  return sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
}

test('sqlite -> postgres migration round-trip', async (t) => {
  delete process.env.DB_ENGINE;
  delete process.env.DATABASE_URL;
  delete process.env.PG_MEM_TEST;
  delete process.env.TEST_DATABASE_URL;
  const sourcePath = freshSqlitePath();
  process.env.SQLITE_DB_PATH = sourcePath;

  // eslint-disable-next-line global-require
  const { start } = require('../server/index.js');
  // eslint-disable-next-line global-require
  const db = require('../server/database.js');
  const { server, port } = await start(0);
  const base = `http://127.0.0.1:${port}`;
  const owner = makeSession(base);
  const bob = makeSession(base);
  const guest = makeSession(base);
  let released = false;
  t.after(async () => {
    if (released) return;
    released = true;
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  });

  // --- Generate rich data through the real API. ---
  await owner.post('/api/auth/login', { username: 'demo', password: 'demo1234' });
  await bob.post('/api/auth/register', { username: 'migbob', email: 'migbob@example.com', password: 'migpass123' });
  await bob.post('/api/auth/login', { username: 'migbob', password: 'migpass123' });
  const dome = await db.get("SELECT id FROM products WHERE slug = 'domeport'");
  const fh = await db.get("SELECT id FROM products WHERE slug = 'fhstick'");
  await owner.post('/api/admin/categories', { name: 'Mig Cat', slug: 'mig-cat' });
  await owner.post('/api/admin/coupons', { code: 'MIG10', discount_type: 'percentage', discount_value: 10 });
  await bob.post('/api/cart', { product_id: dome.id, quantity: 1 });
  await bob.post('/api/cart', { product_id: fh.id, quantity: 2 });
  await bob.post('/api/wishlist', { product_id: dome.id });
  await guest.post('/api/cart', { product_id: fh.id, quantity: 1 }); // stays a guest cart
  await guest.post('/api/wishlist', { product_id: dome.id }); // stays a guest wishlist
  const placed = await bob.post('/api/orders', {
    full_name: 'Mig Bob', email: 'migbob@example.com', phone: '1', address: 'a',
    shipping_method: 'standard', payment_method: 'bank', coupon_code: 'MIG10',
  });
  assert.equal(placed.status, 200);
  await owner.put(`/api/admin/orders/${placed.data.order_id}/status`, { status: 'shipped', note: 'migrated later' });
  await bob.post('/api/products/domeport/reviews', { rating: 4, comment: 'Migration review' });
  await guest.post('/api/contact', { name: 'G', email: 'g@x.com', message: 'Migration hello' });
  await bob.post('/api/vendor/apply', { account_type: 'business', store_name: 'Mig Store', location: 'Khi', mobile: '1' });
  await owner.post('/api/admin/promotional-banners', { image: 'img/bg-img/1.jpg', title: 'Mig Sale' });
  const forgot = await guest.post('/api/auth/forgot-password', { email: 'migbob@example.com' });
  assert.match(forgot.data.dev_code, /^\d{6}$/); // left valid on purpose
  const sourceUsers = (await db.get('SELECT COUNT(*) AS n FROM users')).n;
  assert.ok(sourceUsers >= 2);

  // Snapshot the source file bytes: the importer must never modify them.
  await new Promise((resolve) => server.close(resolve));
  await db.close();
  released = true;
  const beforeBytes = fs.readFileSync(sourcePath);

  // --- Empty pg-mem destination with the real schema file. ---
  // eslint-disable-next-line global-require
  const { newDb } = require('pg-mem');
  const mem = newDb({ autoCreateForeignKeyIndices: true });
  const { Pool: MemPool } = mem.adapters.createPg();
  const pool = new MemPool();
  t.after(async () => { await pool.end().catch(() => undefined); });
  // Same DDL filter the app's pg-mem double applies: partial indexes break
  // pg-mem's planner (see server/db-pg.js). PG_MEM_TEST is set only now —
  // database.js already picked SQLite at require time, so this cannot change
  // the (already released) app's engine; it merely satisfies db-pg's
  // require-time guard for importing the shared filter.
  process.env.PG_MEM_TEST = '1';
  // eslint-disable-next-line global-require
  const { stripUnsupportedMemDdl } = require('../server/db-pg.js');
  const schema = stripLineComments(
    stripUnsupportedMemDdl(
      fs.readFileSync(require('path').join(__dirname, '..', 'server', 'schema-postgres.sql'), 'utf8')
    )
  );
  for (const statement of schema.split(';').map((s) => s.trim()).filter(Boolean)) {
    await pool.query(statement);
  }

  // eslint-disable-next-line global-require
  const { migrate } = require('../scripts/migrate-sqlite-to-pg.js');
  // eslint-disable-next-line global-require
  const { verify } = require('../scripts/verify-migration.js');

  const silent = () => {};
  // --- Dry run: plans everything, writes nothing. ---
  const dry = await migrate({ sourcePath, pool, options: { log: silent } });
  assert.equal(dry.ok, true);
  assert.equal(dry.dryRun, true);
  assert.equal(dry.sourceCounts.users, sourceUsers);
  assert.equal((await pool.query('SELECT COUNT(*) AS n FROM users')).rows[0].n, 0);

  // --- Execute. ---
  const done = await migrate({ sourcePath, pool, options: { execute: true, log: silent } });
  assert.equal(done.ok, true);
  assert.equal(done.dryRun, false);
  for (const table of Object.keys(done.sourceCounts)) {
    assert.equal(done.destCounts[table], done.sourceCounts[table], `count mismatch on ${table}`);
  }
  assert.ok(done.destCounts.users >= 2);
  assert.ok(done.destCounts.orders >= 1);
  assert.ok(done.destCounts.order_items >= 2);

  // --- Verify with the independent script. ---
  const verdict = await verify({ sourcePath, pool, options: { log: silent } });
  const failures = verdict.checks.filter((check) => check.status === 'FAIL');
  assert.deepEqual(failures, []);
  assert.equal(verdict.ok, true);

  // --- Second import aborts on the non-empty destination. ---
  await assert.rejects(
    migrate({ sourcePath, pool, options: { execute: true, log: silent } }),
    /NOT empty/
  );

  // --- Source file untouched. ---
  assert.deepEqual(fs.readFileSync(sourcePath), beforeBytes);
});
