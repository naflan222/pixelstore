// Admin API routes for the Pixels store
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { requireAdmin } = require('./auth');

const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);

/* ---------------- DASHBOARD STATS ---------------- */
router.get('/stats', (req, res) => {
  const stats = {
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status != 'cancelled'").get().t,
    pending_orders: db.prepare("SELECT COUNT(*) c FROM orders WHERE status = 'pending'").get().c,
    low_stock: db.prepare('SELECT COUNT(*) c FROM products WHERE stock < 10').get().c,
    out_of_stock: db.prepare('SELECT COUNT(*) c FROM products WHERE stock = 0').get().c,
    vendor_applications: db.prepare('SELECT COUNT(*) c FROM vendor_applications WHERE status = \'pending\'').get().c,
    contact_messages: db.prepare('SELECT COUNT(*) c FROM contact_messages').get().c,
    unread_messages: db.prepare('SELECT COUNT(*) c FROM contact_messages WHERE id NOT IN (SELECT contact_message_id FROM read_messages)').get().c,
  };
  // Recent orders
  const recentOrders = db.prepare(`
    SELECT o.id, o.full_name, o.total, o.status, o.payment_method, o.created_at,
           (SELECT COUNT(*) FROM order_items WHERE order_id = o.id) AS item_count
    FROM orders o ORDER BY o.id DESC LIMIT 10`).all();
  // Low stock products
  const lowStock = db.prepare('SELECT id, name, stock, price, image FROM products WHERE stock < 10 ORDER BY stock ASC LIMIT 10').all();
  // Revenue last 7 days
  const revenue7 = db.prepare(`
    SELECT DATE(created_at) AS date, COALESCE(SUM(total),0) AS total, COUNT(*) AS orders
    FROM orders WHERE created_at >= datetime('now','-7 days') AND status != 'cancelled'
    GROUP BY DATE(created_at) ORDER BY date`).all();

  res.json({ ...stats, recentOrders, lowStock, revenue7 });
});

/* ---------------- ORDERS ---------------- */
router.get('/orders', (req, res) => {
  const { status, search, page: pageNum } = req.query;
  const perPage = 20;
  const page = Math.max(1, parseInt(pageNum) || 1);
  const offset = (page - 1) * perPage;

  let sql = 'SELECT * FROM orders WHERE 1=1';
  const params = [];
  if (status && status !== 'all') { sql += ' AND status = ?'; params.push(status); }
  if (search) { sql += ' AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR id = ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, parseInt(search) || 0); }
  sql += ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(perPage, offset);

  const orders = db.prepare(sql).all(...params);
  const itemsStmt = db.prepare('SELECT * FROM order_items WHERE order_id = ?');

  let countSql = 'SELECT COUNT(*) c FROM orders WHERE 1=1';
  const countParams = [];
  if (status && status !== 'all') { countSql += ' AND status = ?'; countParams.push(status); }
  if (search) { countSql += ' AND (full_name LIKE ? OR phone LIKE ? OR email LIKE ? OR id = ?)';
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, parseInt(search) || 0); }
  const total = db.prepare(countSql).get(...countParams).c;

  res.json({
    orders: orders.map(o => ({ ...o, items: itemsStmt.all(o.id) })),
    total,
    page,
    pages: Math.ceil(total / perPage),
  });
});

router.get('/orders/:id', (req, res) => {
  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
  res.json({ order, items });
});

router.put('/orders/:id/status', (req, res) => {
  const { status } = req.body || {};
  const valid = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(status, req.params.id);
  // Notify user if they have an account
  const order = db.prepare('SELECT user_id, full_name FROM orders WHERE id = ?').get(req.params.id);
  if (order && order.user_id) {
    db.prepare('INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)')
      .run(order.user_id, `Order #${req.params.id} updated`, `Status: ${status}`, 'order');
  }
  res.json({ ok: true });
});

/* ---------------- PRODUCTS ---------------- */
router.get('/products', (req, res) => {
  const { search, category } = req.query;
  let sql = 'SELECT * FROM products WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (name LIKE ? OR slug LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (category) { sql += ' AND category = ?'; params.push(category); }
  sql += ' ORDER BY id DESC';
  const products = db.prepare(sql).all(...params);
  res.json({ products });
});

