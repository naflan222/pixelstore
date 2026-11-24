'use strict';

const crypto = require('node:crypto');
const express = require('express');
const db = require('./database');
const { requirePermission } = require('./auth');
const { rateLimit } = require('./security');
const { DarazError, darazConfig, authorizationUrl, seal, unseal, createClient } = require('./daraz-client');

const { inspectCatalog } = require('./daraz-catalog');

const router = express.Router();
const stateDigest = (state, session) => crypto.createHash('sha256').update(state + ':' + session).digest('hex');
const callbackLanding = '/admin/#daraz';
const readAuthorization = executor => executor.get('SELECT * FROM daraz_authorization WHERE id = 1');
const rowLock = 'SELECT * FROM daraz_authorization WHERE id = 1' + db.forUpdate();

function configuration() {
  const config = darazConfig();
  if (!config) throw new DarazError('Configure Daraz credentials, the HTTPS callback, and the token encryption key on the server.', 503);
  return config;
}

function tokenData(response, previous) {
  const accessSeconds = Number(response.expires_in);
  const refreshSeconds = Number(response.refresh_expires_in);
  const now = Date.now();
  if (typeof response.access_token !== 'string' || !response.access_token || !Number.isSafeInteger(accessSeconds) ||
      accessSeconds <= 0 || accessSeconds > 31536000 || !Number.isSafeInteger(refreshSeconds) ||
      refreshSeconds < 0 || refreshSeconds > 63072000 ||
      (refreshSeconds > 0 && (typeof response.refresh_token !== 'string' || !response.refresh_token))) {
    throw new DarazError('Daraz returned an incomplete authorization response.');
  }
  if (String(response.country || previous?.country || '').toLowerCase() !== 'lk') {
    throw new DarazError('Authorize a Daraz Sri Lanka seller account.', 409);
  }
  return {
    country: 'lk', accessToken: response.access_token, refreshToken: response.refresh_token || null,
    expiresAt: now + accessSeconds * 1000,
    refreshExpiresAt: Math.min(previous?.refreshExpiresAt ?? Infinity, now + refreshSeconds * 1000)
  };
}

async function accessToken(config, client) {
  const current = await readAuthorization(db);
  if (!current?.encrypted_tokens) throw new DarazError('Connect your Daraz seller account first.', 409);
  const tokens = unseal(current.encrypted_tokens, config.key);
  if (tokens.expiresAt > Date.now() + 60000) return tokens.accessToken;

  // Serialize refresh across server instances. A rotated refresh token must be
  // committed before another request can try to use it.
  return db.transaction(async tx => {
    const row = await tx.get(rowLock);
    if (!row?.encrypted_tokens) throw new DarazError('Connect your Daraz seller account first.', 409);
    const latest = unseal(row.encrypted_tokens, config.key);
    if (latest.expiresAt > Date.now() + 60000) return latest.accessToken;
    if (!latest.refreshToken || latest.refreshExpiresAt <= Date.now()) {
      if (latest.expiresAt > Date.now()) return latest.accessToken;
      throw new DarazError('Daraz authorization expired. Reconnect the seller account.', 409);
    }
    const response = await client('/auth/token/refresh', { refresh_token: latest.refreshToken },
      { method: 'POST', tokenEndpoint: true });
    const rotated = tokenData(response, latest);
    await tx.run('UPDATE daraz_authorization SET encrypted_tokens = ? WHERE id = 1', seal(rotated, config.key));
    return rotated.accessToken;
  });
}

function safe(handler) {
  return async (req, res) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (!(error instanceof DarazError)) return res.status(500).json({ error: 'Daraz integration is temporarily unavailable.' });
      if (error.retryAfter) res.set('Retry-After', String(error.retryAfter));
      res.status(error.status).json({ error: error.message });
    }
  };
}

router.use(requirePermission('owner', 'admin'));
router.use((req, res, next) => {
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  if (req.method !== 'GET' && req.get('Origin')) {
    const callback = darazConfig()?.callback;
    if (callback && req.get('Origin') !== callback.origin) {
      return res.status(403).json({ error: 'Use the PixelHouse admin origin.' });
    }
  }
  next();
});
router.use(rateLimit({ windowMs: 60000, max: 30 }));

router.get('/status', safe(async (_req, res) => {
  const config = darazConfig();
  const row = await readAuthorization(db);
  const tokens = config && row?.encrypted_tokens ? unseal(row.encrypted_tokens, config.key) : null;
  const status = !config ? 'not configured' : !tokens ? 'disconnected'
    : Math.max(tokens.expiresAt, tokens.refreshExpiresAt) > Date.now() ? 'authorized' : 'expired';
  res.json({ market: 'LK', currency: 'LKR', status,
    expiresAt: tokens ? new Date(tokens.expiresAt).toISOString() : null });
}));

router.post('/connect', safe(async (req, res) => {
  const config = configuration();
  const session = req.cookies?.pixels_session;
  if (!session) throw new DarazError('Sign in to PixelHouse admin first.', 401);
  const state = crypto.randomBytes(32).toString('base64url');
  await db.run(`INSERT INTO daraz_authorization (id, state_digest, state_expires_at)
    VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET state_digest = excluded.state_digest,
    state_expires_at = excluded.state_expires_at`, stateDigest(state, session), new Date(Date.now() + 600000).toISOString());
  res.json({ url: authorizationUrl(config, state) });
}));

router.get('/callback', safe(async (req, res) => {
  const config = configuration();
  const { state, code } = req.query;
  const session = req.cookies?.pixels_session;
  if (!session || typeof state !== 'string' || !/^[\w-]{43}$/.test(state) ||
      typeof code !== 'string' || !code || code.length > 2048) {
    throw new DarazError('Daraz authorization was not completed. Start again in PixelHouse admin.', 400);
  }
  const digest = stateDigest(state, session);
  const claimed = await db.run(`UPDATE daraz_authorization SET state_expires_at = NULL
    WHERE id = 1 AND state_digest = ? AND state_expires_at > ?`, digest, new Date().toISOString());
  if (!claimed.changes) throw new DarazError('Authorization link expired or was already used.', 409);
  const client = createClient(config);
  const response = await client('/auth/token/create', { code }, { method: 'POST', tokenEndpoint: true });
  const tokens = tokenData(response);
  const saved = await db.run(`UPDATE daraz_authorization SET encrypted_tokens = ?, state_digest = NULL
    WHERE id = 1 AND state_digest = ?`, seal(tokens, config.key), digest);
  if (!saved.changes) throw new DarazError('Daraz authorization was superseded by another request.', 409);
  res.redirect(303, callbackLanding);
}));

router.delete('/connection', safe(async (_req, res) => {
  await db.run('DELETE FROM daraz_authorization WHERE id = 1');
  res.status(204).end();
}));

router.post('/test', safe(async (_req, res) => {
  const config = configuration();
  const client = createClient(config);
  await client('/products/get', { filter: 'all', limit: '1', offset: '0' },
    { accessToken: await accessToken(config, client), retry: true });
  res.json({ ok: true });
}));

router.get('/preview', safe(async (_req, res) => {
  res.json({ currency: 'LKR', products: await inspectCatalog(db) });
}));

module.exports = router;
