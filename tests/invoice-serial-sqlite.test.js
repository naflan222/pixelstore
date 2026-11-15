const test=require('node:test');const{withServer,freshSqlitePath}=require('./helpers');
for(const k of ['BREVO_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS'])delete process.env[k];
test('serial invoices preserve originals and accounting on SQLite',async t=>{await withServer(t,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'},require('./invoice-serial-suite'));});
