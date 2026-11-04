#!/usr/bin/env node
// Applies server/schema-postgres.sql to the PostgreSQL database named by
// DATABASE_URL. Idempotent (IF NOT EXISTS) and creates NO demo data.
//
//   npm run db:init:postgres
//
// Refuses to run without DATABASE_URL. Prints no credentials.
const fs = require('fs');
const path = require('path');

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('Refusing to run: DATABASE_URL is not set.');
    process.exit(1);
  }
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  try {
    const schema = fs.readFileSync(path.join(__dirname, '..', 'server', 'schema-postgres.sql'), 'utf8');
    await pool.query(schema);
    const tables = await pool.query(
      "SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    console.log(`PostgreSQL schema ready (${tables.rows[0].n} tables in public schema). No demo data created.`);
  } catch (error) {
    console.error(`Schema init FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main();
}
