'use strict';

// HMAC-SHA256 signature validation for WhatsApp Cloud API webhooks.
// Meta sends every POST with an `X-Hub-Signature-256` header of the form
// `sha256=<hex>`, computed over the RAW request body keyed with the app
// secret. Always validate against the raw bytes, never a re-serialized
// JSON body, and compare in constant time.

const crypto = require('node:crypto');

function computeSignature(appSecret, rawBody) {
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  return 'sha256=' + crypto.createHmac('sha256', appSecret).update(body).digest('hex');
}

function isValidSignature(appSecret, rawBody, signatureHeader) {
  if (!appSecret || typeof signatureHeader !== 'string' || !signatureHeader) return false;
  const expected = computeSignature(appSecret, rawBody);
  const expectedBuf = Buffer.from(expected, 'utf8');
  const actualBuf = Buffer.from(signatureHeader, 'utf8');
  if (expectedBuf.length !== actualBuf.length) return false;
  return crypto.timingSafeEqual(expectedBuf, actualBuf);
}

module.exports = { computeSignature, isValidSignature };
