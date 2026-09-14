// Full API suite on SQLite. Runs with DB_ENGINE UNSET to prove the default
// engine path is unchanged (production regression coverage).
const test = require('node:test');
const { withServer, freshSqlitePath } = require('./helpers');
const { defineSuite } = require('./suite');

test('store API on SQLite (default engine)', async (t) => {
  delete process.env.DB_ENGINE;
  delete process.env.DATABASE_URL;
  delete process.env.PG_MEM_TEST;
  delete process.env.TEST_DATABASE_URL;
  await withServer(t, { SQLITE_DB_PATH: freshSqlitePath() }, async (ctx) => {
    await defineSuite(t, { ...ctx, engine: 'sqlite', realTransactions: true });
  });
});
