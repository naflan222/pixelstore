// Full API suite on SQLite. Runs with DB_ENGINE UNSET to prove the default
// engine path is unchanged (production regression coverage).
const test = require('node:test');
const { withServer, freshSqlitePath } = require('./helpers');
const { defineSuite } = require('./suite');

// Keep API tests isolated from real mail accounts. The invoice test stubs
// Brevo explicitly when it needs to verify the PDF attachment.
for (const key of ['BREVO_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM', 'MAIL_FROM_NAME', 'MAIL_REPLY_TO']) {
  delete process.env[key];
}

test('store API on SQLite (default engine)', async (t) => {
  process.env.ORDER_NUMBER_START = '1';
  delete process.env.DB_ENGINE;
  delete process.env.DATABASE_URL;
  delete process.env.PG_MEM_TEST;
  delete process.env.TEST_DATABASE_URL;
  await withServer(t, { SQLITE_DB_PATH: freshSqlitePath() }, async (ctx) => {
    await defineSuite(t, { ...ctx, engine: 'sqlite', realTransactions: true });
  });
});
