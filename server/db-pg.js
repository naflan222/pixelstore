// PostgreSQL engine for the Pixels store (node-postgres, no ORM).
//
// Selected with DB_ENGINE=postgres. Connection comes ONLY from the
// DATABASE_URL environment variable (pool honouring whatever sslmode and
// other parameters the URL carries — nothing is forced or second-guessed).
//
// Implements the same async interface as server/db.js:
//   get(sql, ...params)         -> first row or undefined
//   all(sql, ...params)         -> row array
//   run(sql, ...params)         -> { changes }
//   insert(sql, ...params)      -> { id, changes } (appends RETURNING id)
//   transaction(async (tx) => …) -> runs fn on ONE checked-out client
//   forUpdate()                -> ' FOR UPDATE'
//   init()                     -> ensure schema + config row, optional demo seed
//   close()                    -> drain the pool
//
// Route SQL keeps `?` placeholders; they are converted to $1… by the safe
// tokenizer in server/placeholders.js (literal `?` characters are untouched).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { convertPlaceholders } = require('./placeholders');
const { SEED_PRODUCTS, DEMO_USER, DEFAULT_STORE_SETTINGS } = require('./seed-data');

if (!process.env.DATABASE_URL && process.env.PG_MEM_TEST !== '1') {
  throw new Error('DB_ENGINE=postgres requires the DATABASE_URL environment variable.');
}

const SCHEMA_SQL = fs.readFileSync(path.join(__dirname, 'schema-postgres.sql'), 'utf8');

// TEST-DOUBLE DDL FILTER (pg-mem only — real PostgreSQL always receives the
// full schema-postgres.sql untouched, via init() below and via
// scripts/init-postgres-schema.js).
// pg-mem's planner answers queries from PARTIAL indexes even when the query
// does not imply the index predicate (verified repro on pg-mem 3.0.14: after
// UPDATEing a row out of `WHERE is_primary = 1`, `WHERE product_id = $1`
// stops matching it). Real PostgreSQL never does this. The double therefore
// skips partial-index DDL; every table, constraint, and non-partial index is
// still created, and the guarded invariants stay covered by procedural app
// logic plus suite assertions. Exported for the migration test, which builds
// its own pg-mem destination from the same schema file.
function stripUnsupportedMemDdl(ddl) {
  return ddl.replace(/CREATE\s+UNIQUE\s+INDEX[^;]*?\bWHERE\b[^;]*?;/gi, '');
}

let pool;
let pgTypes;
if (process.env.PG_MEM_TEST === '1') {
  // TEST DOUBLE ONLY (automated suite without a real PostgreSQL server).
  // Never set in production: PG_MEM_TEST is honoured exclusively here.
  // eslint-disable-next-line global-require
  const { newDb, DataType } = require('pg-mem');
  const mem = newDb();
  // Test-double shims: stock PostgreSQL functions that pg-mem does not
  // implement. Production SQL stays idiomatic; only the double is patched.
  mem.public.registerFunction({
    name: 'trim', args: [DataType.text], returns: DataType.text,
    implementation: (value) => (value === null || value === undefined ? value : String(value).trim()),
  });
  mem.public.registerFunction({
    name: 'random', returns: DataType.float,
    implementation: () => Math.random(),
  });
  mem.public.registerFunction({
    name: 'nullif', args: [DataType.text, DataType.text], returns: DataType.text,
    implementation: (a, b) => (a === b ? null : a),
  });
  pool = new (mem.adapters.createPg().Pool)();
  // pg-mem evaluates `column - $n` as `$n - column` (verified repro on 3.0.14:
  // `UPDATE t SET stock = stock - $1` with stock=100 and $1=1 yields -99).
  // Real PostgreSQL evaluates it correctly, so production SQL stays idiomatic
  // and only this double rewrites the ONE affected statement shape — by exact
  // substring, so any future SQL change fails loudly in the suite instead of
  // being silently rewritten. CAST form is semantics-identical on real PG.
  const MEM_MINUS_ORIGINAL = 'stock = stock - $1';
  const MEM_MINUS_PATCHED = 'stock = stock - CAST($1 AS INT)';
  const patchMemMinus = (text) => (
    typeof text === 'string' ? text.split(MEM_MINUS_ORIGINAL).join(MEM_MINUS_PATCHED) : text
  );
  const wrapMemExecutor = (executor) => {
    const originalQuery = executor.query.bind(executor);
    executor.query = (text, params) => originalQuery(patchMemMinus(text), params);
    return executor;
  };
  wrapMemExecutor(pool);
  const memConnect = pool.connect.bind(pool);
  pool.connect = async () => wrapMemExecutor(await memConnect());
} else {
  // eslint-disable-next-line global-require
  const pg = require('pg');
  pgTypes = pg.types;
  // The application reasons about UTC timestamp strings everywhere (SQLite
  // stored 'YYYY-MM-DD HH:MM:SS'). Keep PostgreSQL values in that shape:
  // timestamptz/timestamp/date come back as strings instead of Date objects.
  pgTypes.setTypeParser(pgTypes.builtins.TIMESTAMPTZ, (value) => value);
  pgTypes.setTypeParser(pgTypes.builtins.TIMESTAMP, (value) => value);
  pgTypes.setTypeParser(pgTypes.builtins.DATE, (value) => value);
  // COUNT(*)/SUM(int) come back as int8, AVG() as numeric — node-postgres
  // returns both as strings by default. This store's magnitudes never approach
  // 2^53, so parse them to numbers to keep SQLite-identical value shapes.
  pgTypes.setTypeParser(pgTypes.builtins.INT8, (value) => parseInt(value, 10));
  pgTypes.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));
  pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    // All stored instants are UTC; interpret naive timestamp strings as UTC so
    // date bucketing never shifts with the server's local timezone. SSL and
    // everything else still comes solely from DATABASE_URL.
    options: '-c TimeZone=UTC',
  });
  pool.on('error', (error) => {
    // A single broken connection must not crash the process; details stay in
    // the server log (never sent to clients).
    console.error('[pg] idle connection error:', error.message);
  });
}

