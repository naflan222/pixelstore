'use strict';

// In-memory deduplication of inbound message ids (wamids). Meta retries
// webhook deliveries for up to 7 days, so the same message can arrive more
// than once; answering twice would send the customer a duplicate reply.
//
// WARNING: serverless memory is ephemeral. A new function instance starts
// with an empty set, and concurrent instances do not share state. This
// store is enough for the scaffold and for local testing, but production
// dedupe needs a persistent store (Vercel KV, Postgres, etc.) — see README.

const DEFAULT_MAX_IDS = 10000;

function createDedupeStore(maxIds) {
  const limit = Number.isFinite(maxIds) && maxIds > 0 ? maxIds : DEFAULT_MAX_IDS;
  const ids = new Set();

  return {
    // Returns true when the id was already seen (duplicate), false when it
    // is new. New ids are recorded. Null/undefined ids are never treated
    // as duplicates (they cannot be deduped reliably).
    checkAndMark(id) {
      if (id == null) return false;
      if (ids.has(id)) return true;
      ids.add(id);
      // FIFO eviction keeps memory bounded: Set iteration order is
      // insertion order, so the first key is the oldest.
      if (ids.size > limit) {
        ids.delete(ids.values().next().value);
      }
      return false;
    },
    has(id) {
      return ids.has(id);
    },
    size() {
      return ids.size;
    },
    clear() {
      ids.clear();
    },
  };
}

module.exports = { createDedupeStore, DEFAULT_MAX_IDS };
