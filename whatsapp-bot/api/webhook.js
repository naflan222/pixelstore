'use strict';

// Vercel serverless function adapter for the WhatsApp webhook.
// Deploys to: https://<project>.vercel.app/api/webhook
//
// The raw request body is required for HMAC signature validation, so the
// built-in body parser is disabled (see `config` below) and the stream is
// read into a Buffer untouched.

const { handleWebhook } = require('../lib/webhook');
const { createDedupeStore } = require('../lib/dedupe');
const { sendTextMessage } = require('../lib/send');

// NOTE: serverless memory is ephemeral — each instance starts with an
// empty dedupe set and instances do not share state. Production dedupe
// needs a persistent store (Vercel KV, Postgres, ...). See README.
const dedupeStore = createDedupeStore();

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

module.exports = async (req, res) => {
  try {
    const rawBody = req.method === 'POST' ? await readRawBody(req) : Buffer.alloc(0);
    const result = await handleWebhook({
      method: req.method,
      query: req.query || {},
      headers: req.headers || {},
      rawBody,
      env: process.env,
      dedupeStore,
      sendFn: sendTextMessage,
      nowMs: Date.now(),
    });
    res.status(result.status).send(result.body);
  } catch (err) {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'webhook.unexpected_error', error: err.message }));
    res.status(500).send('Internal error');
  }
};

module.exports.config = {
  api: { bodyParser: false },
};
