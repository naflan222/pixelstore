'use strict';

// No network calls to Meta are made anywhere in this suite: the Graph API
// sender is exercised with a mock fetch, and signatures are computed
// locally with node:crypto (independently of lib/verify.js, so the HMAC
// tests are not circular).

process.env.LOG_QUIET = '1';

const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { computeSignature, isValidSignature } = require('../lib/verify');
const { extractEvents } = require('../lib/parse');
const { createDedupeStore } = require('../lib/dedupe');
const { isWithinWindow, WINDOW_MS } = require('../lib/window');
const { PRODUCTS, HOLDING_REPLY, getReply, replyForMessage, matchIntent } = require('../lib/rules');
const { sendTextMessage, buildSendUrl } = require('../lib/send');
const { handleWebhook, handleVerification } = require('../lib/webhook');

// Fixed "now" so window tests are deterministic.
const NOW_MS = 1794964800000; // 2026-11-18T12:00:00Z
const NOW_S = NOW_MS / 1000;

const ENV = {
  WHATSAPP_VERIFY_TOKEN: 'verify-me',
  WHATSAPP_APP_SECRET: 'app-secret',
  WHATSAPP_ACCESS_TOKEN: 'access-token',
  WHATSAPP_PHONE_NUMBER_ID: '12345',
  GRAPH_API_VERSION: 'v26.0',
};

// Independent HMAC computation (does not use lib/verify.js).
function sign(secret, rawBody) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function payloadWith({ messages, statuses }) {
  return {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{ field: 'messages', value: { messages: messages || [], statuses: statuses || [] } }],
    }],
  };
}

function textMessage({ id, from, text, ageSeconds }) {
  return {
    from: from || '94777466675',
    id: id || 'wamid.test1',
    timestamp: String(NOW_S - (ageSeconds == null ? 60 : ageSeconds)),
    type: 'text',
    text: { body: text },
  };
}

async function postJson({ payload, env, store, sendFn, secret, rawOverride }) {
  const rawBody = rawOverride != null ? rawOverride : Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = sign(secret || ENV.WHATSAPP_APP_SECRET, rawBody);
  return handleWebhook({
    method: 'POST',
    query: {},
    headers: { 'x-hub-signature-256': signature },
    rawBody,
    env: env || ENV,
    dedupeStore: store || createDedupeStore(),
    sendFn: sendFn || (async () => ({ messages: [{ id: 'wamid.sent' }] })),
    nowMs: NOW_MS,
  });
}

