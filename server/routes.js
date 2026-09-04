// REST API routes for the Pixels store
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const { createSession, destroySession, requireAuth } = require('./auth');
const { emailEnabled, sendOtpEmail } = require('./mailer');

const router = express.Router();

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 };

// Merge a guest's cart/wishlist into their account when they register or log in
function mergeGuestData(req, userId) {
  if (!req.guestId) return;
  const guestCart = db.prepare('SELECT product_id, quantity FROM carts WHERE guest_id = ?').all(req.guestId);
  for (const item of guestCart) {
    const existing = db.prepare('SELECT id FROM carts WHERE user_id = ? AND product_id = ?').get(userId, item.product_id);
    if (existing) db.prepare('UPDATE carts SET quantity = quantity + ? WHERE id = ?').run(item.quantity, existing.id);
    else db.prepare('INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)').run(userId, item.product_id, item.quantity);
  }
  db.prepare('DELETE FROM carts WHERE guest_id = ?').run(req.guestId);
  const guestWish = db.prepare('SELECT product_id FROM wishlists WHERE guest_id = ?').all(req.guestId);
  for (const item of guestWish) {
    const existing = db.prepare('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?').get(userId, item.product_id);
    if (!existing) db.prepare('INSERT INTO wishlists (user_id, product_id) VALUES (?, ?)').run(userId, item.product_id);
  }
  db.prepare('DELETE FROM wishlists WHERE guest_id = ?').run(req.guestId);
  db.prepare('UPDATE orders SET user_id = ?, guest_id = NULL WHERE guest_id = ?').run(userId, req.guestId);
}

function notify(userId, title, body, type = 'info') {
  db.prepare('INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)')
    .run(userId, title, body, type);
}

/* ---------------- AUTH ---------------- */

