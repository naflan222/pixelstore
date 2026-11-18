'use strict';

// Structured JSON logging. One JSON object per line, so log aggregators
// (e.g. Vercel logs) can parse events. Set LOG_QUIET=1 to silence output
// (used by the test suite).

function log(event, fields) {
  if (process.env.LOG_QUIET) return;
  const entry = { ts: new Date().toISOString(), event, ...(fields || {}) };
  console.log(JSON.stringify(entry));
}

module.exports = { log };
