'use strict';

// Core webhook logic, transport-independent so it can be unit-tested
// without an HTTP server. The Vercel adapter in api/webhook.js is a thin
// wrapper that supplies the request parts and the real send function.
//
// Flow for POST:
//   1. Validate X-Hub-Signature-256 over the RAW body (reject -> 401).
//   2. Parse the payload; log delivery statuses, ignore them otherwise.
//   3. For each inbound message: skip unsupported types, dedupe by wamid,
//      enforce the 24h window gate, resolve the FAQ reply (or the holding
//      reply), and send it.
//   4. Always answer 200 for accepted webhooks so Meta stops retrying.
//      A failed send is logged, not retried here: the message id stays
//      deduped, so a Meta retry will not produce a duplicate reply.

const { isValidSignature } = require('./verify');
const { extractEvents } = require('./parse');
const { isWithinWindow } = require('./window');
const { replyForMessage } = require('./rules');
const { log } = require('./log');

function handleVerification(query, env) {
  const mode = query && query['hub.mode'];
  const token = query && query['hub.verify_token'];
  const challenge = query && query['hub.challenge'];
  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    token.length > 0 &&
    env.WHATSAPP_VERIFY_TOKEN &&
    token === env.WHATSAPP_VERIFY_TOKEN
  ) {
    return { status: 200, body: typeof challenge === 'string' ? challenge : '' };
  }
  return { status: 403, body: 'Verification failed' };
}

async function handleWebhook({ method, query, headers, rawBody, env, dedupeStore, sendFn, nowMs }) {
  if (method === 'GET') {
    return handleVerification(query || {}, env);
  }
  if (method !== 'POST') {
    return { status: 405, body: 'Method not allowed' };
  }

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody || '');
  const signature =
    (headers && (headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'])) || null;

  if (!env.WHATSAPP_APP_SECRET || !isValidSignature(env.WHATSAPP_APP_SECRET, body, signature)) {
    log('webhook.signature_rejected', {});
    return { status: 401, body: 'Invalid signature' };
  }

  let payload;
  try {
    payload = JSON.parse(body.toString('utf8'));
  } catch (err) {
    log('webhook.bad_json', { error: err.message });
    return { status: 400, body: 'Invalid JSON' };
  }

  const { messages, statuses } = extractEvents(payload);
  for (const s of statuses) {
    log('webhook.status', { id: s.id, status: s.status, recipient_id: s.recipient_id });
  }

  const results = [];
  for (const m of messages) {
    if (m.unsupported) {
      log('webhook.unsupported_type', { id: m.id, from: m.from, type: m.type });
      results.push({ id: m.id, action: 'skipped_unsupported_type' });
      continue;
    }
    if (!m.id || !m.from) {
      log('webhook.missing_fields', { id: m.id || null, from: m.from || null });
      results.push({ id: m.id || null, action: 'skipped_missing_fields' });
      continue;
    }
    if (dedupeStore.checkAndMark(m.id)) {
      log('webhook.duplicate_skipped', { id: m.id });
      results.push({ id: m.id, action: 'skipped_duplicate' });
      continue;
    }
    log('webhook.inbound', { id: m.id, from: m.from, text_length: (m.text || '').length });

    if (!isWithinWindow(m.timestamp, nowMs)) {
      // Outside the 24h window only approved templates may be sent.
      // Template sending is a follow-up (see README); never attempt a
      // free-form send here, with or without a template configured.
      log('webhook.outside_window_skipped', {
        id: m.id,
        from: m.from,
        template_configured: Boolean(env.WHATSAPP_TEMPLATE_NAME),
      });
      results.push({ id: m.id, action: 'skipped_outside_window' });
      continue;
    }

    const reply = replyForMessage(m.text || '');
    try {
      const sent = await sendFn({ to: m.from, text: reply, env });
      const sentId = sent && sent.messages && sent.messages[0] && sent.messages[0].id;
      log('webhook.outbound', { id: m.id, to: m.from, message_id: sentId || null });
      results.push({ id: m.id, action: 'replied' });
    } catch (err) {
      log('webhook.send_failed', { id: m.id, to: m.from, error: err.message });
      results.push({ id: m.id, action: 'send_failed' });
    }
  }

  return { status: 200, body: 'OK', results };
}

module.exports = { handleWebhook, handleVerification };