router.post('/auth/register', (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Username, email and password are required.' });
  if (String(password).length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?')
    .get(username, email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Username or email already registered.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (username, email, password_hash, full_name) VALUES (?, ?, ?, ?)')
    .run(username, email.toLowerCase(), hash, username);

  notify(info.lastInsertRowid, 'Welcome to PixelHouse!', 'Your account was created successfully.', 'welcome');
  mergeGuestData(req, info.lastInsertRowid);
  // Don't auto-login: user should see the success message and log in manually
  res.json({ ok: true, redirect: 'login.html' });
});

router.post('/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?')
    .get(username, username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password.' });

  mergeGuestData(req, user.id);
  const token = createSession(user.id);
  res.cookie('pixels_session', token, COOKIE_OPTS);
  res.json({ ok: true, redirect: 'home.html' });
});

router.post('/auth/logout', (req, res) => {
  destroySession(req.cookies && req.cookies.pixels_session);
  res.clearCookie('pixels_session');
  res.json({ ok: true, redirect: 'home.html' });
});

router.get('/auth/me', (req, res) => {
  const cw = req.user
    ? { sql: 'user_id = ?', param: req.user.id }
    : { sql: 'guest_id = ?', param: req.guestId };
  const cartCount = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS c FROM carts WHERE ${cw.sql}`).get(cw.param).c;
  if (!req.user) return res.status(401).json({ error: 'Not authenticated', cart_count: cartCount });
  const notifCount = db.prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0').get(req.user.id).c;
  res.json({ user: req.user, unread_notifications: notifCount, cart_count: cartCount });
});

router.post('/auth/forgot-password', async (req, res) => {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email is required.' });
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  // Always succeed to avoid leaking which emails exist
  if (user) {
    const code = String(crypto.randomInt(100000, 999999));
    db.prepare(`INSERT INTO password_resets (email, code, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))`)
      .run(email.toLowerCase(), code);
    if (emailEnabled()) {
      try {
        await sendOtpEmail(email.toLowerCase(), code);
        return res.json({ ok: true, message: 'A 6-digit reset code has been sent to your email.' });
      } catch (e) {
        console.error('[EMAIL ERROR]', e.message);
        return res.status(500).json({ error: 'Could not send the email. Please try again later.' });
      }
    }
    console.log(`[PASSWORD RESET] code for ${email}: ${code}`); // Dev fallback when SMTP not configured
    return res.json({ ok: true, message: 'Reset code generated (check server console in dev mode).', dev_code: code });
  }
  res.json({ ok: true, message: 'If that email exists, a reset code has been sent.' });
});

router.post('/auth/reset-password', (req, res) => {
  const { email, code, password } = req.body || {};
  if (!email || !code || !password)
    return res.status(400).json({ error: 'Email, code and new password are required.' });
  const row = db.prepare(`SELECT id FROM password_resets
    WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1`).get(email.toLowerCase(), code);
  if (!row) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
    .run(bcrypt.hashSync(password, 10), email.toLowerCase());
  res.json({ ok: true, redirect: 'forget-password-success.html' });
});

router.post('/auth/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Current and new password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

/* ---------------- PROFILE ---------------- */

router.put('/profile', requireAuth, (req, res) => {
  const { username, phone, email, address } = req.body || {};
  const emailVal = email ? email.toLowerCase() : req.user.email;
  const clash = db.prepare('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?')
    .get(username || req.user.username, emailVal, req.user.id);
  if (clash) return res.status(409).json({ error: 'Username or email already in use.' });
  db.prepare('UPDATE users SET username = ?, phone = ?, email = ?, address = ? WHERE id = ?')
    .run(username || req.user.username, phone || '', emailVal, address || '', req.user.id);
  res.json({ ok: true });
});

/* ---------------- PRODUCTS ---------------- */

router.get('/products', (req, res) => {
  const { category, featured, flash_sale, q } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (category) { sql += ' AND category = ?'; params.push(category); }
  if (featured === '1') sql += ' AND featured = 1';
  if (flash_sale === '1') sql += ' AND flash_sale = 1';
  if (q) { sql += ' AND name LIKE ?'; params.push(`%${q}%`); }
  sql += ' ORDER BY id';
  res.json({ products: db.prepare(sql).all(...params) });
});

router.get('/products/:slug', (req, res) => {
  const product = db.prepare('SELECT * FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const related = db.prepare('SELECT * FROM products WHERE slug != ? ORDER BY RANDOM() LIMIT 4').all(req.params.slug);
  const reviews = db.prepare(`
    SELECT r.rating, r.comment, r.created_at, u.username
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? ORDER BY r.id DESC`).all(product.id);
  res.json({ product, related, reviews });
});

/* ---------------- CART (works for guests AND logged-in users) ---------------- */

// Alias-free WHERE fragments — usable in any carts query (with or without JOIN)
function cartWhere(req) {
  return req.user
    ? { sql: 'user_id = ?', param: req.user.id }
    : { sql: 'guest_id = ?', param: req.guestId };
}

router.get('/cart', (req, res) => {
  const w = cartWhere(req);
  const items = db.prepare(`
    SELECT c.id AS cart_id, c.quantity, p.id, p.slug, p.name, p.price, p.old_price, p.image
    FROM carts c JOIN products p ON p.id = c.product_id
    WHERE ${w.sql}`).all(w.param);
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  res.json({ items, subtotal });
});

router.post('/cart', (req, res) => {
  const { product_id, quantity = 1 } = req.body || {};
  const product = db.prepare('SELECT id, stock FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock <= 0) return res.status(400).json({ error: 'This product is out of stock.' });
  const qty = Math.max(1, parseInt(quantity) || 1);
  const w = cartWhere(req);
  const existing = db.prepare(`SELECT id, quantity FROM carts WHERE ${w.sql} AND product_id = ?`).get(w.param, product_id);
  if (existing) {
    db.prepare('UPDATE carts SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare('INSERT INTO carts (user_id, guest_id, product_id, quantity) VALUES (?, ?, ?, ?)')
      .run(req.user ? req.user.id : null, req.user ? null : req.guestId, product_id, qty);
  }
  res.json({ ok: true });
});

function ownsCartItem(req, id) {
  const w = cartWhere(req);
  return db.prepare(`SELECT id FROM carts WHERE id = ? AND ${w.sql}`).get(id, w.param);
}

router.put('/cart/:id', (req, res) => {
  if (!ownsCartItem(req, req.params.id)) return res.status(404).json({ error: 'Cart item not found' });
  const qty = Math.max(1, parseInt(req.body && req.body.quantity) || 1);
  db.prepare('UPDATE carts SET quantity = ? WHERE id = ?').run(qty, req.params.id);
  res.json({ ok: true });
});

router.delete('/cart/:id', (req, res) => {
  if (!ownsCartItem(req, req.params.id)) return res.status(404).json({ error: 'Cart item not found' });
  db.prepare('DELETE FROM carts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Add to cart by product slug (used by static "+" buttons on home/listing pages)
router.post('/cart/by-slug', (req, res) => {
  const { slug, quantity = 1 } = req.body || {};
  if (!slug) return res.status(400).json({ error: 'Product slug is required.' });
  const product = db.prepare('SELECT id, stock FROM products WHERE slug = ?').get(slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock <= 0) return res.status(400).json({ error: 'This product is out of stock.' });
  const qty = Math.max(1, parseInt(quantity) || 1);
  const w = cartWhere(req);
  const existing = db.prepare(`SELECT id, quantity FROM carts WHERE ${w.sql} AND product_id = ?`).get(w.param, product.id);
  if (existing) {
    db.prepare('UPDATE carts SET quantity = quantity + ? WHERE id = ?').run(qty, existing.id);
  } else {
    db.prepare('INSERT INTO carts (user_id, guest_id, product_id, quantity) VALUES (?, ?, ?, ?)')
      .run(req.user ? req.user.id : null, req.user ? null : req.guestId, product.id, qty);
  }
  res.json({ ok: true });
});

/* ---------------- WISHLIST (guests too) ---------------- */

function wishWhere(req) {
  return req.user
    ? { sql: 'user_id = ?', param: req.user.id }
    : { sql: 'guest_id = ?', param: req.guestId };
}

router.get('/wishlist', (req, res) => {
  const w = wishWhere(req);
  const items = db.prepare(`
    SELECT w.id AS wishlist_id, p.id, p.slug, p.name, p.price, p.old_price, p.image, p.badge
    FROM wishlists w JOIN products p ON p.id = w.product_id
    WHERE ${w.sql}`).all(w.param);
  res.json({ items });
});

router.post('/wishlist', (req, res) => {
  const { product_id } = req.body || {};
  const product = db.prepare('SELECT id FROM products WHERE id = ?').get(product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const w = wishWhere(req);
  const existing = db.prepare(`SELECT id FROM wishlists WHERE ${w.sql} AND product_id = ?`).get(w.param, product_id);
  if (existing) {
    db.prepare('DELETE FROM wishlists WHERE id = ?').run(existing.id);
    return res.json({ ok: true, added: false });
  }
  db.prepare('INSERT INTO wishlists (user_id, guest_id, product_id) VALUES (?, ?, ?)')
    .run(req.user ? req.user.id : null, req.user ? null : req.guestId, product_id);
  res.json({ ok: true, added: true });
});

router.delete('/wishlist/:id', (req, res) => {
  const w = wishWhere(req);
  db.prepare(`DELETE FROM wishlists WHERE id = ? AND ${w.sql}`).run(req.params.id, w.param);
  res.json({ ok: true });
});

/* ---------------- ORDERS / CHECKOUT ---------------- */

const SHIPPING_FEES = { standard: 250, express: 500, pickup: 0 };

router.post('/orders', (req, res) => {
  const { full_name, email, phone, address, shipping_method = 'standard', payment_method = 'cash', coupon_code = '' } = req.body || {};
  if (!full_name || !email || !phone || !address)
    return res.status(400).json({ error: 'Full name, email, phone and address are required.' });
  if (!String(phone).trim() || !String(address).trim())
    return res.status(400).json({ error: 'Phone number and shipping address are required.' });

  const w = cartWhere(req);
  const items = db.prepare(`
    SELECT c.quantity, p.id, p.name, p.price, p.stock
    FROM carts c JOIN products p ON p.id = c.product_id
    WHERE ${w.sql}`).all(w.param);
  if (items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  for (const i of items) {
    if (i.stock < i.quantity)
      return res.status(400).json({ error: `Not enough stock for ${i.name}.` });
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingFee = SHIPPING_FEES[shipping_method] ?? SHIPPING_FEES.standard;
  const discount = String(coupon_code).trim().toUpperCase() === 'GET20' ? subtotal * 0.2 : 0;
  const total = subtotal - discount + shippingFee;

  const placeOrder = db.transaction(() => {
    const info = db.prepare(`INSERT INTO orders
      (user_id, guest_id, full_name, email, phone, address, shipping_method, payment_method, subtotal, shipping_fee, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user ? req.user.id : null, req.user ? null : req.guestId,
           full_name, email, phone, address, shipping_method, payment_method, subtotal, shippingFee, total);
    const orderId = info.lastInsertRowid;
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const i of items) {
      insertItem.run(orderId, i.id, i.name, i.price, i.quantity);
      decStock.run(i.quantity, i.id);
    }
    db.prepare(`DELETE FROM carts WHERE ${w.sql}`).run(w.param);
    if (req.user) notify(req.user.id, `Order #${orderId} placed`, `Total Rs. ${total.toLocaleString()} via ${payment_method}.`, 'order');
    return orderId;
  });

  const orderId = placeOrder();
  res.json({ ok: true, order_id: orderId, total, redirect: 'payment-success.html' });
});

