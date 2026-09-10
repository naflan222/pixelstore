// REST API routes for the Pixels store
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./db');
const { createSession, destroySession, requireAuth } = require('./auth');
const { emailEnabled, describeConfig, sendOtpEmail, sendOrderConfirmationEmail } = require('./mailer');
const { createAdminNotification } = require('./admin-notifications');
const { sendInvoice, invoiceNumberFor, buildInvoiceModel, renderPdf } = require('./invoice');

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

/**
 * Email the customer their order confirmation with the invoice PDF attached.
 * Fire-and-forget: an SMTP hiccup must never delay the checkout response or
 * fail an order that was already placed. Guests are included — the email comes
 * from the address typed at checkout.
 */
function emailOrderConfirmation(orderId) {
  const task = (async () => {
    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    if (!order || !order.email) return;
    const items = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id').all(orderId);
    const model = buildInvoiceModel(order, items);
    let pdfBuffer = null;
    try {
      pdfBuffer = await renderPdf(model);
    } catch (e) {
      // PDF rendering failed (e.g. pdfkit missing) — send the message with the
      // invoice download link instead of skipping the email entirely.
      console.error(`[EMAIL] invoice PDF for order #${orderId} failed, sending link only:`, e.message);
    }
    await sendOrderConfirmationEmail(order.email, { order, model, pdfBuffer });
    console.log(`[EMAIL] order confirmation for order #${orderId} sent to ${order.email}`);
  })();
  task.catch((e) => console.error(`[EMAIL] order confirmation for order #${orderId} failed:`, e.message));
  return task;
}

const SHIPPING_FEES = { standard: 500, pickup: 0 };
const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

function cartItems(req) {
  const w = cartWhere(req);
  return db.prepare(`SELECT c.quantity, p.id, p.name, p.price, p.stock
    FROM carts c JOIN products p ON p.id = c.product_id WHERE ${w.sql}`).all(w.param);
}

function couponForCode(value) {
  const code = String(value || '').trim().toUpperCase();
  if (!COUPON_CODE.test(code)) return { code, coupon: null, error: 'Enter a valid coupon code.' };
  const coupon = db.prepare(`SELECT * FROM coupons WHERE code = ? AND is_active = 1
    AND (expires_at IS NULL OR expires_at = '' OR expires_at > datetime('now'))`).get(code);
  if (!coupon) return { code, coupon: null, error: 'This coupon is invalid, inactive, or expired.' };
  if (coupon.usage_limit !== null && coupon.usage_count >= coupon.usage_limit)
    return { code, coupon: null, error: 'This coupon has reached its usage limit.' };
  return { code, coupon };
}

function couponDiscount(coupon, subtotal) {
  if (subtotal < Number(coupon.minimum_order_amount || 0))
    return { error: `This coupon requires a minimum order of ${coupon.minimum_order_amount}.` };
  let amount = coupon.discount_type === 'percentage'
    ? subtotal * Number(coupon.discount_value) / 100
    : Number(coupon.discount_value);
  if (coupon.discount_type === 'percentage' && coupon.maximum_discount !== null)
    amount = Math.min(amount, Number(coupon.maximum_discount));
  return { amount: Math.max(0, Math.min(subtotal, Math.round(amount * 100) / 100)) };
}

/* ---------------- DIAGNOSTICS ---------------- */

// Public, secret-free mail config summary — lets you verify on the deployed
// service that the SMTP/API env vars arrived: GET /api/email/status
router.get('/email/status', (req, res) => {
  res.json({ ok: true, ...describeConfig() });
});

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
  createAdminNotification({ type: 'customer', title: 'New customer', body: 'A customer account was created.', entityType: 'user', entityId: info.lastInsertRowid });
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
  if (!user.is_active) return res.status(403).json({ error: 'This account has been disabled.' });

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

// Max reset-code requests per email within the code's 15-minute lifetime.
const FORGOT_MAX_REQUESTS = 3;
// Max verification attempts per code before it is locked out.
const RESET_MAX_ATTEMPTS = 5;

