#!/usr/bin/env node
// ONE-WAY production migration: SQLite backup file -> PostgreSQL.
//
//   npm run migrate:sqlite-to-postgres -- /path/to/pixels.db --execute
//
// Safety contract:
//   * The SQLite source is opened READ-ONLY and integrity-checked first.
//     It is never written to, never deleted, never modified in any way.
//   * The PostgreSQL destination comes ONLY from DATABASE_URL; the script
//     refuses to run without it.
//   * Without --execute this is a DRY RUN: prints source row counts and the
//     plan, writes nothing.
//   * With --execute, the whole import runs inside ONE PostgreSQL
//     transaction (all-or-nothing) after verifying the destination is empty.
//     Use --allow-non-empty to skip the emptiness check (explicit inserts
//     still abort loudly on primary-key conflict — data is never silently
//     duplicated or merged).
//   * IDs, bcrypt hashes, guest IDs, order snapshots, product images,
//     JSON settings, history records and session tokens are preserved
//     byte-for-byte. Empty-string date sentinels ('') become NULL.
//   * password_resets: only currently-valid (unused, unexpired) codes are
//     imported by default; expired/used rows are skipped and the skip count
//     is printed. Pass --include-expired-resets to import every row.
//   * NEVER prints password hashes, session tokens, reset codes, customer
//     personal information, or DATABASE_URL — only table names and counts.
//
// Exit code: 0 on success (or clean dry run), 1 on any failure/mismatch.
const fs = require('fs');
const path = require('path');

const TABLES_IN_FK_ORDER = [
  'users',
  'categories',
  'products',
  'product_images',
  'sessions',
  'carts',
  'wishlists',
  'coupons',
  'promotional_banners',
  'orders',
  'order_items',
  'payments',
  'order_status_history',
  'inventory_movements',
  'vendor_applications',
  'contact_messages',
  'read_messages',
  'notifications',
  'admin_notifications',
  'password_resets',
  'reviews',
  'audit_logs',
  'store_settings',
];

// Expected source columns (verified against sqlite_master before importing,
// so a schema drift fails loudly instead of mis-loading data).
const TABLE_COLUMNS = {
  users: ['id', 'username', 'email', 'password_hash', 'full_name', 'phone', 'address', 'avatar', 'balance', 'role', 'is_active', 'created_at'],
  categories: ['id', 'name', 'slug', 'description', 'image', 'is_active', 'created_at'],
  products: ['id', 'slug', 'name', 'description', 'price', 'old_price', 'image', 'category', 'badge', 'stock', 'rating', 'rating_count', 'featured', 'flash_sale', 'reorder_threshold', 'category_id', 'sku', 'status', 'brand', 'created_at'],
  product_images: ['id', 'product_id', 'image_data', 'mime_type', 'file_name', 'sort_order', 'is_primary', 'created_at'],
  sessions: ['token', 'user_id', 'created_at', 'expires_at'],
  carts: ['id', 'user_id', 'guest_id', 'product_id', 'quantity', 'created_at'],
  wishlists: ['id', 'user_id', 'guest_id', 'product_id', 'created_at'],
  coupons: ['id', 'code', 'discount_type', 'discount_value', 'minimum_order_amount', 'maximum_discount', 'usage_limit', 'usage_count', 'expires_at', 'is_active', 'created_at', 'updated_at'],
  promotional_banners: ['id', 'image', 'title', 'description', 'button_text', 'button_url', 'is_active', 'display_order', 'starts_at', 'ends_at', 'created_at', 'updated_at'],
  orders: ['id', 'user_id', 'guest_id', 'full_name', 'email', 'phone', 'address', 'shipping_method', 'payment_method', 'subtotal', 'shipping_fee', 'discount_amount', 'coupon_code', 'total', 'status', 'carrier', 'tracking_number', 'shipping_status', 'shipping_notes', 'internal_notes', 'created_at'],
  order_items: ['id', 'order_id', 'product_id', 'name', 'price', 'quantity'],
  payments: ['id', 'order_id', 'payment_method', 'payment_status', 'transaction_id', 'paid_at', 'amount_paid', 'created_at', 'updated_at'],
  order_status_history: ['id', 'order_id', 'status', 'note', 'changed_by', 'created_at'],
  inventory_movements: ['id', 'product_id', 'change', 'reason', 'note', 'changed_by', 'created_at'],
  vendor_applications: ['id', 'user_id', 'account_type', 'store_name', 'location', 'mobile', 'status', 'created_at'],
  contact_messages: ['id', 'user_id', 'name', 'email', 'subject', 'message', 'created_at'],
  read_messages: ['contact_message_id'],
  notifications: ['id', 'user_id', 'title', 'body', 'type', 'read', 'created_at'],
  admin_notifications: ['id', 'type', 'title', 'body', 'entity_type', 'entity_id', 'read', 'created_at'],
  password_resets: ['id', 'email', 'code', 'used', 'attempts', 'expires_at', 'created_at'],
  reviews: ['id', 'user_id', 'product_id', 'rating', 'comment', 'is_visible', 'created_at'],
  audit_logs: ['id', 'actor_id', 'action', 'entity_type', 'entity_id', 'details', 'created_at'],
  store_settings: ['id', 'store_name', 'contact', 'currency', 'store_status', 'payment_methods', 'shipping_fee', 'delivery_options', 'notification_preferences', 'updated_at'],
};

