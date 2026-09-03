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
  total       REAL NOT NULL,
  status      TEXT DEFAULT 'pending',
  created_at  TEXT DEFAULT (datetime('now'))
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

CREATE TABLE IF NOT EXISTS password_resets (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  email   TEXT NOT NULL,
  code    TEXT NOT NULL,
  used    INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reviews (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  rating     INTEGER NOT NULL,
  comment    TEXT DEFAULT '',
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

  db.exec('PRAGMA legacy_alter_table = OFF');
  db.exec('PRAGMA foreign_keys = ON');
})();

// Ensure the demo user has admin role (for databases created before admin panel)
const demoUser = db.prepare("SELECT id FROM users WHERE email = 'demo@pixels.com'").get();
if (demoUser) {
  db.prepare("UPDATE users SET role = 'admin' WHERE id = ? AND role = 'customer'").run(demoUser.id);
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
