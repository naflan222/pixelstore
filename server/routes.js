// REST API routes for the Pixels store
const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('./database');
const { createSession, destroySession, requireAuth } = require('./auth');
const { emailEnabled, describeConfig, sendOtpEmail, sendOrderConfirmationEmail } = require('./mailer');
const { createAdminNotification } = require('./admin-notifications');
const { sendInvoice, invoiceNumberFor, buildInvoiceModel, renderPdf } = require('./invoice');
const { rateLimit } = require('./security');

const router = express.Router();

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 30 * 24 * 3600 * 1000,
  };
}

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30 });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 15 });
const contactLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 10 });

// Merge a guest's cart/wishlist into their account when they register or log in
async function mergeGuestData(req, userId) {
  if (!req.guestId) return;
  const guestCart = await db.all('SELECT product_id, quantity FROM carts WHERE guest_id = ?', req.guestId);
  for (const item of guestCart) {
    const existing = await db.get('SELECT id FROM carts WHERE user_id = ? AND product_id = ?', userId, item.product_id);
    if (existing) await db.run('UPDATE carts SET quantity = quantity + ? WHERE id = ?', item.quantity, existing.id);
    else await db.run('INSERT INTO carts (user_id, product_id, quantity) VALUES (?, ?, ?)', userId, item.product_id, item.quantity);
  }
  await db.run('DELETE FROM carts WHERE guest_id = ?', req.guestId);
  const guestWish = await db.all('SELECT product_id FROM wishlists WHERE guest_id = ?', req.guestId);
  for (const item of guestWish) {
    const existing = await db.get('SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?', userId, item.product_id);
    if (!existing) await db.run('INSERT INTO wishlists (user_id, product_id) VALUES (?, ?)', userId, item.product_id);
  }
  await db.run('DELETE FROM wishlists WHERE guest_id = ?', req.guestId);
  await db.run('UPDATE orders SET user_id = ?, guest_id = NULL WHERE guest_id = ?', userId, req.guestId);
}

async function notify(userId, title, body, type = 'info', tx = db) {
  await tx.run('INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)',
    userId, title, body, type);
}

/**
 * Email the customer their order confirmation with the invoice PDF attached.
 * Fire-and-forget: an SMTP hiccup must never delay the checkout response or
 * fail an order that was already placed. Guests are included — the email comes
 * from the address typed at checkout.
 */
