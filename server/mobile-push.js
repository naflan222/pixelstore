// Owner-only Android delivery. No imports or network calls from checkout.
const crypto = require('crypto');
const express = require('express');
const { requireAuth, requirePermission } = require('./auth');
const { rateLimit } = require('./security');

function createMobilePush({ db, send, enabled = process.env.MOBILE_PUSH_ENABLED === 'true', now = () => Date.now(), logger = console }) {
  let ready = false;
  let running = false;
  const stamp = (offset = 0) => new Date(now() + offset).toISOString();
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const router = express.Router();
  router.use(requireAuth, requirePermission('owner'));
  router.get('/capabilities', (req, res) => res.json({ native_admin_version: 1, csv_dry_run: true, push_configured: ready }));
  router.use((req, res, next) => ready ? next() : res.status(503).json({ error: 'Android alerts are not configured yet.' }));
  router.use(rateLimit({ windowMs: 60000, max: 30 }));

  async function init() {
    if (!enabled) return false;
    if (ready) return true;
    await db.run(`CREATE TABLE IF NOT EXISTS mobile_push_devices (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      session_token TEXT NOT NULL REFERENCES sessions(token) ON DELETE CASCADE,
      token TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, cursor INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    await db.run(`CREATE TABLE IF NOT EXISTS mobile_push_jobs (
      id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES mobile_push_devices(id) ON DELETE CASCADE,
      notification_id INTEGER NOT NULL, order_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, lease TEXT, lease_until TEXT,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_error TEXT)`);
    await db.run('CREATE INDEX IF NOT EXISTS mobile_push_due ON mobile_push_jobs (status, next_at)');
    await db.run('CREATE UNIQUE INDEX IF NOT EXISTS mobile_push_event ON mobile_push_jobs (device_id, notification_id)');
    ready = true;
    return true;
  }
  const validDevice = id => /^[a-f0-9-]{36}$/.test(String(id || ''));
  const liveDevice = id => db.get(`SELECT d.* FROM mobile_push_devices d
    JOIN users u ON u.id = d.user_id JOIN sessions s ON s.token = d.session_token
    WHERE d.id = ? AND u.role = 'owner' AND u.is_active = 1 AND s.expires_at > ?`, id, db.utcNow());
  async function preference() {
    const row = await db.get('SELECT notification_preferences FROM store_settings WHERE id = 1');
    try { return JSON.parse(row?.notification_preferences || '{}').new_orders !== false; } catch (_) { return true; }
  }
  router.get('/devices', async (req, res) => {
    const devices = await db.all('SELECT id, created_at, updated_at FROM mobile_push_devices WHERE user_id = ?', req.user.id);
    res.json({ devices });
  });
  router.put('/devices/:id', async (req, res) => {
    const id = req.params.id;
    const token = req.body?.token;
    if (!validDevice(id) || typeof token !== 'string' || !/^[A-Za-z0-9_:.-]{20,4096}$/.test(token))
      return res.status(400).json({ error: 'A valid device ID and Firebase token are required.' });
    const existing = await db.get('SELECT user_id FROM mobile_push_devices WHERE id = ? OR token_hash = ?', id, digest(token));
    if (existing && Number(existing.user_id) !== Number(req.user.id)) return res.status(409).json({ error: 'This device is already registered.' });
    const latest = await db.get('SELECT COALESCE(MAX(id), 0) AS id FROM admin_notifications');
    try {
      await db.run(`INSERT INTO mobile_push_devices (id, user_id, session_token, token, token_hash, cursor, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET
        session_token = excluded.session_token, token = excluded.token, token_hash = excluded.token_hash, updated_at = excluded.updated_at`,
      id, req.user.id, req.cookies.pixels_session, token, digest(token), Number(latest.id), stamp(), stamp());
    } catch (error) {
      if (/unique|duplicate/i.test(error.message)) return res.status(409).json({ error: 'Device token is already registered.' });
      throw error;
    }
    res.json({ ok: true, device_id: id });
  });
  router.delete('/devices/:id', async (req, res) => {
    await db.run('DELETE FROM mobile_push_devices WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    res.json({ ok: true });
  });
  router.post('/devices/:id/test', rateLimit({ windowMs: 60000, max: 3 }), async (req, res) => {
    const device = await liveDevice(req.params.id);
    if (!device || Number(device.user_id) !== Number(req.user.id) || device.session_token !== req.cookies.pixels_session)
      return res.status(404).json({ error: 'Register this phone again after signing in.' });
    try {
      await send(device.token, { event_id: 'test-' + crypto.randomUUID(), order_id: '', kind: 'test' });
      res.json({ ok: true });
    } catch (_) { res.status(502).json({ error: 'Test delivery failed. Check Firebase setup and phone notification permissions.' }); }
  });
  async function enqueue() {
    const allowed = await preference();
    const devices = await db.all('SELECT id FROM mobile_push_devices');
    for (const { id } of devices) {
      await db.transaction(async tx => {
        const d = await tx.get(`SELECT * FROM mobile_push_devices WHERE id = ?${db.forUpdate()}`, id);
        if (!d) return;
        // The cursor is the pairing baseline, not a moving watermark: PostgreSQL
        // transactions can commit notification IDs out of order. The outbox join
        // discovers late commits without losing them behind a higher delivered ID.
        const records = await tx.all(`SELECT n.id, n.entity_id FROM admin_notifications n
          LEFT JOIN mobile_push_jobs j ON j.device_id = ? AND j.notification_id = n.id
          WHERE n.id > ? AND n.created_at >= ? AND n.type = 'order' AND n.entity_type = 'order' AND j.id IS NULL
          ORDER BY n.id LIMIT 100`, id, d.cursor, new Date(now() - 86400000).toISOString().slice(0, 19).replace('T', ' '));
        for (const n of records) {
          const order = Number(n.entity_id);
          if (Number.isSafeInteger(order) && order > 0) {
            await tx.run(`INSERT INTO mobile_push_jobs (id, device_id, notification_id, order_id, status, next_at, created_at, expires_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
            `${id}:${n.id}`, id, n.id, order, allowed ? 'pending' : 'skipped', stamp(), stamp(), stamp(86400000));
          }
        }
      });
    }
  }
  async function deliver() {
    const jobs = await db.all(`SELECT id FROM mobile_push_jobs WHERE status = 'pending' AND next_at <= ?
      AND (lease_until IS NULL OR lease_until < ?) ORDER BY created_at LIMIT 25`, stamp(), stamp());
    for (const { id } of jobs) {
      const lease = crypto.randomUUID();
      const claim = await db.run(`UPDATE mobile_push_jobs SET lease = ?, lease_until = ? WHERE id = ? AND status = 'pending'
        AND next_at <= ? AND (lease_until IS NULL OR lease_until < ?)`, lease, stamp(120000), id, stamp(), stamp());
      if (!claim.changes) continue;
      const job = await db.get('SELECT * FROM mobile_push_jobs WHERE id = ? AND lease = ?', id, lease);
      if (!job) continue;
      const device = await liveDevice(job.device_id);
      const order = await db.get('SELECT id FROM orders WHERE id = ?', job.order_id);
      if (!device || !order || job.expires_at <= stamp() || !(await preference())) {
        await db.run("UPDATE mobile_push_jobs SET status = 'skipped', lease = NULL, lease_until = NULL WHERE id = ? AND lease = ?", id, lease);
        continue;
      }
      try {
        await send(device.token, { event_id: String(job.notification_id), order_id: String(job.order_id), kind: 'order' });
        await db.run("UPDATE mobile_push_jobs SET status = 'sent', lease = NULL, lease_until = NULL, last_error = NULL WHERE id = ? AND lease = ?", id, lease);
      } catch (error) {
        const code = String(error.code || 'delivery-failed');
        if (['messaging/registration-token-not-registered', 'messaging/invalid-registration-token'].includes(code)) {
          await db.run('DELETE FROM mobile_push_devices WHERE id = ?', device.id);
        } else {
          const attempts = job.attempts + 1;
          await db.run(`UPDATE mobile_push_jobs SET attempts = ?, next_at = ?, lease = NULL, lease_until = NULL,
            last_error = ? WHERE id = ? AND lease = ?`, attempts, stamp(Math.min(3600000, 10000 * 2 ** Math.min(attempts, 8))), code.slice(0, 120), id, lease);
        }
      }
    }
    // Keep a bounded delivery history. Never modify the source admin notifications.
    await db.run('DELETE FROM mobile_push_jobs WHERE expires_at < ?', stamp(-7 * 86400000));
  }
  async function tick() {
    if (!ready || running) return;
    running = true;
    try { await enqueue(); await deliver(); } catch (_) { logger.error('[MOBILE PUSH] Delivery paused; will retry.'); }
    finally { running = false; }
  }
  function start() {
    const timer = setInterval(tick, 10000);
    timer.unref();
    tick();
    return () => clearInterval(timer);
  }
  return { router, init, tick, start };
}

function firebaseConfigured() {
  try {
    const c = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    if (!c.project_id || !c.client_email || !c.private_key) return false;
    crypto.createPrivateKey(c.private_key);
    return true;
  } catch (_) { return false; }
}

function firebaseSender() {
  let messaging;
  return async (token, data) => {
    if (!messaging) {
      const { initializeApp, cert } = require('firebase-admin/app');
      const { getMessaging } = require('firebase-admin/messaging');
      const credentials = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
      if (!credentials.project_id || !credentials.private_key || !credentials.client_email) throw new Error('Firebase is not configured');
      const app = initializeApp({ credential: cert(credentials), projectId: credentials.project_id }, 'pixelhouse-mobile');
      messaging = getMessaging(app);
    }
    return messaging.send({ token, data, android: { priority: 'high', ttl: 86400000 } });
  };
}
module.exports = { createMobilePush, firebaseSender, firebaseConfigured };