describe('verification handshake', () => {
  it('answers the challenge when the verify token matches', () => {
    const res = handleVerification(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' },
      ENV,
    );
    assert.equal(res.status, 200);
    assert.equal(res.body, 'abc123');
  });

  it('rejects a mismatched verify token', () => {
    const res = handleVerification(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' },
      ENV,
    );
    assert.equal(res.status, 403);
  });

  it('rejects a missing verify token', () => {
    const res = handleVerification({ 'hub.mode': 'subscribe', 'hub.challenge': 'abc123' }, ENV);
    assert.equal(res.status, 403);
  });

  it('rejects a wrong hub.mode', () => {
    const res = handleVerification(
      { 'hub.mode': 'unsubscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' },
      ENV,
    );
    assert.equal(res.status, 403);
  });

  it('rejects when no verify token is configured', () => {
    const res = handleVerification(
      { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' },
      {},
    );
    assert.equal(res.status, 403);
  });

  it('answers GET through the main handler', async () => {
    const res = await handleWebhook({
      method: 'GET',
      query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'xyz' },
      headers: {},
      rawBody: Buffer.alloc(0),
      env: ENV,
      dedupeStore: createDedupeStore(),
      sendFn: async () => ({}),
      nowMs: NOW_MS,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body, 'xyz');
  });
});

describe('HMAC signature validation', () => {
  const rawBody = Buffer.from('{"hello":"world"}', 'utf8');

  it('accepts a valid signature computed independently', () => {
    assert.equal(isValidSignature('secret', rawBody, sign('secret', rawBody)), true);
  });

  it('computeSignature matches an independent computation', () => {
    assert.equal(computeSignature('secret', rawBody), sign('secret', rawBody));
  });

  it('rejects a tampered body', () => {
    const signature = sign('secret', rawBody);
    const tampered = Buffer.from('{"hello":"mars!"}', 'utf8');
    assert.equal(isValidSignature('secret', tampered, signature), false);
  });

  it('rejects a wrong secret', () => {
    const signature = sign('secret', rawBody);
    assert.equal(isValidSignature('other-secret', rawBody, signature), false);
  });

  it('rejects malformed headers', () => {
    assert.equal(isValidSignature('secret', rawBody, 'sha256=xyz'), false);
    assert.equal(isValidSignature('secret', rawBody, 'nope'), false);
    assert.equal(isValidSignature('secret', rawBody, ''), false);
    assert.equal(isValidSignature('secret', rawBody, null), false);
    assert.equal(isValidSignature('secret', rawBody, undefined), false);
  });

  it('rejects when no secret is configured', () => {
    assert.equal(isValidSignature('', rawBody, sign('secret', rawBody)), false);
  });
});

describe('payload parsing', () => {
  it('extracts text messages and statuses', () => {
    const payload = payloadWith({
      messages: [textMessage({ id: 'wamid.1', text: 'hello' })],
      statuses: [{ id: 'wamid.0', status: 'delivered', timestamp: String(NOW_S), recipient_id: '94777466675' }],
    });
    const { messages, statuses } = extractEvents(payload);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].id, 'wamid.1');
    assert.equal(messages[0].from, '94777466675');
    assert.equal(messages[0].text, 'hello');
    assert.equal(messages[0].unsupported, false);
    assert.equal(statuses.length, 1);
    assert.equal(statuses[0].status, 'delivered');
  });

  it('flags non-text messages as unsupported', () => {
    const payload = payloadWith({
      messages: [{ from: '94777466675', id: 'wamid.img', timestamp: String(NOW_S), type: 'image', image: { id: 'media1' } }],
    });
    const { messages } = extractEvents(payload);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].unsupported, true);
    assert.equal(messages[0].type, 'image');
    assert.equal(messages[0].text, null);
  });

  it('never throws on malformed input', () => {
    for (const bad of [null, undefined, {}, [], 'string', 42, { entry: 'nope' }, { entry: [null] }, { entry: [{ changes: null }] }]) {
      const { messages, statuses } = extractEvents(bad);
      assert.deepEqual(messages, []);
      assert.deepEqual(statuses, []);
    }
  });

  it('handles a text message with no body', () => {
    const payload = payloadWith({
      messages: [{ from: '94777466675', id: 'wamid.empty', timestamp: String(NOW_S), type: 'text', text: {} }],
    });
    const { messages } = extractEvents(payload);
    assert.equal(messages[0].text, '');
    assert.equal(messages[0].unsupported, false);
  });
});

describe('dedupe store', () => {
  it('flags a repeated id and passes new ones', () => {
    const store = createDedupeStore();
    assert.equal(store.checkAndMark('wamid.1'), false);
    assert.equal(store.checkAndMark('wamid.1'), true);
    assert.equal(store.checkAndMark('wamid.2'), false);
    assert.equal(store.size(), 2);
  });

  it('never treats null ids as duplicates', () => {
    const store = createDedupeStore();
    assert.equal(store.checkAndMark(null), false);
    assert.equal(store.checkAndMark(null), false);
    assert.equal(store.checkAndMark(undefined), false);
  });

  it('evicts the oldest id when over the limit', () => {
    const store = createDedupeStore(2);
    store.checkAndMark('a');
    store.checkAndMark('b');
    store.checkAndMark('c');
    assert.equal(store.size(), 2);
    assert.equal(store.has('a'), false); // oldest, evicted
    assert.equal(store.has('b'), true);
    assert.equal(store.has('c'), true);
    assert.equal(store.checkAndMark('a'), false); // evicted ids look new again
  });
});

describe('24-hour window gate', () => {
  it('accepts recent messages', () => {
    assert.equal(isWithinWindow(NOW_S - 60, NOW_MS), true);
    assert.equal(isWithinWindow(NOW_S - 23 * 3600, NOW_MS), true);
  });

  it('accepts exactly 24 hours old', () => {
    assert.equal(isWithinWindow(NOW_S - WINDOW_MS / 1000, NOW_MS), true);
  });

  it('rejects messages older than 24 hours', () => {
    assert.equal(isWithinWindow(NOW_S - WINDOW_MS / 1000 - 1, NOW_MS), false);
    assert.equal(isWithinWindow(NOW_S - 25 * 3600, NOW_MS), false);
  });

  it('rejects invalid timestamps', () => {
    assert.equal(isWithinWindow('not-a-number', NOW_MS), false);
    assert.equal(isWithinWindow(null, NOW_MS), false);
    assert.equal(isWithinWindow(undefined, NOW_MS), false);
  });

  it('tolerates slightly future timestamps (clock skew)', () => {
    assert.equal(isWithinWindow(NOW_S + 60, NOW_MS), true);
  });
});