function prepare(sql, params) {
  const { text, count } = convertPlaceholders(sql);
  if (count !== params.length) {
    throw new Error(
      `Placeholder/parameter mismatch: ${count} placeholder(s) but ${params.length} parameter(s) in: ${sql.slice(0, 160)}`
    );
  }
  return text;
}

async function queryOn(executor, sql, params) {
  const result = await executor.query(prepare(sql, params), params);
  return result;
}

function clientHandle(client) {
  return {
    get: async (sql, ...params) => (await queryOn(client, sql, params)).rows[0],
    all: async (sql, ...params) => (await queryOn(client, sql, params)).rows,
    run: async (sql, ...params) => ({ changes: (await queryOn(client, sql, params)).rowCount || 0 }),
    insert: async (sql, ...params) => {
      if (!/^\s*insert\b/i.test(sql)) throw new Error('db.insert() must only be used for INSERT statements');
      const result = await queryOn(client, `${sql} RETURNING id`, params);
      if (!result.rows.length) throw new Error('INSERT … RETURNING id produced no row');
      return { id: Number(result.rows[0].id), changes: result.rowCount || 0 };
    },
  };
}

const shared = clientHandle(pool);

async function ensureStoreSettings(executor) {
  await executor.query(
    `INSERT INTO store_settings (id, contact, payment_methods, shipping_fee, delivery_options, notification_preferences)
     VALUES (1, $1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
    [
      JSON.stringify(DEFAULT_STORE_SETTINGS.contact),
      JSON.stringify(DEFAULT_STORE_SETTINGS.payment_methods),
      DEFAULT_STORE_SETTINGS.shipping_fee,
      JSON.stringify(DEFAULT_STORE_SETTINGS.delivery_options),
      JSON.stringify(DEFAULT_STORE_SETTINGS.notification_preferences),
    ]
  );
  // Preserve payment visibility for orders that predate their payments row.
  await executor.query(
    `INSERT INTO payments (order_id, payment_method, payment_status, amount_paid)
     SELECT o.id, o.payment_method, 'pending', 0 FROM orders o
     LEFT JOIN payments p ON p.order_id = o.id WHERE p.order_id IS NULL`
  );
}

// Demo seeding for PostgreSQL. Runs ONLY when SEED_DEMO_DATA=true (local dev
// and the automated test suite). Production stays empty until the real data
// is migrated in — an empty table NEVER implies demo data here.
async function seedDemoData(executor) {
  const products = await executor.query('SELECT COUNT(*) AS c FROM products');
  if (Number(products.rows[0].c) === 0) {
    for (const seed of SEED_PRODUCTS) {
      const row = { featured: 0, flash_sale: 0, ...seed };
      await executor.query(
        `INSERT INTO products (slug, name, description, price, old_price, image, badge, featured, flash_sale)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [row.slug, row.name, row.description, row.price, row.old_price, row.image, row.badge, row.featured, row.flash_sale]
      );
    }
    console.log(`Seeded ${SEED_PRODUCTS.length} demo products (SEED_DEMO_DATA=true)`);
  }
  const users = await executor.query('SELECT COUNT(*) AS c FROM users');
  if (Number(users.rows[0].c) === 0) {
    await executor.query(
      `INSERT INTO users (username, email, password_hash, full_name, phone, address, balance, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1)`,
      [DEMO_USER.username, DEMO_USER.email, bcrypt.hashSync('demo1234', 10),
        DEMO_USER.full_name, DEMO_USER.phone, DEMO_USER.address, DEMO_USER.balance, DEMO_USER.role]
    );
    console.log('Seeded demo owner account (SEED_DEMO_DATA=true — credentials are never printed)');
  }
  // Same post-seed fixups the SQLite engine applies: legacy image mirror,
  // category backfill, and category linkage.
  await executor.query(
    `INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary)
     SELECT p.id, p.image, 'image/*', p.image, 0, 1 FROM products p
     LEFT JOIN product_images pi ON pi.product_id = p.id WHERE pi.product_id IS NULL`
  );
  const uncategorized = await executor.query(
    `SELECT DISTINCT TRIM(category) AS name FROM products
     WHERE category_id IS NULL AND TRIM(category) <> ''`
  );
  for (const { name } of uncategorized.rows) {
    const base = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorized';
    let slug = base;
    let suffix = 2;
    while ((await executor.query('SELECT id FROM categories WHERE slug = $1', [slug])).rows.length) {
      slug = `${base}-${suffix++}`;
    }
    await executor.query(
      'INSERT INTO categories (name, slug) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM categories WHERE name = $1)',
      [name, slug]
    );
  }
  await executor.query(
    `UPDATE products SET category_id = c.id FROM categories c
     WHERE c.name = products.category AND products.category_id IS NULL AND TRIM(products.category) <> ''`
  );
  // Explicit inserts never advance identity sequences; repair them so the next
  // application insert cannot collide. The existence check also makes this a
  // no-op on drivers without real sequences. (Table names are hardcoded.)
  for (const table of ['products', 'users', 'categories', 'product_images']) {
    const sequence = `${table}_id_seq`;
    const exists = await executor.query(
      'SELECT 1 AS one FROM pg_class WHERE relkind = $1 AND relname = $2', ['S', sequence]
    );
    if (!exists.rows.length) continue;
    await executor.query(
      `SELECT setval('${sequence}', COALESCE((SELECT MAX(id) FROM ${table}), 1),`
      + ` COALESCE((SELECT MAX(id) FROM ${table}), 0) > 0)`
    );
  }
}