router.post('/auth/forgot-password', async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });

  // Housekeeping: drop codes that expired more than a day ago.
  db.prepare(`DELETE FROM password_resets WHERE expires_at < datetime('now', '-1 day')`).run();

  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  // Always succeed to avoid leaking which emails exist
  if (user) {
    const recent = db.prepare(`SELECT COUNT(*) AS c FROM password_resets
      WHERE email = ? AND created_at > datetime('now', '-15 minutes')`).get(email).c;
    if (recent >= FORGOT_MAX_REQUESTS)
      return res.status(429).json({ error: 'Too many reset requests. Please wait 15 minutes and try again.' });

    // A new code supersedes any previous unused ones for this email.
    db.prepare('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0').run(email);
    const code = String(crypto.randomInt(100000, 999999));
    db.prepare(`INSERT INTO password_resets (email, code, expires_at) VALUES (?, ?, datetime('now', '+15 minutes'))`)
      .run(email, code);
    if (emailEnabled() && process.env.FORCE_DEV_CODES !== '1') {
      try {
        await sendOtpEmail(email, code);
        return res.json({ ok: true, message: 'A 6-digit reset code has been sent to your email. Check your inbox (and spam folder).' });
      } catch (e) {
        console.error('[EMAIL ERROR]', e.message);
        return res.status(500).json({ error: 'Could not send the email. Please try again later.' });
      }
    }
    console.log(`[PASSWORD RESET] dev mode (no email sent) — code for ${email}: ${code}`);
    return res.json({ ok: true, message: 'Reset code generated (dev mode — no email sent, code shown here).', dev_code: code });
  }
  res.json({ ok: true, message: 'If that email exists, a reset code has been sent.' });
});