describe('FAQ rules engine', () => {
  it('answers every product price exactly', () => {
    const cases = [
      ['how much is the 50-in-1 kit?', '50-in-1 Accessories Kit', 'Rs. 8,000'],
      ['dome port price?', 'Dome Port', 'Rs. 14,000'],
      ['floating handle price', 'Floating Handle Stick', 'Rs. 1,200'],
      ['3 way selfie stick price', '3 Way Selfie Stick', 'Rs. 4,500'],
      ['how much is the 3m selfie stick?', '3M Selfie Stick', 'Rs. 8,500'],
      ['chin strap mount price', 'Helmet Chin Strap Mount', 'Rs. 2,990'],
      ['price of 2.7m stick', '2.7M Selfie Stick', 'Rs. 7,400'],
      ['waterproof case price', 'Waterproof Diving Case', 'Rs. 4,300'],
      ['head strap price', 'Head Strap Mount', 'Rs. 1,800'],
      ['chest strap mount', 'Chest Strap Mount', 'Rs. 2,499'],
      ['gopro hero 13 price', 'GoPro Hero 13', 'Rs. 92,000'],
    ];
    assert.equal(cases.length, PRODUCTS.length);
    for (const [query, name, price] of cases) {
      const reply = getReply(query);
      assert.ok(reply && reply.includes(name), 'reply for "' + query + '" should name ' + name);
      assert.ok(reply.includes(price), 'reply for "' + query + '" should contain ' + price);
    }
  });

  it('lists selfie stick options when no length is given', () => {
    const reply = getReply('selfie stick price');
    assert.ok(reply.includes('Rs. 4,500'));
    assert.ok(reply.includes('Rs. 7,400'));
    assert.ok(reply.includes('Rs. 8,500'));
  });

  it('lists strap/mount options when no type is given', () => {
    const reply = getReply('how much is a strap?');
    assert.ok(reply.includes('Rs. 1,800'));
    assert.ok(reply.includes('Rs. 2,499'));
    assert.ok(reply.includes('Rs. 2,990'));
  });

  it('asks which product for a bare price question', () => {
    const reply = getReply('what is the price?');
    assert.ok(reply.includes('Which product'));
  });

  it('answers greetings', () => {
    for (const query of ['hello', 'hi', 'hey', 'good morning', 'Ayubowan']) {
      const reply = getReply(query);
      assert.ok(reply && reply.includes('PIXELHOUSE'), 'greeting reply for "' + query + '"');
    }
  });

  it('prefers a specific question over a greeting', () => {
    const reply = getReply('hi, price of chest strap?');
    assert.ok(reply.includes('Rs. 2,499'));
  });

  it('answers location without inventing hours', () => {
    const reply = getReply('where is your shop?');
    assert.ok(reply.includes('Tangalle'));
    assert.ok(/message/i.test(reply));
    assert.ok(!/\d{1,2}\s?(am|pm)/i.test(reply), 'must not invent opening hours');
  });

  it('answers rental questions', () => {
    const reply = getReply('do you rent cameras?');
    assert.ok(reply.includes('rental'));
  });

  it('answers delivery questions without inventing fees or times', () => {
    const reply = getReply('do you deliver to colombo?');
    assert.ok(/delivery/i.test(reply));
    assert.ok(!reply.includes('Rs.'), 'must not invent delivery fees');
  });

  it('matches one-word spellings of product names', () => {
    const cases = [
      ['Price of domeport', 'Dome Port', 'Rs. 14,000'],
      ['hero13 price', 'GoPro Hero 13', 'Rs. 92,000'],
      ['3mstick price', '3M Selfie Stick', 'Rs. 8,500'],
      ['cheststrap price', 'Chest Strap Mount', 'Rs. 2,499'],
      ['selfiestick price', null, 'Rs. 8,500'],
    ];
    for (const [query, name, price] of cases) {
      const reply = getReply(query);
      assert.ok(reply, 'reply for "' + query + '"');
      if (name) assert.ok(reply.includes(name), 'reply for "' + query + '" should name ' + name);
      assert.ok(reply.includes(price), 'reply for "' + query + '" should contain ' + price);
    }
  });

  it('does not match "3m" inside other words', () => {
    assert.equal(getReply('is the 13m cable available?'), null);
    assert.equal(matchIntent('is the 13m cable available?').intent, null);
  });

  it('returns null for unknown text, and the holding reply via replyForMessage', () => {
    assert.equal(getReply('asdfqwer zxcv'), null);
    const reply = replyForMessage('asdfqwer zxcv');
    assert.equal(reply, HOLDING_REPLY);
    assert.ok(reply.includes('0777 466 675'));
  });

  it('sends complaints, orders and stock checks to the holding reply', () => {
    for (const query of [
      'my order arrived broken, I want a refund',
      'I want to order 5 cameras for my shop',
      'do you have gopro hero 13 in stock?',
    ]) {
      assert.equal(getReply(query), null, 'no confident match for: ' + query);
      assert.equal(replyForMessage(query), HOLDING_REPLY);
    }
  });

  it('returns null for empty or non-string input', () => {
    assert.equal(getReply(''), null);
    assert.equal(getReply('   '), null);
    assert.equal(getReply(null), null);
    assert.equal(getReply(undefined), null);
  });

  it('never promises stock, discounts or unlisted prices', () => {
    const forbidden = [/in stock/i, /discount/i, /% off/i, /free delivery/i];
    const samples = ['hello', 'dome port price?', 'do you deliver?', 'where are you?', 'rent a camera', 'asdf'];
    for (const query of samples) {
      const reply = replyForMessage(query);
      for (const pattern of forbidden) {
        assert.ok(!pattern.test(reply), 'reply for "' + query + '" must not match ' + pattern);
      }
    }
  });
});

