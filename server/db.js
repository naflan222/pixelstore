// SQLite database layer for Pixels store
// Uses Node.js built-in SQLite (node:sqlite) — NO native compilation, NO Visual Studio needed.
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '..', 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(path.join(dataDir, 'pixels.db'));
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
  rating      REAL DEFAULT 4.5,
  rating_count INTEGER DEFAULT 0,
  featured    INTEGER DEFAULT 0,
  flash_sale  INTEGER DEFAULT 0,
  reorder_threshold INTEGER DEFAULT 10,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  sku         TEXT,
  status      TEXT NOT NULL DEFAULT 'active',
  brand       TEXT DEFAULT '',
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
  currency                 TEXT NOT NULL DEFAULT 'PKR',
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

  db.exec('PRAGMA legacy_alter_table = OFF');
  db.exec('PRAGMA foreign_keys = ON');
})();

// This singleton stores operational display choices only; credentials remain environment-only.
db.prepare(`INSERT OR IGNORE INTO store_settings
  (id, contact, payment_methods, shipping_fee, delivery_options, notification_preferences)
  VALUES (1, ?, ?, ?, ?, ?)`)
  .run(
    JSON.stringify({ email: '', phone: '', address: '' }),
    JSON.stringify(['cash', 'credit-card', 'bank', 'paypal']),
    250,
    JSON.stringify([
      { method: 'standard', label: 'Regular delivery', fee: 250, enabled: true },
      { method: 'express', label: 'Express delivery', fee: 500, enabled: true },
      { method: 'pickup', label: 'Pickup', fee: 0, enabled: true },
    ]),
    JSON.stringify({ new_orders: true, low_stock: true, vendor_applications: true })
  );

// Ensure the demo user has admin role (for databases created before admin panel)
const demoUser = db.prepare("SELECT id FROM users WHERE email = 'demo@pixels.com'").get();
if (demoUser) {
  db.prepare("UPDATE users SET role = 'owner' WHERE id = ? AND role IN ('customer', 'admin')").run(demoUser.id);
}