router.get('/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC').all(req.user.id);
  const itemStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');
  res.json({ orders: orders.map(o => ({ ...o, items: itemStmt.all(o.id) })) });
});

router.get('/orders/:id', requireAuth, (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ order, items });
});

/* ---------------- VENDOR / CONTACT / NOTIFICATIONS / REVIEWS ---------------- */

router.post('/vendor/apply', requireAuth, (req, res) => {
  const { account_type, store_name, location, mobile } = req.body || {};
  if (!account_type || !store_name || !location || !mobile)
    return res.status(400).json({ error: 'Account type, store name, location and mobile are required.' });
  db.prepare('INSERT INTO vendor_applications (user_id, account_type, store_name, location, mobile) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, account_type, store_name, location, mobile);
  notify(req.user.id, 'Vendor application received', `Your application for "${store_name}" is under review.`, 'vendor');
  res.json({ ok: true });
});

router.post('/contact', (req, res) => {
  const { name, email, subject = '', message } = req.body || {};
  if (!name || !email || !message)
    return res.status(400).json({ error: 'Name, email and message are required.' });
  db.prepare('INSERT INTO contact_messages (user_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)')
    .run(req.user ? req.user.id : null, name, email, subject, message);
  res.json({ ok: true });
});

router.get('/notifications', requireAuth, (req, res) => {
  const items = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50').all(req.user.id);
  res.json({ notifications: items });
});

router.post('/notifications/read', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

router.post('/products/:slug/reviews', requireAuth, (req, res) => {
  const { rating, comment = '' } = req.body || {};
  const ratingNum = Math.min(5, Math.max(1, parseInt(rating) || 0));
  if (!ratingNum) return res.status(400).json({ error: 'Rating (1-5) is required.' });
  const product = db.prepare('SELECT id FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  db.prepare('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(req.user.id, product.id, ratingNum, comment);
  const agg = db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE product_id = ?').get(product.id);
  db.prepare('UPDATE products SET rating = ?, rating_count = ? WHERE id = ?')
    .run(Math.round(agg.avg * 10) / 10, agg.c, product.id);
  res.json({ ok: true });
});

module.exports = router;
