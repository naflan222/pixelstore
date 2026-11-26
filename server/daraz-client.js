'use strict';

const crypto = require('node:crypto');

const CALLBACK = '/api/admin/daraz/callback';
const AUTH_ORIGIN = 'https://api.daraz.lk';
const TOKEN_BASE = 'https://api.daraz.com/rest';
const MARKET_BASE = AUTH_ORIGIN + '/rest';

class DarazError extends Error {
  constructor(message, status = 502, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function darazConfig(env = process.env) {
  const { DARAZ_APP_KEY: appKey, DARAZ_APP_SECRET: secret, DARAZ_TOKEN_KEY: encodedKey, DARAZ_REDIRECT_URI: redirect } = env;
  if (!appKey || !secret || !/^[a-f0-9]{64}$/i.test(encodedKey || '') || !redirect) return null;
  try {
    const callback = new URL(redirect);
    if (callback.protocol !== 'https:' || callback.username || callback.password ||
        callback.pathname !== CALLBACK || callback.search || callback.hash) return null;
    const base = (env.DARAZ_API_BASE_URL || MARKET_BASE).replace(/\/$/, '');
    if (base !== MARKET_BASE) return null;
    return { appKey, secret, key: Buffer.from(encodedKey, 'hex'), callback, base };
  } catch {
    return null;
  }
}

function sign(path, parameters, secret) {
  const suffix = Object.keys(parameters).filter(key => key !== 'sign').sort()
    .map(key => key + parameters[key]).join('');
  return crypto.createHmac('sha256', secret).update(path + suffix, 'utf8').digest('hex').toUpperCase();
}

function authorizationUrl(config, state) {
  const url = new URL('/oauth/authorize', AUTH_ORIGIN);
  url.search = new URLSearchParams({ response_type: 'code', force_auth: 'true',
    client_id: config.appKey, redirect_uri: config.callback.href, state });
  return url.href;
}

function seal(value, key) {
  const nonce = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from('pixelhouse:daraz:lk:v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext].map(part => part.toString('base64url')).join('.');
}

function unseal(value, key) {
  try {
    const [nonce, tag, ciphertext] = value.split('.').map(part => Buffer.from(part, 'base64url'));
    const cipher = crypto.createDecipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(Buffer.from('pixelhouse:daraz:lk:v1'));
    cipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([cipher.update(ciphertext), cipher.final()]).toString('utf8'));
  } catch {
    throw new DarazError('Stored Daraz authorization cannot be read. Reconnect the seller account.', 409);
  }
}

function createClient(config, { fetcher = fetch, clock = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  return async (path, params = {}, { accessToken, method = 'GET', tokenEndpoint = false, retry = false } = {}) => {
    for (let attempt = 0; ; attempt++) {
      const fields = { ...params, app_key: config.appKey, timestamp: String(clock()), sign_method: 'hmac' };
      if (accessToken) fields.access_token = accessToken;
      fields.sign = sign(path, fields, config.secret);
      const url = new URL((tokenEndpoint ? TOKEN_BASE : config.base) + path);
      const form = new URLSearchParams(fields);
      if (method === 'GET') url.search = form;
      try {
        const response = await fetcher(url, {
          method, redirect: 'error', signal: AbortSignal.timeout(8000),
          ...(method === 'POST' ? { body: form } : {})
        });
        const data = await response.json().catch(() => null);
        if (response.ok && data && (String(data.code) === '0' || (tokenEndpoint && data.code == null && data.access_token))) {
          return tokenEndpoint ? (data.data || data) : data.data;
        }
        const retrySeconds = Math.min(30, Math.max(1, Number(response.headers.get('retry-after')) || 1));
        if (response.status === 429 || ['901', 'ApiCallLimit', 'TooManyRequests'].includes(String(data?.code))) {
          throw new DarazError('Daraz is limiting requests. Try again shortly.', 429, retrySeconds);
        }
        if (response.status >= 500) throw new DarazError('Daraz is temporarily unavailable.', 503);
        throw new DarazError('Daraz rejected the request. Check the app permissions and seller authorization in API Explorer.');
      } catch (cause) {
        const error = cause instanceof DarazError ? cause : new DarazError('Could not reach Daraz.', 503);
        if (!retry || attempt >= 1 || ![429, 503].includes(error.status) || error.retryAfter > 3) throw error;
        await wait((error.retryAfter || 1) * 1000);
      }
    }
  };
}

module.exports = { CALLBACK, DarazError, darazConfig, sign, authorizationUrl, seal, unseal, createClient };