function emailOrderConfirmation(orderId) {
  const task = (async () => {
    const order = await db.get('SELECT * FROM orders WHERE id = ?', orderId);
    if (!order || !order.email) return;
    const items = await db.all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId);
    const model = await buildInvoiceModel(order, items);
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
const IMPLEMENTED_PAYMENT_METHODS = new Set(['cash', 'bank']);
const COUPON_CODE = /^[A-Z0-9][A-Z0-9_-]{1,31}$/;

async function enabledPaymentMethods(tx = db) {
  const settings = await tx.get('SELECT payment_methods FROM store_settings WHERE id = 1');
  if (!settings) return new Set();
  try {
    const configured = JSON.parse(settings.payment_methods);
    if (!Array.isArray(configured)) return new Set();
    return new Set(configured.filter((method) => IMPLEMENTED_PAYMENT_METHODS.has(method)));
  } catch (_) {
    return new Set();
  }
}

async function cartItems(req, tx = db) {
  const w = cartWhere(req);
  return tx.all(`SELECT c.quantity, p.id, p.name, p.price, p.stock
    FROM carts c JOIN products p ON p.id = c.product_id WHERE ${w.sql}`, w.param);
}

async function couponForCode(value, tx = db) {
  const code = String(value || '').trim().toUpperCase();
  if (!COUPON_CODE.test(code)) return { code, coupon: null, error: 'Enter a valid coupon code.' };
  const coupon = await tx.get(`SELECT * FROM coupons WHERE lower(code) = lower(?) AND is_active = 1
    AND (expires_at IS NULL OR expires_at > ?)`, code, db.utcNow());
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
  const config = describeConfig();
  res.json({ ok: true, email_enabled: config.email_enabled, transport: config.transport });
});

/* ---------------- AUTH ---------------- */

router.post('/auth/register', authLimiter, async (req, res) => {
  const { username, email, password } = req.body || {};
  if (!username || !email || !password)
    return res.status(400).json({ error: 'Username, email and password are required.' });
  if (String(password).length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const exists = await db.get('SELECT id FROM users WHERE username = ? OR email = ?',
    username, email.toLowerCase());
  if (exists) return res.status(409).json({ error: 'Username or email already registered.' });

  const hash = bcrypt.hashSync(password, 10);
  const info = await db.insert('INSERT INTO users (username, email, password_hash, full_name) VALUES (?, ?, ?, ?)',
    username, email.toLowerCase(), hash, username);

  await notify(info.id, 'Welcome to PixelHouse!', 'Your account was created successfully.', 'welcome');
  await createAdminNotification({ type: 'customer', title: 'New customer', body: 'A customer account was created.', entityType: 'user', entityId: info.id });
  await mergeGuestData(req, info.id);
  // Don't auto-login: user should see the success message and log in manually
  res.json({ ok: true, redirect: 'login.html' });
});

router.post('/auth/login', authLimiter, async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password are required.' });

  const user = await db.get('SELECT * FROM users WHERE username = ? OR email = ?',
    username, username.toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid username or password.' });
  if (!user.is_active) return res.status(403).json({ error: 'This account has been disabled.' });

  await mergeGuestData(req, user.id);
  const token = await createSession(user.id);
  res.cookie('pixels_session', token, sessionCookieOptions());
  res.json({ ok: true, redirect: 'home.html' });
});

router.post('/auth/logout', async (req, res) => {
  await destroySession(req.cookies && req.cookies.pixels_session);
  res.clearCookie('pixels_session', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
  res.json({ ok: true, redirect: 'home.html' });
});

router.get('/auth/me', async (req, res) => {
  const cw = req.user
    ? { sql: 'user_id = ?', param: req.user.id }
    : { sql: 'guest_id = ?', param: req.guestId };
  const cartCount = (await db.get(`SELECT COALESCE(SUM(quantity),0) AS c FROM carts WHERE ${cw.sql}`, cw.param)).c;
  if (!req.user) return res.status(401).json({ error: 'Not authenticated', cart_count: cartCount });
  const notifCount = (await db.get('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0', req.user.id)).c;
  res.json({ user: req.user, unread_notifications: notifCount, cart_count: cartCount });
});

// Max reset-code requests per email within the code's 15-minute lifetime.
const FORGOT_MAX_REQUESTS = 3;
// Max verification attempts per code before it is locked out.
const RESET_MAX_ATTEMPTS = 5;
const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;
const ONE_DAY_MS = 24 * 3600 * 1000;

router.post('/auth/forgot-password', resetLimiter, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Please enter a valid email address.' });

  // Housekeeping: drop codes that expired more than a day ago.
  await db.run('DELETE FROM password_resets WHERE expires_at < ?', db.utcNow(-ONE_DAY_MS));

  const user = await db.get('SELECT id FROM users WHERE email = ?', email);
  // Always succeed to avoid leaking which emails exist
  if (user) {
    const recent = (await db.get(`SELECT COUNT(*) AS c FROM password_resets
      WHERE email = ? AND created_at > ?`, email, db.utcNow(-FIFTEEN_MINUTES_MS))).c;
    if (recent >= FORGOT_MAX_REQUESTS)
      return res.status(429).json({ error: 'Too many reset requests. Please wait 15 minutes and try again.' });

    // A new code supersedes any previous unused ones for this email.
    await db.run('UPDATE password_resets SET used = 1 WHERE email = ? AND used = 0', email);
    const code = String(crypto.randomInt(100000, 999999));
    await db.run('INSERT INTO password_resets (email, code, expires_at) VALUES (?, ?, ?)',
      email, code, db.utcNow(FIFTEEN_MINUTES_MS));
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

async function latestActiveReset(email) {
  return db.get(`SELECT id, code, attempts FROM password_resets
    WHERE email = ? AND used = 0 AND expires_at > ?
    ORDER BY id DESC LIMIT 1`, email, db.utcNow());
}

function resetCodeMatches(expected, supplied) {
  const expectedBuffer = Buffer.from(String(expected || ''));
  const suppliedBuffer = Buffer.from(String(supplied || ''));
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

async function rejectBadResetCode(row, res, message) {
  if (!row) return res.status(400).json({ error: message });
  const attempts = Number(row.attempts || 0) + 1;
  await db.run('UPDATE password_resets SET attempts = ?, used = ? WHERE id = ?',
    attempts, attempts >= RESET_MAX_ATTEMPTS ? 1 : 0, row.id);
  if (attempts >= RESET_MAX_ATTEMPTS)
    return res.status(429).json({ error: 'Too many attempts with this code. Please request a new one.' });
  return res.status(400).json({ error: message });
}

// Verify a reset code WITHOUT consuming it — lets the OTP page give
// instant feedback before the user types a new password.
router.post('/auth/verify-code', resetLimiter, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  if (!email || !code) return res.status(400).json({ error: 'Email and code are required.' });
  const row = await latestActiveReset(email);
  if (!row || !resetCodeMatches(row.code, code))
    return rejectBadResetCode(row, res, 'Invalid or expired reset code. Please check the code in your email.');
  if (Number(row.attempts || 0) >= RESET_MAX_ATTEMPTS)
    return res.status(429).json({ error: 'Too many attempts with this code. Please request a new one.' });
  res.json({ ok: true });
});

router.post('/auth/reset-password', resetLimiter, async (req, res) => {
  const email = String((req.body || {}).email || '').trim().toLowerCase();
  const code = String((req.body || {}).code || '').trim();
  const password = String((req.body || {}).password || '');
  if (!email || !code || !password)
    return res.status(400).json({ error: 'Email, code and new password are required.' });
  if (password.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });

  const row = await latestActiveReset(email);
  if (!row || !resetCodeMatches(row.code, code))
    return rejectBadResetCode(row, res, 'Invalid or expired reset code.');
  if (Number(row.attempts || 0) >= RESET_MAX_ATTEMPTS)
    return res.status(429).json({ error: 'Too many attempts with this code. Please request a new one.' });

  await db.run('UPDATE password_resets SET used = 1, attempts = attempts + 1 WHERE id = ?', row.id);
  await db.run('UPDATE users SET password_hash = ? WHERE email = ?',
    bcrypt.hashSync(password, 10), email);

  // Force a fresh login everywhere with the new password.
  const uid = (await db.get('SELECT id FROM users WHERE email = ?', email)).id;
  await db.run('DELETE FROM sessions WHERE user_id = ?', uid);

  await notify(uid, 'Password changed', 'Your password was reset. If this was not you, contact support immediately.', 'security');
  res.json({ ok: true, redirect: 'forget-password-success.html' });
});

router.post('/auth/change-password', requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password)
    return res.status(400).json({ error: 'Current and new password are required.' });
  if (String(new_password).length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  const user = await db.get('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!bcrypt.compareSync(current_password, user.password_hash))
    return res.status(401).json({ error: 'Current password is incorrect.' });
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?',
    bcrypt.hashSync(new_password, 10), req.user.id);
  res.json({ ok: true });
});

/* ---------------- PROFILE ---------------- */

router.put('/profile', requireAuth, async (req, res) => {
  const { username, phone, email, address } = req.body || {};
  const emailVal = email ? email.toLowerCase() : req.user.email;
  const clash = await db.get('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?',
    username || req.user.username, emailVal, req.user.id);
  if (clash) return res.status(409).json({ error: 'Username or email already in use.' });
  await db.run('UPDATE users SET username = ?, phone = ?, email = ?, address = ? WHERE id = ?',
    username || req.user.username, phone || '', emailVal, address || '', req.user.id);
  res.json({ ok: true });
});

/* ---------------- PRODUCTS ---------------- */

const HOME_PRODUCT_SECTIONS = ['featured_gear', 'top_products', 'weekly_best_sellers', 'featured_products'];

router.get('/homepage-sections', async (_req, res) => {
  const rows = await db.all(`SELECT h.section_key, p.*
    FROM homepage_section_products h
    JOIN products p ON p.id = h.product_id
    WHERE p.status = 'active'
    ORDER BY h.section_key, h.sort_order, p.name`);
  const sections = Object.fromEntries(HOME_PRODUCT_SECTIONS.map((key) => [key, []]));
  rows.forEach((row) => { if (sections[row.section_key]) sections[row.section_key].push(row); });
  res.json({ sections });
});

router.get('/reviews/recent', async (_req, res) => {
  const reviews = await db.all(`SELECT r.rating, r.comment, r.created_at, u.username, p.name AS product_name
    FROM reviews r
    JOIN users u ON u.id = r.user_id
    JOIN products p ON p.id = r.product_id
    WHERE r.is_visible = 1 AND p.status = 'active' AND TRIM(COALESCE(r.comment, '')) <> ''
    ORDER BY r.created_at DESC, r.id DESC LIMIT 6`);
  res.json({ reviews });
});

router.get('/products', async (req, res) => {
  const { category, category_id, featured, flash_sale, q } = req.query;
  let where = ` WHERE p.status = 'active'`;
  const params = [];
  if (category_id) {
    const id = Number(category_id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: 'Invalid category.' });
    where += ' AND p.category_id = ?'; params.push(id);
  } else if (category) {
    const value = String(category).trim();
    where += ' AND (lower(c.name) = lower(?) OR lower(c.slug) = lower(?) OR lower(p.category) = lower(?))';
    params.push(value, value, value);
  }
  if (featured === '1') where += ' AND p.featured = 1';
  if (flash_sale === '1') where += ' AND p.flash_sale = 1';
  // lower() both sides: case-insensitive on SQLite AND PostgreSQL alike.
  if (q) { where += ' AND lower(p.name) LIKE lower(?)'; params.push(`%${q}%`); }
  const from = ' FROM products p LEFT JOIN categories c ON c.id = p.category_id';
  let sql = `SELECT p.*, c.name AS category_name, c.slug AS category_slug${from}${where} ORDER BY p.id DESC`;

  // Category pages request a small page at a time so image data for the entire
  // catalog is not transferred before the first products can appear.
  if ((category || category_id) && (req.query.page != null || req.query.limit != null)) {
    const requestedPage = Number.parseInt(req.query.page || '1', 10);
    const limit = Number.parseInt(req.query.limit || '12', 10);
    if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 48) {
      return res.status(400).json({ error: 'Invalid product pagination.' });
    }
    const count = await db.get(`SELECT COUNT(*) AS total${from}${where}`, ...params);
    const total = Number(count && count.total) || 0;
    const pages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(requestedPage, pages);
    sql += ' LIMIT ? OFFSET ?';
    const products = await db.all(sql, ...params, limit, (page - 1) * limit);
    return res.json({ products, pagination: { page, limit, total, pages } });
  }

  res.json({ products: await db.all(sql, ...params) });
});

router.get('/products/:slug', async (req, res) => {
  const product = await db.get("SELECT * FROM products WHERE slug = ? AND status = 'active'", req.params.slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const images = await db.all(`SELECT image_data FROM product_images
    WHERE product_id = ? AND image_data IS NOT NULL AND image_data <> ''
    ORDER BY is_primary DESC, sort_order, id LIMIT 8`, product.id);
  product.images = [...new Set([
    product.image,
    ...images.map((image) => image.image_data),
  ].filter((image) => typeof image === 'string' && image.trim()))].slice(0, 8);
  const randomFn = db.engine === 'postgres' ? 'random()' : 'RANDOM()';
  const related = await db.all(`SELECT * FROM products WHERE slug != ? AND status = 'active' ORDER BY ${randomFn} LIMIT 4`, req.params.slug);
  const reviews = await db.all(`
    SELECT r.rating, r.comment, r.created_at, u.username
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? AND r.is_visible = 1 ORDER BY r.id DESC`, product.id);
  res.json({ product, related, reviews });
});

/* ---------------- PROMOTIONS / COUPONS ---------------- */

router.get('/promotional-banners', async (req, res) => {
  const banners = await db.all(`SELECT id, image, title, description, button_text, button_url, display_order, starts_at, ends_at
    FROM promotional_banners WHERE is_active = 1
    AND (starts_at IS NULL OR starts_at <= ?)
    AND (ends_at IS NULL OR ends_at > ?)
    ORDER BY display_order ASC, id ASC`, db.utcNow(), db.utcNow());
  res.json({ banners });
});

router.post('/coupons/validate', async (req, res) => {
  const items = await cartItems(req);
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty.' });
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const { code, coupon, error } = await couponForCode(req.body && req.body.code);
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

router.get('/cart', async (req, res) => {
  const w = cartWhere(req);
  const items = await db.all(`
    SELECT c.id AS cart_id, c.quantity, p.id, p.slug, p.name, p.price, p.old_price, p.image
    FROM carts c JOIN products p ON p.id = c.product_id
    WHERE ${w.sql}`, w.param);
  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  res.json({ items, subtotal });
});

router.post('/cart', async (req, res) => {
  const { product_id, quantity = 1 } = req.body || {};
  const product = await db.get('SELECT id, stock FROM products WHERE id = ?', product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock <= 0) return res.status(400).json({ error: 'This product is out of stock.' });
  const qty = Math.max(1, parseInt(quantity) || 1);
  const w = cartWhere(req);
  const existing = await db.get(`SELECT id, quantity FROM carts WHERE ${w.sql} AND product_id = ?`, w.param, product_id);
  if (existing) {
    await db.run('UPDATE carts SET quantity = quantity + ? WHERE id = ?', qty, existing.id);
  } else {
    await db.run('INSERT INTO carts (user_id, guest_id, product_id, quantity) VALUES (?, ?, ?, ?)',
      req.user ? req.user.id : null, req.user ? null : req.guestId, product_id, qty);
  }
  res.json({ ok: true });
});

async function ownsCartItem(req, id) {
  const w = cartWhere(req);
  return db.get(`SELECT id FROM carts WHERE id = ? AND ${w.sql}`, id, w.param);
}

router.put('/cart/:id', async (req, res) => {
  if (!(await ownsCartItem(req, req.params.id))) return res.status(404).json({ error: 'Cart item not found' });
  const qty = Math.max(1, parseInt(req.body && req.body.quantity) || 1);
  await db.run('UPDATE carts SET quantity = ? WHERE id = ?', qty, req.params.id);
  res.json({ ok: true });
});

router.delete('/cart/:id', async (req, res) => {
  if (!(await ownsCartItem(req, req.params.id))) return res.status(404).json({ error: 'Cart item not found' });
  await db.run('DELETE FROM carts WHERE id = ?', req.params.id);
  res.json({ ok: true });
});

// Add to cart by product slug (used by static "+" buttons on home/listing pages)
router.post('/cart/by-slug', async (req, res) => {
  const { slug, quantity = 1 } = req.body || {};
  if (!slug) return res.status(400).json({ error: 'Product slug is required.' });
  const product = await db.get('SELECT id, stock FROM products WHERE slug = ?', slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  if (product.stock <= 0) return res.status(400).json({ error: 'This product is out of stock.' });
  const qty = Math.max(1, parseInt(quantity) || 1);
  const w = cartWhere(req);
  const existing = await db.get(`SELECT id, quantity FROM carts WHERE ${w.sql} AND product_id = ?`, w.param, product.id);
  if (existing) {
    await db.run('UPDATE carts SET quantity = quantity + ? WHERE id = ?', qty, existing.id);
  } else {
    await db.run('INSERT INTO carts (user_id, guest_id, product_id, quantity) VALUES (?, ?, ?, ?)',
      req.user ? req.user.id : null, req.user ? null : req.guestId, product.id, qty);
  }
  res.json({ ok: true });
});

/* ---------------- WISHLIST (guests too) ---------------- */

function wishWhere(req) {
  return req.user
    ? { sql: 'user_id = ?', param: req.user.id }
    : { sql: 'guest_id = ?', param: req.guestId };
}

router.get('/wishlist', async (req, res) => {
  const w = wishWhere(req);
  const items = await db.all(`
    SELECT w.id AS wishlist_id, p.id, p.slug, p.name, p.price, p.old_price, p.image, p.badge
    FROM wishlists w JOIN products p ON p.id = w.product_id
    WHERE ${w.sql}`, w.param);
  res.json({ items });
});

router.post('/wishlist', async (req, res) => {
  const { product_id } = req.body || {};
  const product = await db.get('SELECT id FROM products WHERE id = ?', product_id);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const w = wishWhere(req);
  const existing = await db.get(`SELECT id FROM wishlists WHERE ${w.sql} AND product_id = ?`, w.param, product_id);
  if (existing) {
    await db.run('DELETE FROM wishlists WHERE id = ?', existing.id);
    return res.json({ ok: true, added: false });
  }
  await db.run('INSERT INTO wishlists (user_id, guest_id, product_id) VALUES (?, ?, ?)',
    req.user ? req.user.id : null, req.user ? null : req.guestId, product_id);
  res.json({ ok: true, added: true });
});

router.delete('/wishlist/:id', async (req, res) => {
  const w = wishWhere(req);
  await db.run(`DELETE FROM wishlists WHERE id = ? AND ${w.sql}`, req.params.id, w.param);
  res.json({ ok: true });
});

/* ---------------- ORDERS / CHECKOUT ---------------- */

router.post('/orders', async (req, res) => {
  const { full_name, email, phone, address, shipping_method = 'standard', payment_method = 'cash', coupon_code } = req.body || {};
  const paymentMethod = String(payment_method).trim().toLowerCase();
  if (!full_name || !email || !phone || !address)
    return res.status(400).json({ error: 'Full name, email, phone and address are required.' });
  if (!String(full_name).trim() || String(full_name).length > 120 || String(email).length > 254 ||
      !String(phone).trim() || String(phone).length > 50 || !String(address).trim() || String(address).length > 1000)
    return res.status(400).json({ error: 'Phone number and shipping address are required.' });
  if (!Object.prototype.hasOwnProperty.call(SHIPPING_FEES, shipping_method))
    return res.status(400).json({ error: 'Invalid shipping method.' });
  const availablePaymentMethods = await enabledPaymentMethods();
  if (!availablePaymentMethods.has(paymentMethod))
    return res.status(400).json({ error: 'This payment method is not currently available.' });

  const w = cartWhere(req);
  const items = await cartItems(req);
  if (items.length === 0) return res.status(400).json({ error: 'Your cart is empty.' });

  const subtotal = items.reduce((s, i) => s + i.price * i.quantity, 0);
  const shippingFee = SHIPPING_FEES[shipping_method];

  try {
    const order = await db.transaction(async (tx) => {
      // CONCURRENCY: lock the product rows first (FOR UPDATE on PostgreSQL;
      // SQLite transactions are fully serialised by the engine queue), then
      // validate stock against the LOCKED rows — two simultaneous checkouts
      // can no longer both pass validation for the last unit.
      const placeholders = items.map(() => '?').join(',');
      const locked = await tx.all(
        `SELECT id, stock FROM products WHERE id IN (${placeholders})${db.forUpdate()}`,
        ...items.map((i) => i.id)
      );
      const stockById = new Map(locked.map((p) => [Number(p.id), Number(p.stock)]));
      for (const i of items) {
        if ((stockById.get(Number(i.id)) ?? 0) < i.quantity)
          throw new Error(`Not enough stock for ${i.name}.`);
      }

      // Resolve and consume the coupon in the same transaction as stock and order creation.
      let coupon = null;
      let discountAmount = 0;
      let code = '';
      if (coupon_code !== undefined && String(coupon_code).trim()) {
        const resolved = await couponForCode(coupon_code, tx);
        if (resolved.error) throw new Error(resolved.error);
        const discount = couponDiscount(resolved.coupon, subtotal);
        if (discount.error) throw new Error(discount.error);
        coupon = resolved.coupon;
        discountAmount = discount.amount;
        code = resolved.code;
        const used = await tx.run(`UPDATE coupons SET usage_count = usage_count + 1, updated_at = ?
          WHERE id = ? AND is_active = 1 AND (usage_limit IS NULL OR usage_count < usage_limit)`,
          db.utcNow(), coupon.id);
        if (used.changes !== 1) throw new Error('This coupon has reached its usage limit.');
      }
      const total = subtotal - discountAmount + shippingFee;
      const info = await tx.insert(`INSERT INTO orders
        (user_id, guest_id, full_name, email, phone, address, shipping_method, payment_method, subtotal, shipping_fee, discount_amount, coupon_code, total)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        req.user ? req.user.id : null, req.user ? null : req.guestId,
        String(full_name).trim(), String(email).trim().toLowerCase(), String(phone).trim(), String(address).trim(), shipping_method, paymentMethod,
        subtotal, shippingFee, discountAmount, code, total);
      const orderId = info.id;
      await tx.run(`INSERT INTO payments (order_id, payment_method, payment_status, amount_paid)
        VALUES (?, ?, 'pending', 0)`, orderId, paymentMethod);
      for (const i of items) {
        await tx.run('INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)',
          orderId, i.id, i.name, i.price, i.quantity);
        // Atomic conditional decrement: the final correctness net — even if a
        // row changed under us, stock can never go negative from checkout.
        const decremented = await tx.run(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', i.quantity, i.id, i.quantity);
        if (decremented.changes !== 1) throw new Error(`Not enough stock for ${i.name}.`);
      }
      await tx.run(`DELETE FROM carts WHERE ${w.sql}`, w.param);
      if (req.user) await notify(req.user.id, `Order #${orderId} placed`, `Total Rs. ${total.toLocaleString()} via ${paymentMethod}.`, 'order', tx);
      await createAdminNotification({ type: 'order', title: `New order #${orderId}`, body: 'A new order has been placed.', entityType: 'order', entityId: orderId }, tx);
      return { orderId, total, discountAmount };
    });

    // Hand the customer the invoice number and download link up front, so the
    // confirmation page can reference the exact document it auto-downloads.
    const placed = await db.get('SELECT created_at FROM orders WHERE id = ?', order.orderId);
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

router.get('/orders', requireAuth, async (req, res) => {
  const orders = await db.all('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC', req.user.id);
  const withItems = [];
  for (const o of orders) {
    withItems.push({ ...o, items: await db.all('SELECT * FROM order_items WHERE order_id = ?', o.id) });
  }
  res.json({ orders: withItems });
});

router.get('/orders/:id', requireAuth, async (req, res) => {
  const order = await db.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = await db.all('SELECT * FROM order_items WHERE order_id = ?', order.id);
  res.json({ order, items });
});

router.get('/orders/:id/invoice', async (req, res) => {
  const orderId = Number.parseInt(req.params.id, 10);
  if (!Number.isSafeInteger(orderId) || orderId < 1)
    return res.status(400).json({ error: 'Invalid order ID.' });

  const order = req.user
    ? await db.get('SELECT * FROM orders WHERE id = ? AND user_id = ?', orderId, req.user.id)
    : await db.get('SELECT * FROM orders WHERE id = ? AND guest_id = ?', orderId, req.guestId);
  if (!order) return res.status(404).json({ error: 'Invoice not found.' });

  // The product join only feeds the printed item code, so the invoice still works
  // for orders whose product has since been removed from the catalog.
  const items = await db.all(`SELECT oi.name, oi.price, oi.quantity, p.sku
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? ORDER BY oi.id`, order.id);
  sendInvoice(res, order, items);
});

/* ---------------- VENDOR / CONTACT / NOTIFICATIONS / REVIEWS ---------------- */

router.post('/vendor/apply', requireAuth, async (req, res) => {
  const { account_type, store_name, location, mobile } = req.body || {};
  if (!account_type || !store_name || !location || !mobile)
    return res.status(400).json({ error: 'Account type, store name, location and mobile are required.' });
  const application = await db.insert('INSERT INTO vendor_applications (user_id, account_type, store_name, location, mobile) VALUES (?, ?, ?, ?, ?)',
    req.user.id, account_type, store_name, location, mobile);
  await notify(req.user.id, 'Vendor application received', `Your application for "${store_name}" is under review.`, 'vendor');
  await createAdminNotification({ type: 'vendor', title: 'New vendor application', body: 'A vendor application needs review.', entityType: 'vendor_application', entityId: application.id });
  res.json({ ok: true });
});

router.post('/contact', contactLimiter, async (req, res) => {
  const { name, email, subject = '', message } = req.body || {};
  if (!name || !email || !message)
    return res.status(400).json({ error: 'Name, email and message are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim()))
    return res.status(400).json({ error: 'Enter a valid email address.' });
  if (String(name).length > 100 || String(email).length > 254 || String(subject).length > 160 || String(message).length > 2000)
    return res.status(400).json({ error: 'Contact message is too long.' });
  const contact = await db.insert('INSERT INTO contact_messages (user_id, name, email, subject, message) VALUES (?, ?, ?, ?, ?)',
    req.user ? req.user.id : null, name, email, subject, message);
  await createAdminNotification({ type: 'contact', title: 'New contact message', body: 'A customer has sent a contact message.', entityType: 'contact_message', entityId: contact.id });
  res.json({ ok: true });
});

router.get('/notifications', requireAuth, async (req, res) => {
  const items = await db.all('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 50', req.user.id);
  res.json({ notifications: items });
});

router.post('/notifications/read', requireAuth, async (req, res) => {
  await db.run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

router.post('/products/:slug/reviews', requireAuth, async (req, res) => {
  const { rating, comment = '' } = req.body || {};
  const ratingNum = Number(rating);
  const reviewComment = String(comment).trim();
  if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5)
    return res.status(400).json({ error: 'Rating must be between 1 and 5.' });
  if (reviewComment.length > 200)
    return res.status(400).json({ error: 'Reviews must be 200 characters or fewer.' });
  const product = await db.get('SELECT id FROM products WHERE slug = ?', req.params.slug);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  const review = await db.insert('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)',
    req.user.id, product.id, ratingNum, reviewComment);
  const agg = await db.get('SELECT AVG(rating) AS avg, COUNT(*) AS c FROM reviews WHERE product_id = ? AND is_visible = 1', product.id);
  await db.run('UPDATE products SET rating = ?, rating_count = ? WHERE id = ?',
    Math.round(agg.avg * 10) / 10, agg.c, product.id);
  await createAdminNotification({ type: 'review', title: 'New product review', body: 'A customer submitted a product review.', entityType: 'review', entityId: review.id });
  res.json({ ok: true });
});

module.exports = router;
