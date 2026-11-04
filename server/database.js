// Database engine switch — the ONLY module application code imports for data.
//
//   DB_ENGINE=sqlite   (or unset)  -> server/db.js   (node:sqlite file DB)
//   DB_ENGINE=postgres             -> server/db-pg.js (PostgreSQL via DATABASE_URL)
//
// The default is SQLite: with no DB_ENGINE set, the application behaves
// exactly as before this migration project. Production stays on SQLite until
// the cutover runbook is executed deliberately.
//
// Both engines expose the identical async interface:
//   engine            'sqlite' | 'postgres'
//   get(sql, …params)    first row or undefined
//   all(sql, …params)    all rows
//   run(sql, …params)    { changes }
//   insert(sql, …params) { id, changes }   (INSERT statements only)
//   transaction(fn)     fn(tx) with tx = { get, all, run, insert } on one
//                       connection/transaction; rolls back on throw
//   forUpdate()       ' FOR UPDATE' on postgres, '' on sqlite
//   utcNow(offsetMs)  UTC 'YYYY-MM-DD HH:MM:SS' for timestamp parameters
//   init() / close()
const rawEngine = (process.env.DB_ENGINE || 'sqlite').trim().toLowerCase();

if (rawEngine !== 'sqlite' && rawEngine !== 'postgres') {
  throw new Error(`Unknown DB_ENGINE=${JSON.stringify(process.env.DB_ENGINE)} (expected "sqlite" or "postgres")`);
}

if (rawEngine === 'postgres' && !process.env.DATABASE_URL && process.env.PG_MEM_TEST !== '1') {
  throw new Error('DB_ENGINE=postgres requires the DATABASE_URL environment variable.');
}

// eslint-disable-next-line global-require
const engine = rawEngine === 'postgres' ? require('./db-pg') : require('./db');

// UTC timestamp string for query parameters, e.g. session expiry or reset-code
// windows. One format works on both engines: SQLite compares it
// lexicographically, PostgreSQL parses it as TIMESTAMPTZ (session TimeZone is
// UTC). offsetMs shifts into the future (positive) or past (negative).
function utcNow(offsetMs = 0) {
  return new Date(Date.now() + offsetMs).toISOString().slice(0, 19).replace('T', ' ');
}

engine.utcNow = utcNow;

module.exports = engine;