// Verify a reset code WITHOUT consuming it — lets the OTP page give
// instant feedback before the user types a new password.
router.post('/auth/verify-code', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
  const row = db.prepare(`SELECT id, attempts FROM password_resets
    WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1`).get(email, code);
  if (!row) return res.status(400).json({ error: 'Invalid or expired reset code. Please check the code in your email.' });
  if (Number(row.attempts || 0) >= RESET_MAX_ATTEMPTS)
    return res.status(429).json({ error: 'Too many attempts with this code. Please request a new one.' });
  db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

router.post('/auth/reset-password', (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  const password = String((req.body || {}).password || '');
  if (!email || !code || !password)
    return res.status(400).json({ error: 'Email, code and new password are required.' });
  if (password.length < 6)
    return res.status(400).json({ error: 'New password must be at least 6 characters.' });

  const row = db.prepare(`SELECT id, attempts FROM password_resets
    WHERE email = ? AND code = ? AND used = 0 AND expires_at > datetime('now')
    ORDER BY id DESC LIMIT 1`).get(email, code);
  if (!row) return res.status(400).json({ error: 'Invalid or expired reset code.' });
  if (Number(row.attempts || 0) >= RESET_MAX_ATTEMPTS)
    return res.status(429).json({ error: 'Too many attempts with this code. Please request a new one.' });

  db.prepare('UPDATE password_resets SET used = 1, attempts = attempts + 1 WHERE id = ?').run(row.id);
  db.prepare('UPDATE users SET password_hash = ? WHERE email = ?')
    .run(bcrypt.hashSync(password, 10), email);

  // Force a fresh login everywhere with the new password.
  const uid = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);

  notify(uid, 'Password changed', 'Your password was reset. If this was not you, contact support immediately.', 'security');
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
    WHERE r.product_id = ? AND r.is_visible = 1 ORDER BY r.id DESC`).all(product.id);
  res.json({ product, related, reviews });
});

/* ---------------- PROMOTIONS / COUPONS ---------------- */

router.get('/promotional-banners', (req, res) => {
  const banners = db.prepare(`SELECT id, image, title, description, button_text, button_url, display_order, starts_at, ends_at
    FROM promotional_banners WHERE is_active = 1
    AND (starts_at IS NULL OR starts_at = '' OR starts_at <= datetime('now'))
    AND (ends_at IS NULL OR ends_at = '' OR ends_at > datetime('now'))
    ORDER BY display_order ASC, id ASC`).all();
  res.json({ banners });
});

router.post('/coupons/validate', (req, res) => {
  const items = cartItems(req);
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const { code, coupon, error } = couponForCode(req.body && req.body.code);
  if (error) return res.status(400).json({ error });
  const result = couponDiscount(coupon, subtotal);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ valid: true, code, discount_amount: result.amount, subtotal, total: subtotal - result.amount });
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

router.post('/orders', (req, res) => {
  const { full_name, email, phone, address, shipping_method = 'standard', payment_method = 'cash', coupon_code } = req.body || {};
  if (!full_name || !email || !phone || !address)
    return res.status(400).json({ error: 'Full name, email, phone and address are required.' });
  if (!String(full_name).trim() || String(full_name).length > 120 || String(email).length > 254 ||
      !String(phone).trim() || String(phone).length > 50 || !String(address).trim() || String(address).length > 1000)
    return res.status(400).json({ error: 'Phone number and shipping address are required.' });
  if (!Object.prototype.hasOwnProperty.call(SHIPPING_FEES, shipping_method))
    return res.status(400).json({ error: 'Invalid shipping method.' });
  if (!['cash', 'credit-card', 'bank', 'paypal'].includes(String(payment_method)))
    return res.status(400).json({ error: 'Invalid payment method.' });

  const w = cartWhere(req);
  const items = cartItems(req);
  if (items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  for (const i of items) {
    if (i.stock < i.quantity)
      return res.status(400).json({ error: `Not enough stock for ${i.name}.` });
  }

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingFee = SHIPPING_FEES[shipping_method];

  const placeOrder = db.transaction(() => {
    // Resolve and consume the coupon in the same transaction as stock and order creation.
    let coupon = null;
    let discountAmount = 0;
    let code = '';
    if (coupon_code !== undefined && String(coupon_code).trim()) {
      const resolved = couponForCode(coupon_code);
      if (resolved.error) throw new Error(resolved.error);
      const discount = couponDiscount(resolved.coupon, subtotal);
      if (discount.error) throw new Error(discount.error);
      coupon = resolved.coupon;
      discountAmount = discount.amount;
      code = resolved.code;
      const used = db.prepare(`UPDATE coupons SET usage_count = usage_count + 1, updated_at = datetime('now')
        WHERE id = ? AND is_active = 1 AND (usage_limit IS NULL OR usage_count < usage_limit)`).run(coupon.id);
      if (used.changes !== 1) throw new Error('This coupon has reached its usage limit.');
    }
    const total = subtotal - discountAmount + shippingFee;
    const info = db.prepare(`INSERT INTO orders
      (user_id, guest_id, full_name, email, phone, address, shipping_method, payment_method, subtotal, shipping_fee, discount_amount, coupon_code, total)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(req.user ? req.user.id : null, req.user ? null : req.guestId,
           String(full_name).trim(), String(email).trim().toLowerCase(), String(phone).trim(), String(address).trim(), shipping_method, payment_method,
           subtotal, shippingFee, discountAmount, code, total);
    const orderId = info.lastInsertRowid;
    db.prepare(`INSERT INTO payments (order_id, payment_method, payment_status, amount_paid)
      VALUES (?, ?, 'pending', 0)`).run(orderId, payment_method);
    const insertItem = db.prepare('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)');
    const decStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const i of items) {
      insertItem.run(orderId, i.id, i.name, i.price, i.quantity);
      decStock.run(i.quantity, i.id);
    }
    db.prepare(`DELETE FROM carts WHERE ${w.sql}`).run(w.param);
    if (req.user) notify(req.user.id, `Order #${orderId} placed`, `Total Rs. ${total.toLocaleString()} via ${payment_method}.`, 'order');
    createAdminNotification({ type: 'order', title: `New order #${orderId}`, body: 'A new order has been placed.', entityType: 'order', entityId: orderId });
    return { orderId, total, discountAmount };
  });

  try {
    const order = placeOrder();
    // Hand the customer the invoice number and download link up front, so the
    // confirmation page can reference the exact document it auto-downloads.
    const placed = db.prepare('SELECT created_at FROM orders WHERE id = ?').get(order.orderId);
    const invoice = invoiceNumberFor(order.orderId, placed?.created_at);
    res.json({
      ok: true,
      order_id: order.orderId,
      total: order.total,
      discount_amount: order.discountAmount,
      invoice_number: invoice.number,
      invoice_file: `PixelHouse-Invoice-${invoice.fileKey}.pdf`,
      invoice_url: `/api/orders/${order.orderId}/invoice`,
      redirect: 'payment-success.html',
    });
    // Confirmation email with the invoice attached — after the response, never blocking it.
    if (emailEnabled()) emailOrderConfirmation(order.orderId);
  } catch (error) {
    res.status(400).json({ error: error.message || 'Could not place order.' });
  }
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