// ---------- Seed products ----------
const products = [
  { slug: 'single-product', name: '50 in 1 Accessories Kit GoPro', price: 8000, old_price: 13000, image: 'img/product/18.png', badge: 'Sale', featured: 1, flash_sale: 1, description: 'Complete 50-in-1 accessory bundle for GoPro Hero cameras — mounts, straps, grips, cases and more.' },
  { slug: '12in1kit', name: 'GoPro 12 in 1 Kit', price: 4800, old_price: 5990, image: 'img/product/12.png', badge: 'Sale', featured: 1, description: 'Essential 12-in-1 GoPro accessory kit with mounts and straps for everyday shooting.' },
  { slug: '19kit', name: '19 in 1 Kit GoPro', price: 4990, old_price: 5900, image: 'img/product/14.png', badge: 'Sale', featured: 1, flash_sale: 1, description: '19-piece GoPro accessory kit covering helmet, chest, bike and hand mounts.' },
  { slug: '27mstick', name: '2.7M Selfie Stick GoPro', price: 7400, old_price: 10500, image: 'img/product/5.png', badge: 'New', featured: 1, description: 'Extra-long 2.7 metre extendable selfie stick for dramatic wide-angle GoPro shots.' },
  { slug: '3mstick', name: '3M Selfie Stick', price: 8000, old_price: 14000, image: 'img/product/3mstick.png', badge: 'Sale', description: 'Ultra-long 3 metre carbon selfie stick for GoPro and action cameras.' },
  { slug: '3slotcharger', name: '3 Slot Battery Charger', price: 5000, old_price: 7000, image: 'img/product/3slot.png', badge: 'Sale', featured: 1, description: 'Charge three GoPro batteries simultaneously with smart LED indicators.' },
  { slug: '3waystick', name: '3 Way Selfie Stick (Adjustable)', price: 4500, old_price: 5900, image: 'img/product/6.png', badge: 'New', description: '3-way grip, arm and tripod combo — the most versatile GoPro mount.' },
  { slug: 'cover', name: 'GoPro Silicone Case 13/12/11/10/9/8/7/6/5', price: 1990, old_price: 2500, image: 'img/product/15.png', badge: 'Sale', description: 'Soft silicone protective sleeve with lanyard for GoPro Hero 5–13.' },
  { slug: 'domeport', name: 'Dome Port', price: 14000, old_price: 22000, image: 'img/product/domeport.png', badge: 'Sale', featured: 1, description: '6-inch dome port for stunning split over/under water shots.' },
  { slug: 'fhstick', name: 'Floating Handle Stick GoPro', price: 1200, old_price: 1500, image: 'img/product/9.png', badge: '-18%', description: 'Bright floating hand grip keeps your GoPro afloat during water sports.' },
  { slug: 'gbattery', name: 'Telesin Battery GoPro Hero 13/12/11/10/9', price: 7500, old_price: 9500, image: 'img/product/20.png', badge: 'Sale', featured: 1, description: 'High-capacity Telesin replacement battery compatible with Hero 9–13.' },
  { slug: 'goggles', name: 'Goggles With Mount', price: 4700, old_price: 5400, image: 'img/product/21.png', badge: 'New', description: 'Diving goggles with built-in GoPro mount for hands-free underwater filming.' },
  { slug: 'gptemp', name: 'GoPro Tempered Glass', price: 1800, old_price: 2400, image: 'img/product/gptemp.png', badge: 'Sale', description: '9H tempered glass screen and lens protector kit for GoPro.' },
  { slug: 'helmetstrap', name: 'Helmet Chin Strap Mount', price: 2990, old_price: 3300, image: 'img/product/11.png', badge: 'Sale', flash_sale: 1, description: 'Secure chin-strap helmet mount for POV moto and cycling footage.' },
  { slug: 'lensfilter', name: 'GoPro Lens Filter (UnderWater)', price: 6000, old_price: 8500, image: 'img/product/4.png', badge: 'On Sale', description: 'Red/magenta dive filters that restore natural colour underwater.' },
  { slug: 'wpdcase', name: 'Water Proof Diving Case', price: 4300, old_price: 6500, image: 'img/product/8.png', badge: '-11%', description: '45 m waterproof dive housing for GoPro Hero cameras.' },
  { slug: 'x4case1', name: 'Insta 360 X4 Silicone Case', price: 1900, old_price: 2800, image: 'img/product/19.png', badge: 'New', description: 'Shock-absorbing silicone case for the Insta360 X4.' },
  { slug: 'btrychrger13', name: 'Battery charger for Hero 13', price: 8200, old_price: 9400, image: 'img/product/22.png', badge: 'New', description: 'Hero 13 3Slot Battery Charger' },
  { slug: 'antifog', name: 'GoPro Hero Anti-Fog Inserts 12 Pack', price: 300, old_price: 360, image: 'img/product/23.png', badge: 'New', description: 'GoPro Hero Anti-Fogs' },
  { slug: 'hero13', name: 'GoPro Hero 13 Black', price: 92000, old_price: 98000, image: 'img/product/hero13.png', badge: 'New', description: 'GoPro Hero 13 Black' },
  { slug: 'osmocap', name: 'DJI Action 5Pro/4/3 Lens Cover', price: 1490, old_price: 1800, image: 'img/product/osmocap.png', badge: 'New', description: 'Soft Silicone Action Camera Lens Protective Case Cover for Dji Action 5Pro/4/3 ActionCam' },
  { slug: 'osmobag', name: 'All-purpose Set Storage Bag Dji Action', price: 5490, old_price: 6300, image: 'img/product/osmobag.png', badge: 'New', description: 'All-purpose Set Storage Bag Dji Action' },
];

const count = db.prepare('SELECT COUNT(*) AS c FROM products').get().c;
if (count === 0) {
  const insert = db.prepare(`INSERT INTO products (slug, name, description, price, old_price, image, badge, featured, flash_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  db.exec('BEGIN');
  try {
    for (const p of products) {
      const row = { featured: 0, flash_sale: 0, ...p };
      insert.run(row.slug, row.name, row.description, row.price, row.old_price, row.image, row.badge, row.featured, row.flash_sale);
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  console.log(`Seeded ${products.length} products`);
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

// Demo user (demo@pixels.com / demo1234) — admin role so the shop works out of the box
const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (userCount === 0) {
  const hash = bcrypt.hashSync('demo1234', 10);
  db.prepare(`INSERT INTO users (username, email, password_hash, full_name, phone, address, balance, role)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('demo', 'demo@pixels.com', hash, 'Demo User', '+92 300 0000000', '28/C Green Road', 99, 'admin');
  console.log('Seeded admin user (demo@pixels.com / demo1234)');
}

// Simple transaction helper (mimics better-sqlite3's db.transaction)
db.transaction = function (fn) {
  return function (...args) {
    db.exec('BEGIN');
    try {
      const result = fn(...args);
      db.exec('COMMIT');
      return result;
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  };
};

module.exports = db;