describe('Graph API send function', () => {
  it('POSTs the right URL, headers and body', async () => {
    const calls = [];
    const mockFetch = async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => ({ messages: [{ id: 'wamid.sent' }] }) };
    };
    const result = await sendTextMessage({
      to: '94777466675',
      text: 'Hello!',
      env: ENV,
      fetchImpl: mockFetch,
    });
    assert.equal(result.messages[0].id, 'wamid.sent');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://graph.facebook.com/v26.0/12345/messages');
    assert.equal(calls[0].options.method, 'POST');
    assert.equal(calls[0].options.headers.Authorization, 'Bearer access-token');
    assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
    const body = JSON.parse(calls[0].options.body);
    assert.equal(body.messaging_product, 'whatsapp');
    assert.equal(body.recipient_type, 'individual');
    assert.equal(body.to, '94777466675');
    assert.equal(body.type, 'text');
    assert.equal(body.text.body, 'Hello!');
  });

  it('honours GRAPH_API_VERSION and defaults to v26.0', () => {
    assert.equal(
      buildSendUrl({ WHATSAPP_PHONE_NUMBER_ID: '9', GRAPH_API_VERSION: 'v25.0' }),
      'https://graph.facebook.com/v25.0/9/messages',
    );
    assert.equal(
      buildSendUrl({ WHATSAPP_PHONE_NUMBER_ID: '9' }),
      'https://graph.facebook.com/v26.0/9/messages',
    );
  });

  it('throws on a non-2xx response', async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'bad request' } }),
    });
    await assert.rejects(
      () => sendTextMessage({ to: '94777466675', text: 'Hi', env: ENV, fetchImpl: mockFetch }),
      (err) => err.status === 400,
    );
  });
});