let initialised = false;

const pgEngine = {
  engine: 'postgres',

  get: shared.get,
  all: shared.all,
  run: shared.run,
  insert: shared.insert,

  // CRITICAL: every statement inside fn runs on the SAME checked-out client
  // between BEGIN and COMMIT/ROLLBACK. Never split a transaction across pooled
  // connections.
  transaction: async (fn) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      try {
        const result = await fn(clientHandle(client));
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
        throw error;
      }
    } finally {
      client.release();
    }
  },

  // Row-level lock used before stock checks so concurrent checkouts serialise
  // on the same products instead of overselling.
  forUpdate: () => ' FOR UPDATE',

  init: async () => {
    if (initialised) return;
    await pool.query(process.env.PG_MEM_TEST === '1' ? stripUnsupportedMemDdl(SCHEMA_SQL) : SCHEMA_SQL);
    await ensureStoreSettings(pool);
    if (process.env.SEED_DEMO_DATA === 'true') await seedDemoData(pool);
    initialised = true;
  },

  close: async () => {
    await pool.end().catch(() => undefined);
  },

  // Escape hatch for tooling/debugging only (pool, never a raw connection
  // string — DATABASE_URL is never exposed through this module).
  raw: pool,
};

module.exports = pgEngine;
// Test-support export (used by tests/migration.test.js): the pg-mem DDL
// filter above. Not part of the engine interface application code uses.
module.exports.stripUnsupportedMemDdl = stripUnsupportedMemDdl;
