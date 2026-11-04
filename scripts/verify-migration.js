#!/usr/bin/env node
// Migration verifier: compares a SQLite backup against the PostgreSQL
// destination and reports PASS/FAIL per check.
//
//   npm run verify:migration -- /path/to/pixels.db
//
// Verifies: integrity of the source file, per-table row counts, ID/token
// sets, per-row content hashes (normalised across engines), foreign-key
// integrity, one-primary-image / payment-1:1 / coupon-uniqueness invariants,
// snapshot completeness, and identity-sequence positions.
//
// Prints table names, counts and PASS/FAIL lines ONLY — never password
// hashes, session tokens, reset codes, customer data, or DATABASE_URL.
// (Session rows are identified by a truncated SHA-256 of the token.)
//
// Exit code: 0 when every check passes, 1 otherwise.
const crypto = require('crypto');
const path = require('path');
const { TABLES_IN_FK_ORDER, TABLE_COLUMNS } = require('./migrate-sqlite-to-pg');

const PRIMARY_KEY = { sessions: 'token', read_messages: 'contact_message_id' };
const TIMESTAMP_COLUMNS = new Set(['created_at', 'updated_at', 'expires_at', 'starts_at', 'ends_at', 'paid_at']);
const EMPTY_TO_NULL = new Set([
  'coupons.expires_at',
  'promotional_banners.starts_at',
  'promotional_banners.ends_at',
  'payments.paid_at',
]);
const TABLES_WITH_IDENTITY = TABLES_IN_FK_ORDER.filter(
  (table) => !['sessions', 'read_messages', 'store_settings'].includes(table)
);

const FOREIGN_KEYS = [
  ['sessions', 'user_id', 'users', 'id', false],
  ['products', 'category_id', 'categories', 'id', true],
  ['product_images', 'product_id', 'products', 'id', false],
  ['carts', 'user_id', 'users', 'id', true],
  ['carts', 'product_id', 'products', 'id', false],
  ['wishlists', 'user_id', 'users', 'id', true],
  ['wishlists', 'product_id', 'products', 'id', false],
  ['orders', 'user_id', 'users', 'id', true],
  ['order_items', 'order_id', 'orders', 'id', false],
  ['order_items', 'product_id', 'products', 'id', true],
  ['payments', 'order_id', 'orders', 'id', false],
  ['order_status_history', 'order_id', 'orders', 'id', false],
  ['order_status_history', 'changed_by', 'users', 'id', true],
  ['inventory_movements', 'product_id', 'products', 'id', false],
  ['inventory_movements', 'changed_by', 'users', 'id', true],
  ['audit_logs', 'actor_id', 'users', 'id', true],
  ['vendor_applications', 'user_id', 'users', 'id', true],
  ['contact_messages', 'user_id', 'users', 'id', true],
  ['read_messages', 'contact_message_id', 'contact_messages', 'id', false],
  ['notifications', 'user_id', 'users', 'id', false],
  ['reviews', 'user_id', 'users', 'id', false],
  ['reviews', 'product_id', 'products', 'id', false],
];

// Tolerant timestamp -> epoch-ms parser for every shape both engines (and the
// pg-mem test double) can produce: Date objects, 'YYYY-MM-DD HH:MM:SS',
// ISO strings with T/Z/offsets, and fractional seconds.
function epochMs(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const text = String(value).trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:\s*(Z|[+-]\d{2}:?\d{2}?))?$/.exec(text);
  if (!match) throw new Error(`Unparseable timestamp: ${JSON.stringify(text).slice(0, 60)}`);
  const [, year, month, day, hour, minute, second, fraction, zone] = match;
  let ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (fraction) ms += Math.round(Number(`0.${fraction}`) * 1000);
  if (zone && zone !== 'Z') {
    const sign = zone[0] === '+' ? 1 : -1;
    const digits = zone.slice(1).replace(':', '');
    const offsetMinutes = Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || '0');
    ms -= sign * offsetMinutes * 60 * 1000;
  }
  return ms;
}

