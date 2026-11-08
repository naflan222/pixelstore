const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const { freshSqlitePath, withServer, makeSession } = require('./helpers');
process.env.SQLITE_DB_PATH = freshSqlitePath();
process.env.SEED_DEMO_DATA = 'true';
process.env.NODE_ENV = 'test';
process.env.MOBILE_PUSH_ENABLED = 'false';
if (process.env.MOBILE_PUSH_TEST_ENGINE === 'postgres') {
  process.env.DB_ENGINE = 'postgres';
  if (process.env.TEST_DATABASE_URL) { process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; delete process.env.PG_MEM_TEST; }
  else process.env.PG_MEM_TEST = '1';
}
else delete process.env.DB_ENGINE;
if (!process.env.TEST_DATABASE_URL) delete process.env.DATABASE_URL;
const { createMobilePush } = require('../server/mobile-push');
const { attachUser, createSession } = require('../server/auth');
const { createAdminNotification } = require('../server/admin-notifications');

test('owner mobile delivery is durable, private, revocable and outside checkout', async t => {
  await withServer(t, {}, async ({ db, base: storeBase }) => {
    let now = Date.now();
    let fail = false;
    let invalid = false;
    const sent = [];
    const push = createMobilePush({ db, enabled: true, now: () => now, send: async (token, data) => {
      if (invalid) throw Object.assign(new Error('invalid'), { code: 'messaging/registration-token-not-registered' });
      if (fail) throw Object.assign(new Error('temporary'), { code: 'messaging/server-unavailable' });
      sent.push({ token, data });
    } });
    await push.init();
    await push.init();
    const app = express(); app.use(express.json(), cookieParser(), attachUser); app.use('/api/mobile', push.router);
    const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
    t.after(() => new Promise(resolve => server.close(resolve)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const owner = await db.get("SELECT id FROM users WHERE role='owner' LIMIT 1");
    let token = await createSession(owner.id);
    const capabilities = await fetch(storeBase + '/api/mobile/capabilities', { headers: { Cookie: `pixels_session=${token}` } });
    assert.equal(capabilities.status, 200);
    assert.equal((await capabilities.json()).csv_dry_run, true);
    assert.equal((await fetch(storeBase + '/api/mobile/devices', { headers: { Cookie: `pixels_session=${token}` } })).status, 503);
    const ownerCall = async (path, method = 'GET', body) => fetch(base + '/api/mobile' + path, { method, headers: { Cookie: `pixels_session=${token}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    const device = '11111111-1111-4111-8111-111111111111';
    const fakeToken = 'fake-firebase-token-123456789';
    assert.equal((await fetch(base + '/api/mobile/devices')).status, 401);
    const customerId = (await db.insert("INSERT INTO users (username,email,password_hash,role) VALUES ('mobile-customer','mobile@example.test','unused','customer')")).id;
    const customerToken = await createSession(customerId);
    assert.equal((await fetch(storeBase + '/api/admin/stats', { headers: { Cookie: `pixels_session=${customerToken}`, 'X-PixelHouse-Android': '1' } })).status, 403);
    assert.equal((await fetch(storeBase + '/api/admin/stats', { headers: { Cookie: `pixels_session=${token}`, 'X-PixelHouse-Android': '1' } })).status, 200);
    assert.equal((await fetch(base + '/api/mobile/devices', { headers: { Cookie: `pixels_session=${customerToken}` } })).status, 403);
    assert.equal((await ownerCall('/devices/bad', 'PUT', { token: fakeToken })).status, 400);
    await createAdminNotification({ type: 'order', title: 'Old order', entityType: 'order', entityId: 999 });
    assert.equal((await ownerCall('/devices/' + device, 'PUT', { token: fakeToken })).status, 200);
    await push.tick(); assert.equal(sent.length, 0, 'no historical order replay');
    const newOrder = async (payment = 'cash') => {
      const id = (await db.insert("INSERT INTO orders (full_name,email,phone,address,subtotal,total,payment_method) VALUES ('Private Name','private@example.test','0771234567','Private Address',1200,1200,?)", payment)).id;
      await db.transaction(tx => createAdminNotification({ type: 'order', title: 'Order', entityType: 'order', entityId: id }, tx));
      return id;
    };
    const first = await newOrder(); await push.tick();
    let delivered = 1;
    assert.equal(sent.length, delivered); assert.equal(sent[0].data.order_id, String(first));
    assert.deepEqual(Object.keys(sent[0].data).sort(), ['event_id','kind','order_id']);
    assert.doesNotMatch(JSON.stringify(sent[0].data), /Private|0771234567|1200|@/);
    await push.tick(); assert.equal(sent.length, delivered);
    const secondWorker = createMobilePush({ db, enabled: true, now: () => now, send: async (_, data) => sent.push({ data }) });
    // pg-mem cannot repeat CREATE TABLE IF NOT EXISTS with column constraints.
    // The separate SQLite run covers reinitialisation against existing tables.
    if (db.engine === 'sqlite' || process.env.TEST_DATABASE_URL) { await secondWorker.init(); await secondWorker.tick(); }
    assert.equal(sent.length, delivered, 'sent jobs survive restart');
    // Simulate a lower notification ID committing after a higher one was delivered.
    const lateOrder = await newOrder();
    const late = await db.get('SELECT * FROM admin_notifications WHERE entity_type = ? AND entity_id = ?', 'order', String(lateOrder));
    await db.run('DELETE FROM admin_notifications WHERE id=?', late.id);
    await newOrder(); await push.tick();
    await db.run('INSERT INTO admin_notifications (id,type,title,body,entity_type,entity_id) VALUES (?,?,?,?,?,?)', late.id, late.type, late.title, late.body, late.entity_type, late.entity_id);
    await push.tick();
    delivered += 2;
    assert.equal(sent.length, delivered, 'late committed IDs must not disappear behind a cursor');
    fail = true; const bank = await newOrder('bank'); await push.tick(); assert.equal(sent.length, delivered);
    const job = await db.get("SELECT * FROM mobile_push_jobs WHERE order_id=?", bank); assert.equal(job.status, 'pending'); assert.equal(job.attempts, 1);
    fail = false; now += 30000; await push.tick(); assert.equal(sent.length, delivered + 1);
    assert.equal((await ownerCall('/devices/' + device + '/test', 'POST')).status, 200); assert.equal(sent.at(-1).data.kind, 'test');
    await db.run("UPDATE store_settings SET notification_preferences = ? WHERE id=1", JSON.stringify({ new_orders: false }));
    await newOrder(); await push.tick(); assert.equal(sent.length, delivered + 2, 'store notification preference respected');
    await db.run("UPDATE store_settings SET notification_preferences = ? WHERE id=1", JSON.stringify({ new_orders: true }));
    await newOrder(); invalid = true; await push.tick(); invalid = false;
    assert.equal(await db.get('SELECT id FROM mobile_push_devices WHERE id=?', device), undefined);
    assert.equal((await ownerCall('/devices/' + device, 'PUT', { token: fakeToken })).status, 200);
    await newOrder(); await db.run('DELETE FROM sessions WHERE token=?', token); await push.tick();
    assert.equal(sent.length, delivered + 2, 'revoked session stops future delivery');
    assert.equal(await db.get('SELECT id FROM mobile_push_devices WHERE id=?', device), undefined);
    token = await createSession(owner.id);
    assert.equal((await ownerCall('/devices/' + device, 'PUT', { token: fakeToken })).status, 200);
    await newOrder(); await push.tick();
    const beforeCleanup = sent.length;
    now += 9 * 86400000;
    await push.tick(); await push.tick();
    assert.equal(sent.length, beforeCleanup, 'cleaning old jobs must not replay their source notifications');
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM mobile_push_jobs')).count, 0);
  });
});

test('disabled push requires no tables, Firebase SDK or credentials', async () => {
  const push = createMobilePush({ db: { run() { throw new Error('must not migrate'); } }, enabled: false, send() { throw new Error('must not send'); } });
  assert.equal(await push.init(), false); await push.tick();
});