describe('webhook handler end-to-end', () => {
  it('replies to a valid inbound text message', async () => {
    const sent = [];
    const store = createDedupeStore();
    const res = await postJson({
      payload: payloadWith({ messages: [textMessage({ id: 'wamid.a', text: 'hello' })] }),
      store,
      sendFn: async (args) => { sent.push(args); return { messages: [{ id: 'wamid.sent' }] }; },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body, 'OK');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, '94777466675');
    assert.ok(sent[0].text.includes('PIXELHOUSE'));
    assert.equal(res.results[0].action, 'replied');
  });

  it('skips a duplicate wamid (Meta retry)', async () => {
    let calls = 0;
    const store = createDedupeStore();
    const sendFn = async () => { calls += 1; return { messages: [{ id: 'wamid.sent' }] }; };
    const payload = payloadWith({ messages: [textMessage({ id: 'wamid.dup', text: 'dome port price?' })] });
    const first = await postJson({ payload, store, sendFn });
    const second = await postJson({ payload, store, sendFn });
    assert.equal(first.results[0].action, 'replied');
    assert.equal(second.results[0].action, 'skipped_duplicate');
    assert.equal(calls, 1);
  });

  it('rejects a bad signature with 401 and sends nothing', async () => {
    let calls = 0;
    const rawBody = Buffer.from(JSON.stringify(payloadWith({ messages: [textMessage({ text: 'hello' })] })), 'utf8');
    const res = await handleWebhook({
      method: 'POST',
      query: {},
      headers: { 'x-hub-signature-256': sign('wrong-secret', rawBody) },
      rawBody,
      env: ENV,
      dedupeStore: createDedupeStore(),
      sendFn: async () => { calls += 1; return {}; },
      nowMs: NOW_MS,
    });
    assert.equal(res.status, 401);
    assert.equal(calls, 0);
  });

  it('rejects a tampered body', async () => {
    let calls = 0;
    const signed = Buffer.from(JSON.stringify(payloadWith({ messages: [textMessage({ text: 'hello' })] })), 'utf8');
    const tampered = Buffer.from(JSON.stringify(payloadWith({ messages: [textMessage({ text: 'dome port price?' })] })), 'utf8');
    const res = await handleWebhook({
      method: 'POST',
      query: {},
      headers: { 'x-hub-signature-256': sign(ENV.WHATSAPP_APP_SECRET, signed) },
      rawBody: tampered,
      env: ENV,
      dedupeStore: createDedupeStore(),
      sendFn: async () => { calls += 1; return {}; },
      nowMs: NOW_MS,
    });
    assert.equal(res.status, 401);
    assert.equal(calls, 0);
  });

  it('rejects when no app secret is configured', async () => {
    const res = await postJson({
      payload: payloadWith({ messages: [textMessage({ text: 'hello' })] }),
      env: { ...ENV, WHATSAPP_APP_SECRET: '' },
    });
    assert.equal(res.status, 401);
  });

  it('skips messages outside the 24h window and never sends', async () => {
    let calls = 0;
    const res = await postJson({
      payload: payloadWith({ messages: [textMessage({ id: 'wamid.old', text: 'hello', ageSeconds: 25 * 3600 })] }),
      sendFn: async () => { calls += 1; return {}; },
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
    assert.equal(res.results[0].action, 'skipped_outside_window');
  });

  it('skips out-of-window messages even when a template is configured', async () => {
    let calls = 0;
    const res = await postJson({
      payload: payloadWith({ messages: [textMessage({ id: 'wamid.old2', text: 'hello', ageSeconds: 26 * 3600 })] }),
      env: { ...ENV, WHATSAPP_TEMPLATE_NAME: 'hello_world' },
      sendFn: async () => { calls += 1; return {}; },
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
    assert.equal(res.results[0].action, 'skipped_outside_window');
  });

  it('logs statuses and sends nothing for a statuses-only payload', async () => {
    let calls = 0;
    const res = await postJson({
      payload: payloadWith({
        statuses: [{ id: 'wamid.0', status: 'read', timestamp: String(NOW_S), recipient_id: '94777466675' }],
      }),
      sendFn: async () => { calls += 1; return {}; },
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
    assert.deepEqual(res.results, []);
  });

  it('skips unsupported message types', async () => {
    let calls = 0;
    const res = await postJson({
      payload: payloadWith({
        messages: [{ from: '94777466675', id: 'wamid.img', timestamp: String(NOW_S), type: 'image', image: { id: 'm1' } }],
      }),
      sendFn: async () => { calls += 1; return {}; },
    });
    assert.equal(res.status, 200);
    assert.equal(calls, 0);
    assert.equal(res.results[0].action, 'skipped_unsupported_type');
  });

  it('returns 400 for invalid JSON with a valid signature', async () => {
    const rawBody = Buffer.from('{not json', 'utf8');
    const res = await handleWebhook({
      method: 'POST',
      query: {},
      headers: { 'x-hub-signature-256': sign(ENV.WHATSAPP_APP_SECRET, rawBody) },
      rawBody,
      env: ENV,
      dedupeStore: createDedupeStore(),
      sendFn: async () => ({}),
      nowMs: NOW_MS,
    });
    assert.equal(res.status, 400);
  });

  it('reports send failures without crashing', async () => {
    const res = await postJson({
      payload: payloadWith({ messages: [textMessage({ id: 'wamid.fail', text: 'hello' })] }),
      sendFn: async () => { throw new Error('network down'); },
    });
    assert.equal(res.status, 200);
    assert.equal(res.results[0].action, 'send_failed');
  });

  it('sends the holding reply for unknown text', async () => {
    const sent = [];
    const res = await postJson({
      payload: payloadWith({ messages: [textMessage({ id: 'wamid.unk', text: 'my parcel never arrived' })] }),
      sendFn: async (args) => { sent.push(args); return { messages: [{ id: 'wamid.sent' }] }; },
    });
    assert.equal(res.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].text, HOLDING_REPLY);
  });

  it('rejects non-GET/POST methods', async () => {
    const res = await handleWebhook({
      method: 'PUT',
      query: {},
      headers: {},
      rawBody: Buffer.alloc(0),
      env: ENV,
      dedupeStore: createDedupeStore(),
      sendFn: async () => ({}),
      nowMs: NOW_MS,
    });
    assert.equal(res.status, 405);
  });
});