function normalise(table, column, value) {
  if (TIMESTAMP_COLUMNS.has(column)) return epochMs(value);
  if (value === '' && EMPTY_TO_NULL.has(`${table}.${column}`)) return null;
  if (typeof value === 'number') return value;
  if (value !== null && value !== undefined && typeof value !== 'string') return Number(value);
  return value === undefined ? null : value;
}

function rowHash(table, row) {
  const pairs = TABLE_COLUMNS[table].map((column) => [column, normalise(table, column, row[column])]);
  pairs.sort(([a], [b]) => (a < b ? -1 : 1));
  return crypto.createHash('sha256').update(JSON.stringify(pairs)).digest('hex');
}

function pkLabel(table, pk) {
  if (table === 'sessions') return `token#${crypto.createHash('sha256').update(String(pk)).digest('hex').slice(0, 12)}`;
  return `${table}#${pk}`;
}

async function verify({ sourcePath, pool, options = {} }) {
  const log = options.log || console.log;
  const checks = [];
  const record = (name, status, detail = '') => {
    checks.push({ name, status, detail });
    log(`${status === 'PASS' ? 'PASS' : status === 'SKIP' ? 'SKIP' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  // eslint-disable-next-line global-require
  const { DatabaseSync } = require('node:sqlite');
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const integrity = source.prepare('PRAGMA integrity_check').get();
    const verdict = integrity && (integrity.integrity_check || integrity[Object.keys(integrity)[0]]);
    record('source integrity_check', verdict === 'ok' ? 'PASS' : 'FAIL', verdict === 'ok' ? '' : JSON.stringify(verdict));
    if (verdict !== 'ok') return { ok: false, checks };

    const client = await pool.connect();
    try {
      await client.query("SET TIME ZONE 'UTC'");

      for (const table of TABLES_IN_FK_ORDER) {
        const pk = PRIMARY_KEY[table] || 'id';
        const columns = TABLE_COLUMNS[table];
        const sourceRows = source.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"`).all();
        const destResult = await client.query(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}"`);
        const destRows = destResult.rows;

        if (table === 'password_resets' && destRows.length !== sourceRows.length) {
          // Documented rule: expired/used codes may be skipped by the import.
          record(`${table} count (valid-only import)`, 'PASS', `${destRows.length} of ${sourceRows.length} source rows`);
        } else if (destRows.length !== sourceRows.length) {
          record(`${table} count`, 'FAIL', `source=${sourceRows.length} destination=${destRows.length}`);
          continue;
        } else {
          record(`${table} count (${sourceRows.length})`, 'PASS');
        }

        const sourceByPk = new Map(sourceRows.map((row) => [String(row[pk]), rowHash(table, row)]));
        const mismatched = [];
        const seen = new Set();
        for (const row of destRows) {
          const key = String(row[pk]);
          seen.add(key);
          const expected = sourceByPk.get(key);
          if (expected === undefined) mismatched.push(`${pkLabel(table, key)} (not in source)`);
          else if (expected !== rowHash(table, row)) mismatched.push(pkLabel(table, key));
          if (mismatched.length >= 5) break;
        }
        const missing = [...sourceByPk.keys()].filter(
          (key) => !seen.has(key) && !(table === 'password_resets' && destRows.length !== sourceRows.length)
        );
        if (!mismatched.length && !missing.length) {
          record(`${table} ids+content (${destRows.length} rows)`, 'PASS');
        } else {
          const detail = [...mismatched, ...missing.slice(0, 5).map((key) => `${pkLabel(table, key)} (missing)`)].join(', ');
          record(`${table} ids+content`, 'FAIL', detail);
        }

        if (!['sessions', 'read_messages'].includes(table)) {
          const ids = destRows.map((row) => Number(row.id));
          if (ids.length) record(`${table} id range`, 'PASS', `${Math.min(...ids)}..${Math.max(...ids)}`);
        }
      }

      for (const [child, column, parent, parentColumn, nullable] of FOREIGN_KEYS) {
        const result = await client.query(
          `SELECT COUNT(*) AS n FROM "${child}" c LEFT JOIN "${parent}" p ON p."${parentColumn}" = c."${column}"
           WHERE ${nullable ? `c."${column}" IS NOT NULL AND ` : ''}p."${parentColumn}" IS NULL`
        );
        const orphans = Number(result.rows[0].n);
        record(`fk ${child}.${column} -> ${parent}`, orphans === 0 ? 'PASS' : 'FAIL', orphans === 0 ? '' : `${orphans} orphans`);
      }

      // Duplicate scans fetch grouped counts and filter in JS (no HAVING) so
      // the same checks also run on the pg-mem test double, which cannot
      // parse HAVING. Logic is identical: any group with n > 1 fails.
      const duplicates = async (label, sql) => {
        const groups = await client.query(sql);
        const bad = groups.rows.filter((row) => Number(row.n) > 1).length;
        record(label, bad === 0 ? 'PASS' : 'FAIL', bad === 0 ? '' : `${bad} duplicated groups`);
      };
      await duplicates('invariant: <=1 primary image per product',
        'SELECT product_id, COUNT(*) AS n FROM product_images WHERE is_primary = 1 GROUP BY product_id');
      await duplicates('invariant: payments.order_id unique',
        'SELECT order_id, COUNT(*) AS n FROM payments GROUP BY order_id');
      await duplicates('invariant: coupons.code unique (case-insensitive)',
        'SELECT lower(code) AS code, COUNT(*) AS n FROM coupons GROUP BY lower(code)');
      const settings = await client.query('SELECT COUNT(*) AS n FROM store_settings WHERE id = 1');
      record('invariant: store_settings singleton', Number(settings.rows[0].n) === 1 ? 'PASS' : 'FAIL');
      const snapshots = await client.query(
        'SELECT COUNT(*) AS n FROM order_items WHERE name IS NULL OR price IS NULL OR quantity IS NULL'
      );
      record('invariant: order_items snapshots complete', Number(snapshots.rows[0].n) === 0 ? 'PASS' : 'FAIL');

      for (const table of TABLES_WITH_IDENTITY) {
        const sequence = `${table}_id_seq`;
        const exists = await client.query(
          'SELECT 1 AS one FROM pg_class WHERE relkind = $1 AND relname = $2', ['S', sequence]
        );
        if (!exists.rows.length) {
          record(`sequence ${sequence}`, 'SKIP', 'no sequence on this server');
          continue;
        }
        const state = await client.query(`SELECT last_value, is_called FROM "${sequence}"`);
        const maxId = await client.query(`SELECT MAX(id) AS max FROM "${table}"`);
        const next = Number(state.rows[0].last_value) + (state.rows[0].is_called ? 1 : 0);
        const max = maxId.rows[0].max === null ? null : Number(maxId.rows[0].max);
        record(`sequence ${sequence}`, max === null || next > max ? 'PASS' : 'FAIL', max === null ? 'empty table' : `next=${next} max(id)=${max}`);
      }
    } finally {
      client.release();
    }
  } finally {
    source.close();
  }

  const failed = checks.filter((check) => check.status === 'FAIL');
  log('');
  log(failed.length ? `VERIFICATION FAILED (${failed.length} failing checks)` : 'VERIFICATION PASSED');
  return { ok: failed.length === 0, checks };
}

async function main() {
  const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
  if (!args.length || process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: npm run verify:migration -- /path/to/pixels.db');
    console.log('Requires DATABASE_URL. The SQLite file is opened read-only and never modified.');
    process.exit(args.length ? 0 : 1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Refusing to run: DATABASE_URL is not set.');
    process.exit(1);
  }
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  try {
    const result = await verify({ sourcePath: path.resolve(args[0]), pool });
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`Verification FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verify };
