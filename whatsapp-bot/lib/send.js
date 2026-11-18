'use strict';

// Send a free-form text message via the WhatsApp Cloud API (Graph API).
// Only call this inside the 24-hour customer-service window — the caller
// (webhook handler) enforces the window gate. No Meta calls happen at
// import time; the fetch implementation is injectable for tests.

function buildSendUrl(env) {
  const version = env.GRAPH_API_VERSION || 'v26.0';
  return 'https://graph.facebook.com/' + version + '/' + env.WHATSAPP_PHONE_NUMBER_ID + '/messages';
}

async function sendTextMessage({ to, text, env, fetchImpl }) {
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    throw new Error('No fetch implementation available');
  }
  const response = await fetchFn(buildSendUrl(env), {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + env.WHATSAPP_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: text },
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('Graph API send failed: HTTP ' + response.status);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

module.exports = { sendTextMessage, buildSendUrl };
