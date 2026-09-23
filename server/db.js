// SQLite database layer for Pixels store
// Uses Node.js built-in SQLite (node:sqlite) — NO native compilation, NO Visual Studio needed.
//
// This file implements the "sqlite" engine of the database abstraction (see
// server/database.js). All application code talks to it through the async
// interface { get, all, run, insert, transaction } — never DatabaseSync
// directly — so the same call sites run unchanged against PostgreSQL.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { SEED_PRODUCTS, DEMO_USER, DEFAULT_STORE_SETTINGS } = require('./seed-data');

// SQLITE_DB_PATH overrides the database file location (used by the automated
// test suite for isolation). Production behaviour is unchanged when unset.
const dbFilePath = process.env.SQLITE_DB_PATH || path.join(__dirname, '..', 'data', 'pixels.db');
const dataDir = path.dirname(dbFilePath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(dbFilePath);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ---------- Schema ----------
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  username      TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name     TEXT DEFAULT '',
  phone         TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  avatar        TEXT DEFAULT 'img/bg-img/9.jpg',
  balance       REAL DEFAULT 0,
  role          TEXT DEFAULT 'customer',
  created_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  slug        TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  description TEXT DEFAULT '',
  price       REAL NOT NULL,
  old_price   REAL,
  image       TEXT NOT NULL,
  category    TEXT DEFAULT 'GoPro Accessories',
  badge       TEXT,
  stock       INTEGER DEFAULT 100,
  rating      REAL DEFAULT 0,
  rating_count INTEGER DEFAULT 0,
  featured    INTEGER DEFAULT 0,
  flash_sale  INTEGER DEFAULT 0,
  reorder_threshold INTEGER DEFAULT 10,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sku         TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  brand       TEXT DEFAULT '',
  mpn         TEXT DEFAULT '',
  gtin        TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  slug        TEXT NOT NULL UNIQUE,
  description TEXT DEFAULT '',
  image       TEXT DEFAULT '',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product_images (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  image_data  TEXT NOT NULL,
  mime_type   TEXT NOT NULL,
  file_name   TEXT DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_primary  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS carts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id   TEXT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  quantity   INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS wishlists (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id   TEXT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  guest_id    TEXT,
  full_name   TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT NOT NULL,
  address     TEXT NOT NULL,
  shipping_method TEXT DEFAULT 'standard',
  payment_method  TEXT DEFAULT 'cash',
  subtotal    REAL NOT NULL,
  shipping_fee REAL NOT NULL DEFAULT 0,
  discount_amount REAL NOT NULL DEFAULT 0,
  coupon_code TEXT DEFAULT '',
  total       REAL NOT NULL,
  status      TEXT DEFAULT 'pending',
  carrier     TEXT DEFAULT '',
  tracking_number TEXT DEFAULT '',
  shipping_status TEXT DEFAULT 'pending',
  shipping_notes TEXT DEFAULT '',
  internal_notes TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS coupons (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  code                TEXT NOT NULL UNIQUE COLLATE NOCASE,
  discount_type       TEXT NOT NULL CHECK(discount_type IN ('percentage', 'fixed')),
  discount_value      REAL NOT NULL CHECK(discount_value > 0),
  minimum_order_amount REAL NOT NULL DEFAULT 0 CHECK(minimum_order_amount >= 0),
  maximum_discount    REAL CHECK(maximum_discount IS NULL OR maximum_discount >= 0),
  usage_limit         INTEGER CHECK(usage_limit IS NULL OR usage_limit >= 0),
  usage_count         INTEGER NOT NULL DEFAULT 0 CHECK(usage_count >= 0),
  expires_at          TEXT,
  is_active           INTEGER NOT NULL DEFAULT 1,
  created_at          TEXT DEFAULT (datetime('now')),
  updated_at          TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS promotional_banners (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  image         TEXT NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  button_text   TEXT DEFAULT '',
  button_url    TEXT DEFAULT '',
  is_active     INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  starts_at     TEXT,
  ends_at       TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  payment_method  TEXT NOT NULL,
  payment_status  TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  transaction_id  TEXT DEFAULT '',
  paid_at         TEXT,
  amount_paid     REAL NOT NULL DEFAULT 0 CHECK(amount_paid >= 0),
  created_at      TEXT DEFAULT (datetime('now')),
  updated_at      TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_status_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      TEXT NOT NULL,
  note        TEXT DEFAULT '',
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS inventory_movements (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  change      INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  note        TEXT DEFAULT '',
  changed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  details     TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS store_settings (
  id                       INTEGER PRIMARY KEY CHECK(id = 1),
  store_name               TEXT NOT NULL DEFAULT 'PixelHouse',
  contact                  TEXT NOT NULL DEFAULT '{}',
  currency                 TEXT NOT NULL DEFAULT 'LKR',
  store_status             TEXT NOT NULL DEFAULT 'open',
  payment_methods          TEXT NOT NULL DEFAULT '[]',
  shipping_fee             REAL NOT NULL DEFAULT 0 CHECK(shipping_fee >= 0),
  delivery_options         TEXT NOT NULL DEFAULT '[]',
  notification_preferences TEXT NOT NULL DEFAULT '{}',
  updated_at               TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  price      REAL NOT NULL,
  quantity   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vendor_applications (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  account_type TEXT NOT NULL,
  store_name   TEXT NOT NULL,
  location     TEXT NOT NULL,
  mobile       TEXT NOT NULL,
  status       TEXT DEFAULT 'pending',
  created_at   TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL,
  subject    TEXT DEFAULT '',
  message    TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title   TEXT NOT NULL,
  body    TEXT DEFAULT '',
  type    TEXT DEFAULT 'info',
  read    INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_notifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  type        TEXT NOT NULL CHECK(type IN ('order', 'customer', 'vendor', 'contact', 'review')),
  title       TEXT NOT NULL,
  body        TEXT DEFAULT '',
  entity_type TEXT NOT NULL,
  entity_id   TEXT NOT NULL,
  read        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  email   TEXT NOT NULL,
  code    TEXT NOT NULL,
  used    INTEGER DEFAULT 0,
  attempts INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL,
  comment    TEXT DEFAULT '',
  is_visible INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS read_messages (
  contact_message_id INTEGER PRIMARY KEY REFERENCES contact_messages(id) ON DELETE CASCADE
);
`);

// ---------- Migrations for databases created by older versions ----------
(function migrate() {
  // node:sqlite does not reliably return rows from prepared PRAGMA statements,
  // so we inspect the stored CREATE TABLE SQL from sqlite_master instead.
  const tableSql = (t) => {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
    return row ? String(row.sql) : '';
  };
  const hasCol = (t, col) => tableSql(t).includes(col);

  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');

  // carts: add guest_id + make user_id nullable (guest shopping)
  if (tableSql('carts') && !hasCol('carts', 'guest_id')) {
    db.exec(`
      ALTER TABLE carts RENAME TO carts_old;
      CREATE TABLE carts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        guest_id TEXT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO carts (id, user_id, product_id, quantity, created_at)
        SELECT id, user_id, product_id, quantity, created_at FROM carts_old;
      DROP TABLE carts_old;
    `);
  }

  // wishlists: same treatment
  if (tableSql('wishlists') && !hasCol('wishlists', 'guest_id')) {
    db.exec(`
      ALTER TABLE wishlists RENAME TO wishlists_old;
      CREATE TABLE wishlists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        guest_id TEXT,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO wishlists (id, user_id, product_id, created_at)
        SELECT id, user_id, product_id, created_at FROM wishlists_old;
      DROP TABLE wishlists_old;
    `);
  }

  // orders: user_id must be nullable (guest checkout) + guest_id column
  const oSql = tableSql('orders');
  const userNotNull = /user_id\s+INTEGER\s+NOT\s+NULL/i.test(oSql);
  if (oSql && userNotNull) {
    db.exec(`
      ALTER TABLE orders RENAME TO orders_old;
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        guest_id TEXT,
        full_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT NOT NULL,
        address TEXT NOT NULL,
        shipping_method TEXT DEFAULT 'standard',
        payment_method TEXT DEFAULT 'cash',
        subtotal REAL NOT NULL,
        shipping_fee REAL NOT NULL DEFAULT 0,
        total REAL NOT NULL,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO orders (id, user_id, full_name, email, phone, address, shipping_method, payment_method, subtotal, shipping_fee, total, status, created_at)
        SELECT id, user_id, full_name, email, phone, address, shipping_method, payment_method, subtotal, shipping_fee, total, status, created_at FROM orders_old;
      DROP TABLE orders_old;
    `);
  } else if (oSql && !hasCol('orders', 'guest_id')) {
    db.exec('ALTER TABLE orders ADD COLUMN guest_id TEXT');
  }

  const addColumn = (table, column, definition) => {
    if (tableSql(table) && !hasCol(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
  };
  addColumn('orders', 'carrier', "carrier TEXT DEFAULT ''");
  addColumn('orders', 'tracking_number', "tracking_number TEXT DEFAULT ''");
  addColumn('orders', 'shipping_status', "shipping_status TEXT DEFAULT 'pending'");
  addColumn('orders', 'shipping_notes', "shipping_notes TEXT DEFAULT ''");
  addColumn('orders', 'discount_amount', 'discount_amount REAL NOT NULL DEFAULT 0');
  addColumn('orders', 'coupon_code', "coupon_code TEXT DEFAULT ''");
  addColumn('orders', 'internal_notes', "internal_notes TEXT DEFAULT ''");
  addColumn('products', 'reorder_threshold', 'reorder_threshold INTEGER DEFAULT 10');
  addColumn('products', 'category_id', 'category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL');
  addColumn('products', 'sku', 'sku TEXT');
  addColumn('products', 'status', "status TEXT NOT NULL DEFAULT 'active'");
  addColumn('products', 'brand', "brand TEXT DEFAULT ''");
  addColumn('products', 'mpn', "mpn TEXT DEFAULT ''");
  addColumn('products', 'gtin', "gtin TEXT DEFAULT ''");
  addColumn('reviews', 'is_visible', 'is_visible INTEGER NOT NULL DEFAULT 1');
  addColumn('users', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1');
  addColumn('password_resets', 'attempts', 'attempts INTEGER DEFAULT 0');

  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      slug TEXT NOT NULL UNIQUE,
      description TEXT DEFAULT '',
      image TEXT DEFAULT '',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      image_data TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_name TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_primary INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_products_sku_unique ON products(sku) WHERE sku IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_product_images_product_order ON product_images(product_id, sort_order);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_product_images_primary ON product_images(product_id) WHERE is_primary = 1;
    CREATE INDEX IF NOT EXISTS idx_orders_analytics ON orders(created_at, status);
    CREATE INDEX IF NOT EXISTS idx_orders_user_created ON orders(user_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_order_items_order_product ON order_items(order_id, product_id);
    CREATE INDEX IF NOT EXISTS idx_coupons_active_expiry ON coupons(is_active, expires_at);
    CREATE INDEX IF NOT EXISTS idx_promotional_banners_active_dates ON promotional_banners(is_active, starts_at, ends_at, display_order);
    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(payment_status, created_at);
    CREATE INDEX IF NOT EXISTS idx_admin_notifications_read_created ON admin_notifications(read, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_filters ON audit_logs(actor_id, action, entity_type, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_users_admin_active ON users(role, is_active);
  `);

  // Pixel House operates in Sri Lanka. Correct legacy template databases that
  // were accidentally created with the Pakistani currency code.
  db.prepare("UPDATE store_settings SET currency = 'LKR' WHERE upper(currency) = 'PKR'").run();

  // Preserve payment visibility for existing orders without declaring them paid.
  db.prepare(`INSERT OR IGNORE INTO payments (order_id, payment_method, payment_status, amount_paid)
    SELECT id, payment_method, 'pending', 0 FROM orders`).run();

  const slugify = (value) => String(value).toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorized';
  const categoryNames = db.prepare("SELECT DISTINCT TRIM(category) AS name FROM products WHERE TRIM(category) != ''").all();
  const insertCategory = db.prepare('INSERT OR IGNORE INTO categories (name, slug) VALUES (?, ?)');
  for (const { name } of categoryNames) {
    let slug = slugify(name);
    let suffix = 2;
    while (true) {
      const conflict = db.prepare('SELECT name FROM categories WHERE slug = ?').get(slug);
      if (!conflict || conflict.name === name) break;
      slug = `${slugify(name)}-${suffix++}`;
    }
    insertCategory.run(name, slug);
  }
  db.exec(`UPDATE products SET category_id = (
    SELECT id FROM categories WHERE categories.name = products.category
  ) WHERE category_id IS NULL AND TRIM(category) != ''`);

  const legacyImages = db.prepare(`SELECT p.id, p.image FROM products p
    WHERE NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)`).all();
  const insertImage = db.prepare(`INSERT INTO product_images
    (product_id, image_data, mime_type, file_name, sort_order, is_primary) VALUES (?, ?, ?, ?, 0, 1)`);
  for (const product of legacyImages) {
    const extension = path.extname(product.image).slice(1).toLowerCase();
    const mimeType = ({ jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' })[extension] || 'image/*';
    insertImage.run(product.id, product.image, mimeType, path.basename(product.image));
  }

  // Normalise legacy "empty string means unset" date sentinels to NULL so both
  // engines share one query shape (expires_at/starts_at/ends_at IS NULL …).
  // One-time, idempotent, and behaviour-preserving: '' always meant "no date".
  for (const [table, column] of [['coupons', 'expires_at'], ['promotional_banners', 'starts_at'], ['promotional_banners', 'ends_at']]) {
    try { db.prepare(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = ''`).run(); } catch (_) { /* pre-table DBs */ }
  }

  db.exec('PRAGMA legacy_alter_table = OFF');
  db.exec('PRAGMA foreign_keys = ON');
})();

// This singleton stores operational display choices only; credentials remain environment-only.
db.prepare(`INSERT OR IGNORE INTO store_settings
  (id, contact, payment_methods, shipping_fee, delivery_options, notification_preferences)
  VALUES (1, ?, ?, ?, ?, ?)`)
  .run(
    JSON.stringify(DEFAULT_STORE_SETTINGS.contact),
    JSON.stringify(DEFAULT_STORE_SETTINGS.payment_methods),
    DEFAULT_STORE_SETTINGS.shipping_fee,
    JSON.stringify(DEFAULT_STORE_SETTINGS.delivery_options),
    JSON.stringify(DEFAULT_STORE_SETTINGS.notification_preferences)
  );

// Ensure the demo user has admin role (for databases created before admin panel)
const demoUser = db.prepare("SELECT id FROM users WHERE email = 'demo@pixels.com'").get();
if (demoUser) {
  db.prepare("UPDATE users SET role = 'owner' WHERE id = ? AND role IN ('customer', 'admin')").run(demoUser.id);
}

// ---------- Seed products ----------
// Demo seeding is gated: SQLite keeps its historical convenience behaviour
// (seed an empty database) unless SEED_DEMO_DATA=false. PostgreSQL never
// seeds implicitly — see server/db-pg.js (SEED_DEMO_DATA=true required).
const SEEDING_ALLOWED = process.env.SEED_DEMO_DATA !== 'false';

const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (count === 0 && SEEDING_ALLOWED) {
  const insert = db.prepare(`INSERT INTO products (slug, name, description, price, old_price, image, badge, featured, flash_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (const p of SEED_PRODUCTS) {
      const row = { featured: 0, flash_sale: 0, ...p };
      insert.run(row.slug, row.name, row.description, row.price, row.old_price, row.image, row.badge, row.featured, row.flash_sale);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`Seeded ${SEED_PRODUCTS.length} demo products`);
}

// New databases seed products after migrations, so mirror those legacy paths immediately.
db.prepare(`INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary)
  SELECT p.id, p.image, 'image/*', p.image, 0, 1 FROM products p
  WHERE NOT EXISTS (SELECT 1 FROM product_images pi WHERE pi.product_id = p.id)`).run();
const uncategorizedProducts = db.prepare("SELECT DISTINCT TRIM(category) AS name FROM products WHERE category_id IS NULL AND TRIM(category) != ''").all();
for (const { name } of uncategorizedProducts) {
  if (!db.prepare('SELECT id FROM categories WHERE name = ?').get(name)) {
    const baseSlug = String(name).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'uncategorized';
    let slug = baseSlug;
    let suffix = 2;
    while (db.prepare('SELECT id FROM categories WHERE slug = ?').get(slug)) slug = `${baseSlug}-${suffix++}`;
    db.prepare('INSERT INTO categories (name, slug) VALUES (?, ?)').run(name, slug);
  }
}
db.exec(`UPDATE products SET category_id = (
  SELECT id FROM categories WHERE categories.name = products.category
) WHERE category_id IS NULL AND TRIM(category) != ''`);

// Demo owner account so a fresh development shop works out of the box.
// (SQLite dev convenience only. Credentials are NEVER logged.)
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0 && SEEDING_ALLOWED) {
  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare(`INSERT INTO users (username, email, password_hash, full_name, phone, address, balance, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(DEMO_USER.username, DEMO_USER.email, hash, DEMO_USER.full_name,
      DEMO_USER.phone, DEMO_USER.address, DEMO_USER.balance, 'admin');
  // The migrate() upgrade above only covers pre-existing rows, so promote now.
  db.prepare("UPDATE users SET role = 'owner' WHERE email = ?").run(DEMO_USER.email);
  console.log('Seeded demo owner account (development convenience only — credentials are never printed)');
}

// ---------- Async engine interface (shared with PostgreSQL) ----------
//
// node:sqlite is synchronous. Every operation below is serialised through a
// single promise queue so the async route code keeps exactly the original
// single-writer semantics: statements from concurrent requests can never
// interleave inside an open transaction, and SQLITE_BUSY is impossible.
// Transactions pass a non-queuing handle (`tx`) whose methods run inline,
// because the surrounding transaction unit already owns the queue.
let sqliteQueue = Promise.resolve();
function enqueue(fn) {
  const result = sqliteQueue.then(fn);
  sqliteQueue = result.then(
    () => undefined,
    () => undefined // a failed unit must not stall later ones
  );
  return result;
}

function rawGet(sql, params) {
  return db.prepare(sql).get(...params);
}

function rawAll(sql, params) {
  return db.prepare(sql).all(...params);
}

function rawRun(sql, params) {
  const info = db.prepare(sql).run(...params);
  return { changes: Number(info.changes), lastInsertRowid: Number(info.lastInsertRowid) };
}

function makeTx() {
  return {
    get: async (sql, ...params) => rawGet(sql, params),
    all: async (sql, ...params) => rawAll(sql, params),
    run: async (sql, ...params) => ({ changes: rawRun(sql, params).changes }),
    insert: async (sql, ...params) => {
      if (!/^\s*insert\b/i.test(sql)) throw new Error('db.insert() must only be used for INSERT statements');
      const info = rawRun(sql, params);
      return { id: info.lastInsertRowid, changes: info.changes };
    },
  };
}

const tx = makeTx();

const sqliteEngine = {
  engine: 'sqlite',

  get: (sql, ...params) => enqueue(() => rawGet(sql, params)),
  all: (sql, ...params) => enqueue(() => rawAll(sql, params)),
  run: (sql, ...params) => enqueue(() => ({ changes: rawRun(sql, params).changes })),
  insert: (sql, ...params) => enqueue(() => tx.insert(sql, ...params)),

  transaction: (fn) => enqueue(async () => {
    db.exec('BEGIN');
    try {
      const result = await fn(tx);
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch (_) { /* already rolled back */ }
      throw error;
    }
  }),

  // SQLite transactions are fully serialised by the queue above, so no row
  // locking clause is needed (and SQLite would reject FOR UPDATE anyway).
  forUpdate: () => '',

  // Schema/DDL already ran synchronously at require time; kept for symmetry
  // with the PostgreSQL engine so boot code can `await db.init()` blindly.
  init: async () => undefined,

  close: async () => { db.close(); },

  // Escape hatch for tooling/debugging only. Application routes must use the
  // interface above, never this handle.
  raw: db,
};

module.exports = sqliteEngine;
