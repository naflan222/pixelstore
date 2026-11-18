'use strict';

// Parse a WhatsApp Cloud API webhook payload into inbound messages and
// delivery statuses. Never throws on malformed input: anything unexpected
// simply yields empty lists.
//
// Payload shape (entry[].changes[].value):
//   value.messages[] -> inbound messages (text, image, audio, ...)
//   value.statuses[] -> delivery/read receipts for messages we sent

function extractEvents(payload) {
  const messages = [];
  const statuses = [];
  if (!payload || typeof payload !== 'object') return { messages, statuses };

  const entries = Array.isArray(payload.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry && entry.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change && change.value;
      if (!value || typeof value !== 'object') continue;

      const incoming = Array.isArray(value.messages) ? value.messages : [];
      for (const m of incoming) {
        if (!m || typeof m !== 'object') continue;
        if (m.type !== 'text') {
          // Non-text messages (image, audio, sticker, ...) are reported
          // as unsupported so the handler can log and skip them.
          messages.push({
            id: m.id || null,
            from: m.from || null,
            timestamp: m.timestamp || null,
            type: m.type || null,
            text: null,
            unsupported: true,
          });
          continue;
        }
        const text = m.text && typeof m.text.body === 'string' ? m.text.body : '';
        messages.push({
          id: m.id || null,
          from: m.from || null,
          timestamp: m.timestamp || null,
          type: 'text',
          text,
          unsupported: false,
        });
      }

      const stats = Array.isArray(value.statuses) ? value.statuses : [];
      for (const s of stats) {
        if (!s || typeof s !== 'object') continue;
        statuses.push({
          id: s.id || null,
          status: s.status || null,
          timestamp: s.timestamp || null,
          recipient_id: s.recipient_id || null,
        });
      }
    }
  }
  return { messages, statuses };
}

module.exports = { extractEvents };