router.get('/orders/:id/invoice', (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(orderId) || orderId < 1)
    return res.status(400).json({ error: 'Invalid order ID.' });

  const order = req.user
    ? db.prepare('SELECT * FROM orders WHERE id = ? AND user_id = ?').get(orderId, req.user.id)
    : db.prepare('SELECT * FROM orders WHERE id = ? AND guest_id = ?').get(orderId, req.guestId);
  if (!order) return res.status(404).json({ error: 'Invoice not found.' });

  // The product join only feeds the printed item code, so the invoice still works
  // for orders whose product has since been removed from the catalog.
  const items = db.prepare(`SELECT oi.name, oi.price, oi.quantity, p.sku
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? ORDER BY oi.id`).all(order.id);
  sendInvoice(res, order, items);
});

/* ---------------- VENDOR / CONTACT / NOTIFICATIONS / REVIEWS ---------------- */

router.post('/vendor/apply', requireAuth, (req, res) => {
  const { account_type, store_name, location, mobile } = req.body || {};
  if (!account_type || !store_name || !location || !mobile)
    return res.status(400).json({ error: 'Account type, store name, location and mobile are required.' });
  const application = db.prepare('INSERT INTO vendor_applications (user_id, account_type, store_name, location, mobile) VALUES (?, ?, ?, ?, ?)')
    .run(req.user.id, account_type, store_name, location, mobile);
  notify(req.user.id, 'Vendor application received', `Your application for "${store_name}" is under review.`, 'vendor');
  createAdminNotification({ type: 'vendor', title: 'New vendor application', body: 'A vendor application needs review.', entityType: 'vendor_application', entityId: application.lastInsertRowid });
  res.json({ ok: true });
});

router.post('/contact', (req, res) => {
  const { name, email, subject = '', message } = req.body || {};
  if (!name || !email || !message)
    return res.status(400).json({ error: 'Name, email and message are required.' });
  const contact = db.prepare('INSERT INTO contact_messages (user_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)')
    .run(req.user ? req.user.id : null, name, email, subject, message);
  createAdminNotification({ type: 'contact', title: 'New contact message', body: 'A customer has sent a contact message.', entityType: 'contact_message', entityId: contact.lastInsertRowid });
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
  const ratingNum = Number(rating);
  const reviewComment = String(comment).trim();
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  if (reviewComment.length > 200)
    return res.status(400).json({ error: 'Reviews must be 200 characters or fewer.' });
  const product = db.prepare('SELECT id FROM products WHERE slug = ?').get(req.params.slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const review = db.prepare('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)')
    .run(req.user.id, product.id, ratingNum, reviewComment);
  const agg = db.prepare('SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE product_id = ? AND is_visible = 1').get(product.id);
  db.prepare('UPDATE products SET rating = ?, rating_count = ? WHERE id = ?')
    .run(Math.round(agg.avg * 10) / 10, agg.c, product.id);
  createAdminNotification({ type: 'review', title: 'New product review', body: 'A customer submitted a product review.', entityType: 'review', entityId: review.lastInsertRowid });
  res.json({ ok: true });
});

module.exports = router;
