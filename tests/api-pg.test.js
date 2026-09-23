// Full API suite on PostgreSQL.
//
// Default (no env): runs against the pg-mem in-process double, which proves
// SQL portability but NOT transactional rollback (pg-mem cannot roll back;
// rollback/race subtests self-skip with a documented reason).
//
// With TEST_DATABASE_URL set: runs against a REAL PostgreSQL instance (local
// docker / staging). The public schema is dropped and rebuilt first, so point
// it ONLY at a disposable test database. This is the gate that proves
// rollback + concurrency semantics on PostgreSQL.
const test = require('node:test');
const { withServer } = require('./helpers');
const { defineSuite } = require('./suite');

test('store API on PostgreSQL', async (t) => {
  const url = process.env.TEST_DATABASE_URL;
  if (url) {
    // eslint-disable-next-line global-require
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    } finally {
      await pool.end();
    }
    delete process.env.PG_MEM_TEST;
    delete process.env.SQLITE_DB_PATH;
    await withServer(
      t,
      { DB_ENGINE: 'postgres', DATABASE_URL: url, SEED_DEMO_DATA: 'true' },
      async (ctx) => {
        await defineSuite(t, { ...ctx, engine: 'postgres', realTransactions: true });
      }
    );
  } else {
    delete process.env.DATABASE_URL;
    delete process.env.SQLITE_DB_PATH;
    await withServer(
      t,
      { DB_ENGINE: 'postgres', PG_MEM_TEST: '1', SEED_DEMO_DATA: 'true' },
      async (ctx) => {
        await defineSuite(t, { ...ctx, engine: 'postgres', realTransactions: false });
      }
    );
  }
});