router.post('/products', (req, res) => {
  const { name, slug, price, old_price, image, description, category, badge, stock, featured, flash_sale } = req.body || {};
  if (!name || !slug || price == null || !image)
    return res.status(400).json({ error: 'Name, slug, price and image are required.' });
  const existing = db.prepare('SELECT id FROM products WHERE slug = ?').get(slug);
  if (existing) return res.status(409).json({ error: 'A product with this slug already exists.' });
  db.prepare(`INSERT INTO products (slug, name, description, price, old_price, image, category, badge, stock, featured, flash_sale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(slug, name, description || '', price, old_price || null, image, category || 'GoPro Accessories',
         badge || null, stock != null ? stock : 100, featured ? 1 : 0, flash_sale ? 1 : 0);
  res.json({ ok: true });
});

router.put('/products/:id', (req, res) => {
  const { name, slug, price, old_price, image, description, category, badge, stock, featured, flash_sale, rating } = req.body || {};
  const existing = db.prepare('SELECT id FROM products WHERE slug = ? AND id != ?').get(slug, req.params.id);
  if (existing) return res.status(409).json({ error: 'Another product already uses this slug.' });
  db.prepare(`UPDATE products SET
    name = ?, slug = ?, description = ?, price = ?, old_price = ?, image = ?,
    category = ?, badge = ?, stock = ?, featured = ?, flash_sale = ?, rating = ?
    WHERE id = ?`)
    .run(name, slug, description || '', price, old_price || null, image,
         category || 'GoPro Accessories', badge || null, stock != null ? stock : 0,
         featured ? 1 : 0, flash_sale ? 1 : 0, rating || 4.5, req.params.id);
  res.json({ ok: true });
});

router.delete('/products/:id', (req, res) => {
  // Check if product is in any carts or orders
  const inCart = db.prepare('SELECT COUNT(*) c FROM carts WHERE product_id = ?').get(req.params.id).c;
  if (inCart) return res.status(400).json({ error: 'Cannot delete: product is in someone\'s cart. Remove it from carts first or set stock to 0.' });
  db.prepare('DELETE FROM products WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- USERS ---------------- */
router.get('/users', (req, res) => {
  const { search } = req.query;
  let sql = `SELECT id, username, email, full_name, phone, address, role, balance, created_at,
    (SELECT COUNT(*) FROM orders WHERE user_id = users.id) AS order_count
    FROM users WHERE 1=1`;
  const params = [];
  if (search) { sql += ' AND (username LIKE ? OR email LIKE ? OR full_name LIKE ?)'; 
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY id DESC';
  res.json({ users: db.prepare(sql).all(...params) });
});

router.put('/users/:id/role', (req, res) => {
  const { role } = req.body || {};
  if (!['customer', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role' });
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, req.params.id);
  res.json({ ok: true });
});

/* ---------------- CONTACT MESSAGES ---------------- */
router.get('/messages', (req, res) => {
  const messages = db.prepare('SELECT * FROM contact_messages ORDER BY id DESC').all();
  res.json({ messages });
});

router.put('/messages/:id/read', (req, res) => {
  db.prepare('INSERT OR IGNORE INTO read_messages (contact_message_id) VALUES (?)').run(req.params.id);
  res.json({ ok: true });
});

/* ---------------- VENDOR APPLICATIONS ---------------- */
router.get('/vendors', (req, res) => {
  const vendors = db.prepare(`
    SELECT v.*, u.username, u.email
    FROM vendor_applications v LEFT JOIN users u ON u.id = v.user_id
    ORDER BY v.id DESC`).all();
  res.json({ vendors });
});

router.put('/vendors/:id/status', (req, res) => {
  const { status } = req.body || {};
  if (!['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare('UPDATE vendor_applications SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ ok: true });
});

/* ---------------- REVIEWS ---------------- */
router.get('/reviews', (req, res) => {
  const reviews = db.prepare(`
    SELECT r.*, p.name AS product_name, u.username
    FROM reviews r
    JOIN products p ON p.id = r.product_id
    JOIN users u ON u.id = r.user_id
    ORDER BY r.id DESC`).all();
  res.json({ reviews });
});

router.delete('/reviews/:id', (req, res) => {
  db.prepare('DELETE FROM reviews WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