// Legacy '' date sentinels normalised to NULL on import (both engines treat
// NULL as "no date"; '' cannot even be stored in a TIMESTAMPTZ column).
const EMPTY_TO_NULL = new Set([
  'coupons.expires_at',
  'promotional_banners.starts_at',
  'promotional_banners.ends_at',
  'payments.paid_at',
]);

const TABLES_WITH_IDENTITY = TABLES_IN_FK_ORDER.filter(
  (table) => !['sessions', 'read_messages', 'store_settings'].includes(table)
);

function parseArgs(argv) {
  const options = { execute: false, allowNonEmpty: false, includeExpiredResets: false, sourcePath: null };
  for (const arg of argv) {
    if (arg === '--execute') options.execute = true;
    else if (arg === '--allow-non-empty') options.allowNonEmpty = true;
    else if (arg === '--include-expired-resets') options.includeExpiredResets = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!arg.startsWith('--') && !options.sourcePath) options.sourcePath = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function openSourceReadOnly(sourcePath) {
  if (!sourcePath) throw new Error('Provide the SQLite backup path: npm run migrate:sqlite-to-postgres -- /path/to/pixels.db [--execute]');
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite backup not found: ${sourcePath}`);
  // eslint-disable-next-line global-require
  const { DatabaseSync } = require('node:sqlite');
  let source;
  try {
    source = new DatabaseSync(sourcePath, { readOnly: true });
  } catch (error) {
    throw new Error(`Could not open the SQLite backup read-only (${error.message}). Refusing to open it any other way.`);
  }
  const integrity = source.prepare('PRAGMA integrity_check').get();
  const verdict = integrity && (integrity.integrity_check || integrity[Object.keys(integrity)[0]]);
  if (verdict !== 'ok') {
    source.close();
    throw new Error(`SQLite backup failed integrity_check: ${JSON.stringify(verdict)}. Aborting.`);
  }
  return source;
}

function verifySourceColumns(source) {
  for (const table of TABLES_IN_FK_ORDER) {
    const row = source.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    if (!row) throw new Error(`Source backup is missing table "${table}". Aborting.`);
    for (const column of TABLE_COLUMNS[table]) {
      if (!String(row.sql).includes(column)) {
        throw new Error(`Source table "${table}" is missing column "${column}". Aborting (schema drift).`);
      }
    }
  }
}

function readSourceCounts(source) {
  const counts = {};
  for (const table of TABLES_IN_FK_ORDER) {
    counts[table] = source.prepare(`SELECT COUNT(*) AS c FROM "${table}"`).get().c;
  }
  return counts;
}

function orderBy(table) {
  if (table === 'sessions') return 'ORDER BY token';
  if (table === 'read_messages') return 'ORDER BY contact_message_id';
  return 'ORDER BY id';
}

function isResetStillValid(row, nowMs) {
  if (Number(row.used) !== 0) return false;
  const expires = Date.parse(String(row.expires_at).replace(' ', 'T') + 'Z');
  return Number.isFinite(expires) && expires > nowMs;
}

async function migrate({ sourcePath, pool, options }) {
  const log = options.log || console.log;
  const source = openSourceReadOnly(sourcePath);
  try {
    verifySourceColumns(source);
    const sourceCounts = readSourceCounts(source);

    log('Source (SQLite, read-only) row counts:');
    for (const table of TABLES_IN_FK_ORDER) log(`  ${table}: ${sourceCounts[table]}`);
    const total = Object.values(sourceCounts).reduce((sum, count) => sum + count, 0);
    log(`  TOTAL: ${total}`);

    if (!options.execute) {
      log('');
      log('DRY RUN — nothing was written. Re-run with --execute to import.');
      log('Import first? Apply the schema with: npm run db:init:postgres');
      return { ok: true, dryRun: true, sourceCounts };
    }

    const client = await pool.connect();
    try {
      await client.query("SET TIME ZONE 'UTC'");
      if (!options.allowNonEmpty) {
        const nonEmpty = [];
        for (const table of TABLES_IN_FK_ORDER) {
          const existing = await client.query(`SELECT COUNT(*) AS c FROM "${table}"`);
          if (Number(existing.rows[0].c) > 0) nonEmpty.push(`${table} (${existing.rows[0].c})`);
        }
        if (nonEmpty.length) {
          throw new Error(
            `Destination is NOT empty (${nonEmpty.join(', ')}). Aborting to avoid duplicates. ` +
            'Use --allow-non-empty only if you understand the risk (conflicting ids still abort the import).'
          );
        }
      }

      await client.query('BEGIN');
      try {
        let skippedResets = 0;
        const nowMs = Date.now();
        for (const table of TABLES_IN_FK_ORDER) {
          const columns = TABLE_COLUMNS[table];
          let rows = source.prepare(`SELECT ${columns.map((c) => `"${c}"`).join(', ')} FROM "${table}" ${orderBy(table)}`).all();
          if (table === 'password_resets' && !options.includeExpiredResets) {
            const before = rows.length;
            rows = rows.filter((row) => isResetStillValid(row, nowMs));
            skippedResets = before - rows.length;
          }
          // Small chunks: product_images rows can carry multi-MB base64 blobs.
          const chunkSize = table === 'product_images' ? 25 : 200;
          for (let offset = 0; offset < rows.length; offset += chunkSize) {
            const chunk = rows.slice(offset, offset + chunkSize);
            const values = [];
            const groups = chunk.map((row) => {
              const placeholders = columns.map((column) => {
                let value = row[column] === undefined ? null : row[column];
                if (value === '' && EMPTY_TO_NULL.has(`${table}.${column}`)) value = null;
                values.push(value);
                return `$${values.length}`;
              });
              return `(${placeholders.join(', ')})`;
            });
            await client.query(
              `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${groups.join(', ')}`,
              values
            );
          }
          log(`  imported ${table}: ${rows.length}${table === 'password_resets' && skippedResets ? ` (skipped ${skippedResets} expired/used)` : ''}`);
        }

        // Repair every identity sequence after the explicit-ID import.
        for (const table of TABLES_WITH_IDENTITY) {
          const sequence = `${table}_id_seq`;
          const exists = await client.query(
            'SELECT 1 AS one FROM pg_class WHERE relkind = $1 AND relname = $2', ['S', sequence]
          );
          if (!exists.rows.length) continue; // no sequence on this server: nothing to repair
          await client.query(
            `SELECT setval('${sequence}', COALESCE((SELECT MAX(id) FROM "${table}"), 1), COALESCE((SELECT MAX(id) FROM "${table}"), 0) > 0)`
          );
        }
        log('  identity sequences repaired');

        await client.query('COMMIT');
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch (_) { /* already aborted */ }
        throw error;
      }

      // Destination counts must match the source (minus documented reset skips).
      const destCounts = {};
      const mismatches = [];
      for (const table of TABLES_IN_FK_ORDER) {
        const result = await client.query(`SELECT COUNT(*) AS c FROM "${table}"`);
        destCounts[table] = Number(result.rows[0].c);
        let expected = sourceCounts[table];
        if (table === 'password_resets' && !options.includeExpiredResets) {
          const rows = source.prepare('SELECT used, expires_at FROM password_resets').all();
          expected = rows.filter((row) => isResetStillValid(row, Date.now())).length;
        }
        if (destCounts[table] !== expected) mismatches.push(`${table}: source=${expected} destination=${destCounts[table]}`);
      }
      log('');
      log('Destination (PostgreSQL) row counts verified inside the import transaction window:');
      for (const table of TABLES_IN_FK_ORDER) log(`  ${table}: ${destCounts[table]}`);
      if (mismatches.length) {
        throw new Error(`Row-count MISMATCH after import: ${mismatches.join('; ')}. Investigate before proceeding.`);
      }
      log('');
      log('Migration complete. Next: npm run verify:migration -- /path/to/pixels.db');
      return { ok: true, dryRun: false, sourceCounts, destCounts };
    } finally {
      client.release();
    }
  } finally {
    source.close();
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.sourcePath) {
    console.log('Usage: npm run migrate:sqlite-to-postgres -- /path/to/pixels.db [--execute] [--allow-non-empty] [--include-expired-resets]');
    console.log('');
    console.log('  No flags          dry run: integrity-check + print source counts, write nothing');
    console.log('  --execute         perform the import (aborts unless the destination is empty)');
    console.log('  --allow-non-empty skip the destination-emptiness check (id conflicts still abort)');
    console.log('  --include-expired-resets  import expired/used password-reset rows too');
    console.log('');
    console.log('Requires DATABASE_URL. The SQLite file is opened read-only and never modified.');
    process.exit(options.help ? 0 : 1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('Refusing to run: DATABASE_URL is not set.');
    process.exit(1);
  }
  // eslint-disable-next-line global-require
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, options: '-c TimeZone=UTC' });
  try {
    await migrate({ sourcePath: path.resolve(options.sourcePath), pool, options });
  } catch (error) {
    console.error(`Migration FAILED: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

if (require.main === module) {
  main();
}

module.exports = { migrate, TABLES_IN_FK_ORDER, TABLE_COLUMNS };
