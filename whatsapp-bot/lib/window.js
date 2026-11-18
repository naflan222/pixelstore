'use strict';

// 24-hour customer-service window gate.
//
// Meta only allows free-form text replies within 24 hours of the customer's
// last message. Outside the window, only approved message templates may be
// sent. The inbound message timestamp (Unix seconds, as Meta sends it) is
// compared against "now"; messages older than 24h must not get a free-form
// reply.

const WINDOW_MS = 24 * 60 * 60 * 1000;

function isWithinWindow(messageTimestampSeconds, nowMs) {
  const ts = Number(messageTimestampSeconds);
  if (!Number.isFinite(ts)) return false;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  const ageMs = now - ts * 1000;
  // Slightly future timestamps (clock skew) count as inside the window.
  return ageMs <= WINDOW_MS;
}

module.exports = { isWithinWindow, WINDOW_MS };
