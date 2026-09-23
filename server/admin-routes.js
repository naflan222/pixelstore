// Admin API routes for the Pixels store
const express = require('express');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');
const { requireAdmin, requirePermission } = require('./auth');
const { sendInvoice } = require('./invoice');

const router = express.Router();

// All admin routes require admin role
router.use(requireAdmin);
router.use(express.text({ type: ['text/csv', 'application/csv', 'application/vnd.ms-excel'], limit: '5mb' }));

const owners = requirePermission('owner', 'admin');
const orderAccess = requirePermission('owner', 'admin', 'order_manager');
const catalogAccess = requirePermission('owner', 'admin', 'catalog_manager');
const supportAccess = requirePermission('owner', 'admin', 'support');
const audit = async (req, action, entityType, entityId, details = '') => {
  await db.run('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
    req.user.id, action, entityType, String(entityId), details);
};
const productId = (value) => {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
};
const validSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(value || ''));
const validImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const DEFAULT_PRODUCT_IMAGE = 'img/product/1.png';
const SALES_ORDER_FILTER = "status NOT IN ('cancelled', 'refunded')";
const ADMIN_ROLES = new Set(['owner', 'admin', 'order_manager', 'catalog_manager', 'support']);
const ownerOnly = requirePermission('owner');

function adminUserPayload(body, { creating = false } = {}) {
  const source = body || {};
  const username = String(source.username || '').trim();
  const email = String(source.email || '').trim().toLowerCase();
  const fullName = String(source.full_name || '').trim();
  const phone = String(source.phone || '').trim();
  const role = String(source.role || 'admin');
  const password = source.password === undefined ? undefined : String(source.password);
  const isActive = source.is_active === undefined ? 1 : (source.is_active === true || source.is_active === 1 || source.is_active === '1' ? 1 : 0);
  if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username)) return { error: 'Username must be 3-50 letters, numbers, dots, underscores, or hyphens.' };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return { error: 'Provide a valid email address.' };
  if (fullName.length > 120 || phone.length > 50 || !ADMIN_ROLES.has(role) ||
      (source.is_active !== undefined && ![true, false, 0, 1, '0', '1'].includes(source.is_active))) return { error: 'Provide valid admin account details.' };
  if ((creating && (!password || password.length < 8)) || (!creating && password !== undefined && password.length < 8))
    return { error: 'Passwords must be at least 8 characters.' };
  return { username, email, fullName, phone, role, password, isActive };
}

async function wouldRemoveLastOwner(user, nextRole, nextActive) {
  if (user.role !== 'owner' || (nextRole === 'owner' && nextActive === 1)) return false;
  return (await db.get("SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND is_active = 1")).count <= 1;
}

function dateOnly(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text ? null : text;
}

function addUtcDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function analyticsDateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const currentMonth = `${today.slice(0, 7)}-01`;
  const nextMonth = addUtcDays(`${today.slice(0, 7)}-01`, 32).slice(0, 7) + '-01';
  const requestedRange = String(query.range || 'last_30_days').toLowerCase().replace(/[\s-]+/g, '_');
  const range = ({ last7: 'last_7_days', '7d': 'last_7_days', last30: 'last_30_days', '30d': 'last_30_days', month: 'this_month', lastmonth: 'last_month', year: 'this_year' })[requestedRange] || requestedRange;

  if (range === 'today') return { range, start: today, end: addUtcDays(today, 1) };
  if (range === 'last_7_days') return { range, start: addUtcDays(today, -6), end: addUtcDays(today, 1) };
  if (range === 'last_30_days') return { range, start: addUtcDays(today, -29), end: addUtcDays(today, 1) };
  if (range === 'this_month') return { range, start: currentMonth, end: nextMonth };
  if (range === 'last_month') {
    const lastMonthEnd = currentMonth;
    return { range, start: addUtcDays(currentMonth, -1).slice(0, 7) + '-01', end: lastMonthEnd };
  }
  if (range === 'this_year') return { range, start: `${today.slice(0, 4)}-01-01`, end: `${Number(today.slice(0, 4)) + 1}-01-01` };
  if (range === 'custom') {
    const start = dateOnly(query.start_date || query.start);
    const endDate = dateOnly(query.end_date || query.end);
    if (!start || !endDate || start > endDate) throw new Error('Provide a valid custom start and end date.');
    if (addUtcDays(start, 732) < endDate) throw new Error('Custom date ranges cannot exceed two years.');
    return { range, start, end: addUtcDays(endDate, 1) };
  }
  throw new Error('Invalid analytics date range.');
}

async function getCategory(categoryId, includeInactive = false) {
  const id = productId(categoryId);
  if (!id) return null;
  return db.get(`SELECT id, name FROM categories WHERE id = ?${includeInactive ? '' : ' AND is_active = 1'}`, id);
}

async function setPrimaryImage(tx, productIdValue, imageId) {
  const image = await tx.get('SELECT id, image_data, file_name FROM product_images WHERE id = ? AND product_id = ?', imageId, productIdValue);
  if (!image) return null;
  await tx.run('UPDATE product_images SET is_primary = 0 WHERE product_id = ?', productIdValue);
  await tx.run('UPDATE product_images SET is_primary = 1 WHERE id = ?', image.id);
  await tx.run('UPDATE products SET image = ? WHERE id = ?', image.image_data, productIdValue);
  return image;
}

function finiteMoney(value, { min = 0, required = false } = {}) {
  if (value === undefined || value === null || value === '') return required ? null : 0;
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? number : null;
}

function parseSettingsJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : fallback;
  } catch (_) {
    return fallback;
  }
}

function storeSettingsPayload(body) {
  const source = body || {};
  const expectedFields = new Set(['store_name', 'currency', 'store_email', 'store_phone', 'store_open', 'cash_enabled', 'bank_enabled', 'paypal_enabled', 'shipping_fee', 'standard_delivery_enabled', 'express_delivery_enabled', 'order_notifications', 'low_stock_notifications', 'vendor_notifications']);
  if (!source || typeof source !== 'object' || Array.isArray(source) || Object.keys(source).some(key => !expectedFields.has(key)))
    return { error: 'Provide only recognized store settings.' };
  if ([...expectedFields].some(key => !Object.prototype.hasOwnProperty.call(source, key)))
    return { error: 'Provide all store settings.' };
  if (['store_name', 'currency', 'store_email', 'store_phone'].some(key => typeof source[key] !== 'string') ||
      typeof source.shipping_fee !== 'number')
    return { error: 'Provide settings using the expected field types.' };

  const storeName = String(source.store_name || '').trim();
  const email = String(source.store_email || '').trim().toLowerCase();
  const phone = String(source.store_phone || '').trim();
  const currency = String(source.currency || '').trim().toUpperCase();
  const storeOpen = source.store_open;
  const shippingFee = finiteMoney(source.shipping_fee, { min: 0, required: true });
  const booleans = ['store_open', 'cash_enabled', 'bank_enabled', 'paypal_enabled', 'standard_delivery_enabled', 'express_delivery_enabled', 'order_notifications', 'low_stock_notifications', 'vendor_notifications'];

  if (!storeName || storeName.length > 160 || (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) ||
      phone.length > 50 || !/^[A-Z]{3}$/.test(currency) || shippingFee === null || shippingFee > 1000000 ||
      booleans.some(key => typeof source[key] !== 'boolean'))
    return { error: 'Provide valid store, contact, payment, shipping, and notification settings.' };

  return {
    storeName,
    contact: { email, phone, address: '' },
    currency,
    storeStatus: storeOpen ? 'open' : 'closed',
    paymentMethods: ['cash', 'bank', 'paypal'].filter(method => source[`${method === 'cash' ? 'cash' : method}_enabled`]),
    shippingFee,
    deliveryOptions: [
      { method: 'standard', label: 'Standard delivery', fee: shippingFee, enabled: source.standard_delivery_enabled },
      { method: 'express', label: 'Express delivery', fee: shippingFee, enabled: source.express_delivery_enabled },
    ],
    preferences: { new_orders: source.order_notifications, low_stock: source.low_stock_notifications, vendor_applications: source.vendor_notifications },
  };
}

function storeSettingsResponse(row) {
  const contact = parseSettingsJson(row.contact, { email: '', phone: '', address: '' });
  const paymentMethods = parseSettingsJson(row.payment_methods, []);
  const deliveryOptions = parseSettingsJson(row.delivery_options, []);
  const preferences = parseSettingsJson(row.notification_preferences, {});
  const enabledDelivery = (method) => Boolean(deliveryOptions.find(option => option.method === method && option.enabled));
  return {
    store_name: row.store_name,
    store_email: contact.email || '',
    store_phone: contact.phone || '',
    store_open: row.store_status === 'open',
    currency: row.currency,
    cash_enabled: paymentMethods.includes('cash'),
    bank_enabled: paymentMethods.includes('bank'),
    paypal_enabled: paymentMethods.includes('paypal'),
    shipping_fee: row.shipping_fee,
    standard_delivery_enabled: enabledDelivery('standard'),
    express_delivery_enabled: enabledDelivery('express'),
    order_notifications: Boolean(preferences.new_orders),
    low_stock_notifications: Boolean(preferences.low_stock),
    vendor_notifications: Boolean(preferences.vendor_applications || preferences.new_vendor_applications),
    updated_at: row.updated_at,
  };
}

function optionalDateTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? false : date.toISOString().replace('T', ' ').slice(0, 19);
}

function validBannerUrl(value) {
  const url = String(value || '').trim();
  return !url || /^\/(?!\/)/.test(url) || /^https?:\/\//i.test(url) || /^[\w-]+\.html(?:[?#].*)?$/i.test(url);
}

function couponPayload(body) {
  const source = body || {};
  const code = String(source.code || '').trim().toUpperCase();
  const discountType = String(source.discount_type || '');
  const discountValue = finiteMoney(source.discount_value, { min: Number.EPSILON, required: true });
  const minimumOrderAmount = finiteMoney(source.minimum_order_amount, { min: 0 });
  const maximumDiscount = source.maximum_discount === '' || source.maximum_discount === null || source.maximum_discount === undefined
    ? null : finiteMoney(source.maximum_discount, { min: 0, required: true });
  const usageLimit = source.usage_limit === '' || source.usage_limit === null || source.usage_limit === undefined
    ? null : Number(source.usage_limit);
  const expiresAt = optionalDateTime(source.expires_at);
  if (!/^[A-Z0-9][A-Z0-9_-]{1,31}$/.test(code)) return { error: 'Coupon codes must be 2-32 uppercase letters, numbers, hyphens, or underscores.' };
  if (!['percentage', 'fixed'].includes(discountType) || discountValue === null || minimumOrderAmount === null || maximumDiscount === false || expiresAt === false)
    return { error: 'Provide valid coupon discount and date values.' };
  if (discountType === 'percentage' && discountValue > 100) return { error: 'Percentage discounts cannot exceed 100%.' };
  if (discountType === 'fixed' && maximumDiscount !== null) return { error: 'Maximum discount is only available for percentage coupons.' };
  if (usageLimit !== null && (!Number.isSafeInteger(usageLimit) || usageLimit < 0)) return { error: 'Usage limit must be a non-negative whole number.' };
  return { code, discountType, discountValue, minimumOrderAmount, maximumDiscount, usageLimit, expiresAt, isActive: source.is_active === false || source.is_active === 0 || source.is_active === '0' ? 0 : 1 };
}

function csvEscape(value) {
  const text = String(value ?? '');
  // Prefix formula-like cells so exported data cannot execute in spreadsheet clients.
  const safeText = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safeText) ? `"${safeText.replace(/"/g, '""')}"` : safeText;
}

function parseCsv(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Upload a non-empty CSV document.');
  if (Buffer.byteLength(text, 'utf8') > 5 * 1024 * 1024) throw new Error('CSV files cannot exceed 5 MB.');
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  let quoteClosed = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') { quoted = false; quoteClosed = true; }
      else cell += character;
    } else if (character === '"') {
      if (cell || quoteClosed) throw new Error(`Malformed CSV near character ${index + 1}.`);
      quoted = true;
    } else if (character === ',') {
      row.push(cell); cell = ''; quoteClosed = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(cell); cell = ''; quoteClosed = false;
      if (row.some(value => value !== '')) rows.push(row);
      row = [];
    } else {
      if (quoteClosed) throw new Error(`Malformed CSV near character ${index + 1}.`);
      cell += character;
    }
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted value.');
  row.push(cell);
  if (row.some(value => value !== '')) rows.push(row);
  if (rows.length < 2) throw new Error('CSV must include a header and at least one product row.');
  if (rows.length > 1001) throw new Error('Import at most 1,000 products at a time.');
  const headers = rows.shift().map((header, index) => String(header).replace(/^﻿/, '').trim().toLowerCase());
  if (headers.some(header => !header) || new Set(headers).size !== headers.length) throw new Error('CSV headers must be non-empty and unique.');
  for (const required of ['name', 'slug', 'price']) if (!headers.includes(required)) throw new Error(`CSV is missing the required ${required} column.`);
  return rows.map((values, index) => {
    if (values.length !== headers.length) throw new Error(`Row ${index + 2} has ${values.length} values; expected ${headers.length}.`);
    return Object.fromEntries(headers.map((header, column) => [header, values[column].trim()]));
  });
}

function csvBoolean(value, field, rowNumber) {
  if (value === undefined || value === '') return 0;
  const normalized = String(value).toLowerCase();
  if (['1', 'true', 'yes'].includes(normalized)) return 1;
  if (['0', 'false', 'no'].includes(normalized)) return 0;
  throw new Error(`Row ${rowNumber}: ${field} must be true/false or 1/0.`);
}

function csvInteger(value, field, rowNumber, { min = 0, fallback = 0 } = {}) {
  if (value === undefined || value === '') return fallback;
  if (!/^-?\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min)
    throw new Error(`Row ${rowNumber}: ${field} must be a whole number of at least ${min}.`);
  return Number(value);
}

function csvMoney(value, field, rowNumber, { nullable = false } = {}) {
  if (value === undefined || value === '') return nullable ? null : NaN;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`Row ${rowNumber}: ${field} must be a non-negative number.`);
  return amount;
}

async function importProductRow(row, rowNumber, seen) {
  const name = String(row.name || '').trim();
  const slug = String(row.slug || '').trim();
  const sku = String(row.sku || '').trim() || null;
  const id = row.id === undefined || row.id === '' ? null : csvInteger(row.id, 'id', rowNumber, { min: 1 });
  const price = csvMoney(row.price, 'price', rowNumber);
  const oldPrice = csvMoney(row.old_price, 'old_price', rowNumber, { nullable: true });
  const status = String(row.status || 'active').toLowerCase();
  const image = String(row.image || DEFAULT_PRODUCT_IMAGE).trim();
  if (!name || name.length > 255 || !validSlug(slug) || !Number.isFinite(price)) throw new Error(`Row ${rowNumber}: provide a name, URL-safe slug, and non-negative price.`);
  if (!['active', 'inactive', 'draft'].includes(status)) throw new Error(`Row ${rowNumber}: status must be active, inactive, or draft.`);
  if (sku && sku.length > 100) throw new Error(`Row ${rowNumber}: SKU is too long.`);
  if (image.length > 500 || !/^img\/[A-Za-z0-9._/-]+$/.test(image) || image.includes('..')) throw new Error(`Row ${rowNumber}: image must be a safe img/ path.`);
  for (const [label, value] of [['id', id], ['slug', slug], ['sku', sku && sku.toLowerCase()]]) {
    if (value !== null && seen[label].has(value)) throw new Error(`Row ${rowNumber}: duplicate ${label} in this import.`);
    if (value !== null) seen[label].add(value);
  }
  const categoryId = row.category_id === undefined || row.category_id === '' ? null : csvInteger(row.category_id, 'category_id', rowNumber, { min: 1 });
  const categoryValue = String(row.category || '').trim();
  let category = categoryId ? await getCategory(categoryId) : null;
  if (categoryValue) {
    const categoryByName = await db.get('SELECT id, name FROM categories WHERE is_active = 1 AND (lower(name) = lower(?) OR lower(slug) = lower(?))', categoryValue, categoryValue);
    if (!categoryByName) throw new Error(`Row ${rowNumber}: category "${categoryValue}" does not exist or is inactive.`);
    if (category && category.id !== categoryByName.id) throw new Error(`Row ${rowNumber}: category and category_id do not match.`);
    category = categoryByName;
  }
  if (categoryId && !category) throw new Error(`Row ${rowNumber}: category_id does not reference an active category.`);
  return {
    id, name, slug, sku, price, oldPrice, category, image, status,
    description: String(row.description || '').trim().slice(0, 10000),
    badge: String(row.badge || '').trim().slice(0, 100) || null,
    brand: String(row.brand || '').trim().slice(0, 100),
    stock: csvInteger(row.stock, 'stock', rowNumber),
    reorderThreshold: csvInteger(row.reorder_threshold, 'reorder_threshold', rowNumber, { fallback: 10 }),
    featured: csvBoolean(row.featured, 'featured', rowNumber),
    flashSale: csvBoolean(row.flash_sale, 'flash_sale', rowNumber),
  };
}

// Sales grouped by day or month with an identical response shape on both
// engines. SQLite keeps DATE()/strftime(); PostgreSQL extracts year/month/day
// parts in a subquery (grouping on plain columns) and labels are assembled
// here, avoiding dialect-only date-truncation functions either way.
async function salesBuckets(bucket, where, params) {
  if (db.engine === 'postgres') {
    const inner = bucket === 'day'
      ? 'EXTRACT(YEAR FROM created_at) AS y, EXTRACT(MONTH FROM created_at) AS m, EXTRACT(DAY FROM created_at) AS d'
      : 'EXTRACT(YEAR FROM created_at) AS y, EXTRACT(MONTH FROM created_at) AS m';
    const cols = bucket === 'day' ? 'y, m, d' : 'y, m';
    const rows = await db.all(
      `SELECT ${cols}, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
       FROM (SELECT ${inner}, total FROM orders WHERE ${where}) s GROUP BY ${cols} ORDER BY ${cols}`,
      ...params
    );
    return rows.map((r) => {
      const stamp = bucket === 'day'
        ? `${r.y}-${String(r.m).padStart(2, '0')}-${String(r.d).padStart(2, '0')}`
        : `${r.y}-${String(r.m).padStart(2, '0')}`;
      return bucket === 'day'
        ? { date: stamp, revenue: Number(r.revenue), orders: Number(r.orders) }
        : { month: stamp, revenue: Number(r.revenue), orders: Number(r.orders) };
    });
  }
  if (bucket === 'day') {
    return db.all(`SELECT DATE(created_at) AS date, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
      FROM orders WHERE ${where} GROUP BY DATE(created_at) ORDER BY date`, ...params);
  }
  return db.all(`SELECT strftime('%Y-%m', created_at) AS month, COALESCE(SUM(total), 0) AS revenue, COUNT(*) AS orders
    FROM orders WHERE ${where} GROUP BY strftime('%Y-%m', created_at) ORDER BY month`, ...params);
}

// Per-user order aggregates without correlated subqueries (portable across
// SQLite, PostgreSQL, and the pg-mem test double): one GROUP BY query whose
// rows are merged into the user list by the caller.
async function orderSummariesFor(userIds) {
  const summaries = new Map();
  if (!userIds.length) return summaries;
  const placeholders = userIds.map(() => '?').join(',');
  const rows = await db.all(`SELECT user_id, COUNT(*) AS order_count,
      COALESCE(SUM(CASE WHEN ${SALES_ORDER_FILTER} THEN total ELSE 0 END), 0) AS total_spent,
      MAX(created_at) AS last_order_date
    FROM orders WHERE user_id IN (${placeholders}) GROUP BY user_id`, ...userIds);
  for (const row of rows) summaries.set(Number(row.user_id), row);
  return summaries;
}

async function itemCountsFor(orderIds) {
  const counts = new Map();
  if (!orderIds.length) return counts;
  const placeholders = orderIds.map(() => '?').join(',');
  const rows = await db.all(`SELECT order_id, COUNT(*) AS item_count
    FROM order_items WHERE order_id IN (${placeholders}) GROUP BY order_id`, ...orderIds);
  for (const row of rows) counts.set(Number(row.order_id), Number(row.item_count));
  return counts;
}

// CSV import may insert explicit product ids; on PostgreSQL the identity
// sequence must then be moved past MAX(id) (SQLite AUTOINCREMENT needs no
// equivalent, and drivers without real sequences are skipped).
async function repairIdentitySequence(table) {
  if (db.engine !== 'postgres') return;
  const sequence = `${table}_id_seq`;
  const exists = await db.get('SELECT 1 AS one FROM pg_class WHERE relkind = \'S\' AND relname = ?', sequence);
  if (!exists) return;
  await db.run(`SELECT setval('${sequence}', (SELECT MAX(id) FROM ${table}))`);
}

/* ---------------- CATEGORIES ---------------- */
router.get('/categories', catalogAccess, async (req, res) => {
  const categories = await db.all('SELECT * FROM categories ORDER BY name');
  const counts = await db.all(`SELECT category_id, COUNT(*) AS product_count FROM products
    WHERE category_id IS NOT NULL GROUP BY category_id`);
  const byCategory = new Map(counts.map((row) => [Number(row.category_id), Number(row.product_count)]));
  for (const category of categories) category.product_count = byCategory.get(Number(category.id)) || 0;
  res.json({ categories });
});

router.post('/categories', catalogAccess, async (req, res) => {
  const { name, slug, description, image, is_active } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!cleanName || cleanName.length > 100 || !validSlug(cleanSlug))
    return res.status(400).json({ error: 'Provide a category name and a lowercase, URL-safe slug.' });
  if (String(description || '').length > 2000 || String(image || '').length > 2048)
    return res.status(400).json({ error: 'Category description or image is too long.' });
  if (await db.get('SELECT id FROM categories WHERE name = ? OR slug = ?', cleanName, cleanSlug))
    return res.status(409).json({ error: 'A category with this name or slug already exists.' });
  const result = await db.insert(`INSERT INTO categories (name, slug, description, image, is_active)
    VALUES (?, ?, ?, ?, ?)`,
    cleanName, cleanSlug, String(description || '').trim(), String(image || '').trim(), is_active === false ? 0 : 1);
  await audit(req, 'created', 'category', result.id, cleanName);
  res.status(201).json({ ok: true, id: Number(result.id) });
});

router.put('/categories/:id', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { name, slug, description, image, is_active } = req.body || {};
  const cleanName = String(name || '').trim();
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!id || !cleanName || cleanName.length > 100 || !validSlug(cleanSlug))
    return res.status(400).json({ error: 'Provide a category name and a lowercase, URL-safe slug.' });
  if (String(description || '').length > 2000 || String(image || '').length > 2048)
    return res.status(400).json({ error: 'Category description or image is too long.' });
  const current = await db.get('SELECT id, name FROM categories WHERE id = ?', id);
  if (!current) return res.status(404).json({ error: 'Category not found.' });
  if (await db.get('SELECT id FROM categories WHERE (name = ? OR slug = ?) AND id != ?', cleanName, cleanSlug, id))
    return res.status(409).json({ error: 'Another category already uses this name or slug.' });
  await db.transaction(async (tx) => {
    await tx.run('UPDATE categories SET name = ?, slug = ?, description = ?, image = ?, is_active = ? WHERE id = ?',
      cleanName, cleanSlug, String(description || '').trim(), String(image || '').trim(), is_active === false ? 0 : 1, id);
    // Retain the legacy text field for existing storefront clients.
    await tx.run('UPDATE products SET category = ? WHERE category_id = ?', cleanName, id);
  });
  await audit(req, 'updated', 'category', id, cleanName);
  res.json({ ok: true });
});

router.delete('/categories/:id', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const reassignmentId = req.body && req.body.reassign_to == null ? null : productId(req.body && req.body.reassign_to);
  if (!id) return res.status(400).json({ error: 'Invalid category id.' });
  const category = await db.get('SELECT id, name FROM categories WHERE id = ?', id);
  if (!category) return res.status(404).json({ error: 'Category not found.' });
  const count = (await db.get('SELECT COUNT(*) AS count FROM products WHERE category_id = ?', id)).count;
  if (count && !reassignmentId)
    return res.status(409).json({ error: 'This category contains products. Choose another category to reassign them before deleting it.', product_count: count });
  const replacement = reassignmentId && reassignmentId !== id ? await getCategory(reassignmentId, true) : null;
  if (count && !replacement) return res.status(400).json({ error: 'Choose a different existing category for reassignment.' });
  await db.transaction(async (tx) => {
    if (count) await tx.run('UPDATE products SET category_id = ?, category = ? WHERE category_id = ?', replacement.id, replacement.name, id);
    await tx.run('DELETE FROM categories WHERE id = ?', id);
  });
  await audit(req, 'deleted', 'category', id, category.name);
  res.json({ ok: true, reassigned: count });
});

/* ---------------- SETTINGS ---------------- */
router.get('/settings', owners, async (req, res) => {
  const settings = await db.get('SELECT * FROM store_settings WHERE id = 1');
  res.json({ settings: storeSettingsResponse(settings) });
});

router.put('/settings', owners, async (req, res) => {
  const settings = storeSettingsPayload(req.body);
  if (settings.error) return res.status(400).json({ error: settings.error });
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE store_settings SET store_name = ?, contact = ?, currency = ?, store_status = ?, payment_methods = ?,
      shipping_fee = ?, delivery_options = ?, notification_preferences = ?, updated_at = ? WHERE id = 1`,
      settings.storeName, JSON.stringify(settings.contact), settings.currency, settings.storeStatus,
      JSON.stringify(settings.paymentMethods), settings.shippingFee, JSON.stringify(settings.deliveryOptions),
      JSON.stringify(settings.preferences), db.utcNow());
  });
  await audit(req, 'updated', 'store_settings', 1, 'Store settings updated');
  res.json({ ok: true, settings: storeSettingsResponse(await db.get('SELECT * FROM store_settings WHERE id = 1')) });
});

/* ---------------- DASHBOARD STATS ---------------- */
router.get('/stats', async (req, res) => {
  const stats = {
    users: (await db.get('SELECT COUNT(*) c FROM users')).c,
    products: (await db.get('SELECT COUNT(*) c FROM products')).c,
    orders: (await db.get('SELECT COUNT(*) c FROM orders')).c,
    revenue: (await db.get("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status != 'cancelled'")).t,
    pending_orders: (await db.get("SELECT COUNT(*) c FROM orders WHERE status = 'pending'")).c,
    low_stock: (await db.get('SELECT COUNT(*) c FROM products WHERE stock < 10')).c,
    out_of_stock: (await db.get('SELECT COUNT(*) c FROM products WHERE stock = 0')).c,
    vendor_applications: (await db.get("SELECT COUNT(*) c FROM vendor_applications WHERE status = 'pending'")).c,
    contact_messages: (await db.get('SELECT COUNT(*) c FROM contact_messages')).c,
    unread_messages: (await db.get('SELECT COUNT(*) c FROM contact_messages WHERE id NOT IN (SELECT contact_message_id FROM read_messages)')).c,
  };
  // Recent orders
  const recentOrders = await db.all(`
    SELECT o.id, o.full_name, o.total, o.status, o.payment_method, o.created_at
    FROM orders o ORDER BY o.id DESC LIMIT 10`);
  const recentCounts = await itemCountsFor(recentOrders.map((o) => o.id));
  for (const order of recentOrders) order.item_count = recentCounts.get(Number(order.id)) || 0;
  // Low stock products
  const lowStock = await db.all('SELECT id, name, stock, price, image FROM products WHERE stock < 10 ORDER BY stock ASC LIMIT 10');
  // Revenue last 7 days
  const revenue7 = (await salesBuckets('day', "created_at >= ? AND status != 'cancelled'", [db.utcNow(-7 * 24 * 3600 * 1000)]))
    .map((bucket) => ({ date: bucket.date, total: bucket.revenue, orders: bucket.orders }));

  res.json({ ...stats, recentOrders, lowStock, revenue7 });
});

/* ---------------- SALES ANALYTICS ---------------- */
router.get('/analytics', orderAccess, async (req, res) => {
  let range;
  try {
    range = analyticsDateRange(req.query);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }

  const salesRange = `created_at >= ? AND created_at < ? AND ${SALES_ORDER_FILTER}`;
  const rangeParams = [range.start, range.end];
  const today = new Date().toISOString().slice(0, 10);
  const thisMonth = `${today.slice(0, 7)}-01`;
  const nextMonth = addUtcDays(thisMonth, 32).slice(0, 7) + '-01';
  const summary = {
    total_revenue: (await db.get(`SELECT COALESCE(SUM(total), 0) AS value FROM orders WHERE ${SALES_ORDER_FILTER}`)).value,
    today_revenue: (await db.get(`SELECT COALESCE(SUM(total), 0) AS value FROM orders
      WHERE ${salesRange}`, today, addUtcDays(today, 1))).value,
    this_month_revenue: (await db.get(`SELECT COALESCE(SUM(total), 0) AS value FROM orders
      WHERE ${salesRange}`, thisMonth, nextMonth)).value,
    total_orders: (await db.get('SELECT COUNT(*) AS value FROM orders')).value,
    pending_orders: (await db.get("SELECT COUNT(*) AS value FROM orders WHERE status = 'pending'")).value,
    total_customers: (await db.get("SELECT COUNT(*) AS value FROM users WHERE role = 'customer'")).value,
    total_products: (await db.get('SELECT COUNT(*) AS value FROM products')).value,
    low_stock_products: (await db.get('SELECT COUNT(*) AS value FROM products WHERE stock <= reorder_threshold')).value,
    range_revenue: (await db.get(`SELECT COALESCE(SUM(total), 0) AS value FROM orders WHERE ${salesRange}`, ...rangeParams)).value,
    range_orders: (await db.get(`SELECT COUNT(*) AS value FROM orders WHERE ${salesRange}`, ...rangeParams)).value,
  };
  summary.average_order_value = summary.range_orders ? summary.range_revenue / summary.range_orders : 0;

  const salesByDay = await salesBuckets('day', salesRange, rangeParams);
  const salesByMonth = await salesBuckets('month', salesRange, rangeParams);
  const topProducts = await db.all(`SELECT oi.product_id, oi.name, SUM(oi.quantity) AS quantity_sold,
      COALESCE(SUM(oi.quantity * oi.price), 0) AS revenue, MAX(p.image) AS image
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.created_at >= ? AND o.created_at < ? AND o.${SALES_ORDER_FILTER}
    GROUP BY oi.product_id, oi.name ORDER BY quantity_sold DESC, revenue DESC, lower(oi.name) LIMIT 10`, ...rangeParams);
  const topCategories = await db.all(`SELECT name, SUM(quantity) AS quantity_sold,
      COALESCE(SUM(quantity * price), 0) AS revenue
    FROM (SELECT COALESCE(c.name, NULLIF(p.category, ''), 'Uncategorized') AS name, oi.quantity, oi.price
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p ON p.id = oi.product_id LEFT JOIN categories c ON c.id = p.category_id
      WHERE o.created_at >= ? AND o.created_at < ? AND o.${SALES_ORDER_FILTER}) s
    GROUP BY name ORDER BY revenue DESC, quantity_sold DESC, lower(name) LIMIT 10`, ...rangeParams);

  res.json({
    range: { ...range, end: addUtcDays(range.end, -1) },
    summary,
    sales_by_day: salesByDay,
    sales_by_month: salesByMonth,
    top_products: topProducts,
    top_categories: topCategories,
  });
});

/* ---------------- ORDERS ---------------- */
router.get('/orders', orderAccess, async (req, res) => {
  const { status, search, payment_method, payment_status, date, page: pageNum } = req.query;
  const perPage = 20;
  const page = Math.max(1, parseInt(pageNum) || 1);
  const offset = (page - 1) * perPage;

  let sql = `SELECT o.*, p.id AS payment_id, p.payment_status, p.transaction_id, p.paid_at, p.amount_paid
    FROM orders o LEFT JOIN payments p ON p.order_id = o.id WHERE 1=1`;
  const params = [];
  if (status && status !== 'all') { sql += ' AND o.status = ?'; params.push(status); }
  if (payment_method && payment_method !== 'all') { sql += ' AND o.payment_method = ?'; params.push(payment_method); }
  if (payment_status && payment_status !== 'all') { sql += ' AND p.payment_status = ?'; params.push(payment_status); }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { sql += ' AND o.created_at >= ? AND o.created_at < ?'; params.push(date, addUtcDays(date, 1)); }
  if (search) { sql += ' AND (lower(o.full_name) LIKE lower(?) OR lower(o.phone) LIKE lower(?) OR lower(o.email) LIKE lower(?) OR o.id = ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, parseInt(search) || 0); }
  sql += ' ORDER BY o.id DESC LIMIT ? OFFSET ?';
  params.push(perPage, offset);

  const orders = await db.all(sql, ...params);

  // payments is 1:1 with orders, so an inner join counts exactly the set a
  // correlated EXISTS would — without a correlated subquery (portable).
  const joinPayments = payment_status && payment_status !== 'all';
  let countSql = joinPayments
    ? 'SELECT COUNT(*) c FROM orders JOIN payments p ON p.order_id = orders.id WHERE 1=1'
    : 'SELECT COUNT(*) c FROM orders WHERE 1=1';
  const countParams = [];
  if (status && status !== 'all') { countSql += ' AND orders.status = ?'; countParams.push(status); }
  if (payment_method && payment_method !== 'all') { countSql += ' AND orders.payment_method = ?'; countParams.push(payment_method); }
  if (joinPayments) { countSql += ' AND p.payment_status = ?'; countParams.push(payment_status); }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) { countSql += ' AND orders.created_at >= ? AND orders.created_at < ?'; countParams.push(date, addUtcDays(date, 1)); }
  if (search) { countSql += ' AND (lower(orders.full_name) LIKE lower(?) OR lower(orders.phone) LIKE lower(?) OR lower(orders.email) LIKE lower(?) OR orders.id = ?)';
    countParams.push(`%${search}%`, `%${search}%`, `%${search}%`, parseInt(search) || 0); }
  const total = (await db.get(countSql, ...countParams)).c;

  const ordersWithItems = [];
  for (const o of orders) {
    ordersWithItems.push({ ...o, items: await db.all('SELECT * FROM order_items WHERE order_id = ?', o.id) });
  }

  res.json({
    orders: ordersWithItems,
    total,
    page,
    pages: Math.ceil(total / perPage),
  });
});

router.get('/orders/:id', orderAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid order ID.' });
  const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  const items = await db.all('SELECT oi.*, p.image FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id = ?', order.id);
  const history = await db.all(`SELECT h.*, u.username AS changed_by_name FROM order_status_history h
    LEFT JOIN users u ON u.id = h.changed_by WHERE h.order_id = ? ORDER BY h.id DESC`, order.id);
  const payment = await db.get(`SELECT payment_method, payment_status, transaction_id, paid_at, amount_paid, created_at
    FROM payments WHERE order_id = ?`, id) || { payment_method: order.payment_method, payment_status: 'pending', amount_paid: 0 };
  res.json({ order, payment, items, history });
});

router.get('/orders/:id/invoice', orderAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid order ID.' });
  const order = await db.get('SELECT * FROM orders WHERE id = ?', id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  const items = await db.all(`SELECT oi.name, oi.price, oi.quantity, p.sku
    FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id
    WHERE oi.order_id = ? ORDER BY oi.id`, id);
  await audit(req, 'downloaded invoice', 'order', id);
  sendInvoice(res, order, items);
});

router.put('/orders/:id/status', orderAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { status, note } = req.body || {};
  const valid = ['pending', 'processing', 'packed', 'shipped', 'delivered', 'cancelled', 'refunded'];
  if (!id || !valid.includes(status) || String(note || '').length > 2000) return res.status(400).json({ error: 'Invalid order status or note.' });
  const existing = await db.get('SELECT status FROM orders WHERE id = ?', id);
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  await db.transaction(async (tx) => {
    // Re-read under lock so the cancel/refund restock decision cannot race a
    // concurrent status change on PostgreSQL.
    const current = await tx.get(`SELECT status FROM orders WHERE id = ?${db.forUpdate()}`, id);
    await tx.run('UPDATE orders SET status = ? WHERE id = ?', status, id);
    if (['cancelled', 'refunded'].includes(status) && !['cancelled', 'refunded'].includes(current.status)) {
      const items = await tx.all('SELECT product_id, quantity FROM order_items WHERE order_id = ? AND product_id IS NOT NULL', id);
      for (const item of items) {
        await tx.run('UPDATE products SET stock = stock + ? WHERE id = ?', item.quantity, item.product_id);
        await tx.run('INSERT INTO inventory_movements (product_id, change, reason, note, changed_by) VALUES (?, ?, ?, ?, ?)',
          item.product_id, item.quantity, `Order #${id} ${status}`, String(note || ''), req.user.id);
      }
    }
    await tx.run('INSERT INTO order_status_history (order_id, status, note, changed_by) VALUES (?, ?, ?, ?)',
      id, status, String(note || ''), req.user.id);
  });
  await audit(req, 'updated status', 'order', id, `${existing.status} → ${status}`);
  // Notify user if they have an account
  const order = await db.get('SELECT user_id, full_name FROM orders WHERE id = ?', id);
  if (order && order.user_id) {
    await db.run('INSERT INTO notifications (user_id, title, body, type) VALUES (?, ?, ?, ?)',
      order.user_id, `Order #${id} updated`, `Status: ${status}`, 'order');
  }
  res.json({ ok: true });
});

router.put('/orders/:id/fulfillment', orderAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { carrier, tracking_number, shipping_status, shipping_notes, internal_notes } = req.body || {};
  if (!id) return res.status(400).json({ error: 'Invalid order ID.' });
  if (shipping_status !== undefined && !['pending', 'preparing', 'shipped', 'delivered', 'returned'].includes(String(shipping_status)))
    return res.status(400).json({ error: 'Invalid shipping status.' });
  const fields = [carrier, tracking_number, shipping_notes, internal_notes];
  if (fields.some(value => String(value || '').length > 2000)) return res.status(400).json({ error: 'Fulfillment details are too long.' });
  const order = await db.get('SELECT id FROM orders WHERE id = ?', id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  await db.run('UPDATE orders SET carrier = ?, tracking_number = ?, shipping_status = ?, shipping_notes = ?, internal_notes = ? WHERE id = ?',
    String(carrier || '').trim(), String(tracking_number || '').trim(), String(shipping_status || 'pending'), String(shipping_notes || '').trim(), String(internal_notes || '').trim(), id);
  await audit(req, 'updated fulfillment', 'order', id, String(tracking_number || 'No tracking number'));
  res.json({ ok: true });
});

/* ---------------- MARKETING ---------------- */
router.get('/coupons', owners, async (req, res) => {
  const coupons = await db.all(`SELECT id, code, discount_type, discount_value, minimum_order_amount, maximum_discount,
    usage_limit, usage_count, expires_at, is_active, created_at, updated_at FROM coupons ORDER BY id DESC`);
  res.json({ coupons });
});

router.post('/coupons', owners, async (req, res) => {
  const coupon = couponPayload(req.body);
  if (coupon.error) return res.status(400).json({ error: coupon.error });
  if (await db.get('SELECT id FROM coupons WHERE lower(code) = lower(?)', coupon.code)) return res.status(409).json({ error: 'Coupon code already exists.' });
  const result = await db.insert(`INSERT INTO coupons (code, discount_type, discount_value, minimum_order_amount, maximum_discount, usage_limit, expires_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, coupon.code, coupon.discountType, coupon.discountValue, coupon.minimumOrderAmount, coupon.maximumDiscount, coupon.usageLimit, coupon.expiresAt, coupon.isActive);
  await audit(req, 'created', 'coupon', result.id, coupon.code);
  res.status(201).json({ ok: true, id: Number(result.id) });
});

router.put('/coupons/:id', owners, async (req, res) => {
  const id = productId(req.params.id);
  const coupon = couponPayload(req.body);
  if (!id || coupon.error) return res.status(400).json({ error: coupon.error || 'Invalid coupon ID.' });
  if (!(await db.get('SELECT id FROM coupons WHERE id = ?', id))) return res.status(404).json({ error: 'Coupon not found.' });
  if (await db.get('SELECT id FROM coupons WHERE lower(code) = lower(?) AND id != ?', coupon.code, id)) return res.status(409).json({ error: 'Coupon code already exists.' });
  await db.run(`UPDATE coupons SET code = ?, discount_type = ?, discount_value = ?, minimum_order_amount = ?, maximum_discount = ?,
    usage_limit = ?, expires_at = ?, is_active = ?, updated_at = ? WHERE id = ?`,
    coupon.code, coupon.discountType, coupon.discountValue, coupon.minimumOrderAmount, coupon.maximumDiscount, coupon.usageLimit, coupon.expiresAt, coupon.isActive, db.utcNow(), id);
  await audit(req, 'updated', 'coupon', id, coupon.code);
  res.json({ ok: true });
});

router.delete('/coupons/:id', owners, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid coupon ID.' });
  const coupon = await db.get('SELECT code FROM coupons WHERE id = ?', id);
  if (!coupon) return res.status(404).json({ error: 'Coupon not found.' });
  await db.run('DELETE FROM coupons WHERE id = ?', id);
  await audit(req, 'deleted', 'coupon', id, coupon.code);
  res.json({ ok: true });
});

router.get('/promotional-banners', catalogAccess, async (req, res) => {
  res.json({ banners: await db.all('SELECT * FROM promotional_banners ORDER BY display_order ASC, id ASC') });
});

router.post('/promotional-banners', catalogAccess, async (req, res) => {
  const { image, title, description = '', button_text = '', button_url = '', is_active, display_order = 0, starts_at, ends_at } = req.body || {};
  const startsAt = optionalDateTime(starts_at);
  const endsAt = optionalDateTime(ends_at);
  const order = Number(display_order);
  if (!String(image || '').trim() || String(image).length > 2048 || !String(title || '').trim() || String(title).length > 160 ||
      String(description).length > 2000 || String(button_text).length > 80 || !validBannerUrl(button_url) || !Number.isSafeInteger(order) || order < 0 || startsAt === false || endsAt === false || (startsAt && endsAt && startsAt >= endsAt))
    return res.status(400).json({ error: 'Provide valid banner content, URL, order, and date range.' });
  const result = await db.insert(`INSERT INTO promotional_banners (image, title, description, button_text, button_url, is_active, display_order, starts_at, ends_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, String(image).trim(), String(title).trim(), String(description).trim(), String(button_text).trim(), String(button_url).trim(), is_active === false || is_active === 0 || is_active === '0' ? 0 : 1, order, startsAt, endsAt);
  await audit(req, 'created', 'promotional_banner', result.id, String(title).trim());
  res.status(201).json({ ok: true, id: Number(result.id) });
});

router.put('/promotional-banners/:id', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { image, title, description = '', button_text = '', button_url = '', is_active, display_order = 0, starts_at, ends_at } = req.body || {};
  const startsAt = optionalDateTime(starts_at);
  const endsAt = optionalDateTime(ends_at);
  const order = Number(display_order);
  if (!id || !String(image || '').trim() || String(image).length > 2048 || !String(title || '').trim() || String(title).length > 160 ||
      String(description).length > 2000 || String(button_text).length > 80 || !validBannerUrl(button_url) || !Number.isSafeInteger(order) || order < 0 || startsAt === false || endsAt === false || (startsAt && endsAt && startsAt >= endsAt))
    return res.status(400).json({ error: 'Provide valid banner content, URL, order, and date range.' });
  if (!(await db.get('SELECT id FROM promotional_banners WHERE id = ?', id))) return res.status(404).json({ error: 'Banner not found.' });
  await db.run(`UPDATE promotional_banners SET image = ?, title = ?, description = ?, button_text = ?, button_url = ?, is_active = ?,
    display_order = ?, starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?`,
    String(image).trim(), String(title).trim(), String(description).trim(), String(button_text).trim(), String(button_url).trim(), is_active === false || is_active === 0 || is_active === '0' ? 0 : 1, order, startsAt, endsAt, db.utcNow(), id);
  await audit(req, 'updated', 'promotional_banner', id, String(title).trim());
  res.json({ ok: true });
});

router.delete('/promotional-banners/:id', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid banner ID.' });
  const banner = await db.get('SELECT title FROM promotional_banners WHERE id = ?', id);
  if (!banner) return res.status(404).json({ error: 'Banner not found.' });
  await db.run('DELETE FROM promotional_banners WHERE id = ?', id);
  await audit(req, 'deleted', 'promotional_banner', id, banner.title);
  res.json({ ok: true });
});

/* ---------------- PRODUCTS ---------------- */
router.get('/products', catalogAccess, async (req, res) => {
  const { search, category } = req.query;
  let sql = 'SELECT p.*, c.name AS category_name FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE 1=1';
  const params = [];
  if (search) { sql += ' AND (lower(p.name) LIKE lower(?) OR lower(p.slug) LIKE lower(?) OR lower(p.sku) LIKE lower(?))'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (category) { sql += ' AND (p.category_id = ? OR p.category = ?)'; params.push(productId(category) || 0, category); }
  sql += ' ORDER BY p.id DESC';
  const products = await db.all(sql, ...params);
  res.json({ products });
});

router.post('/products/bulk', catalogAccess, async (req, res) => {
  const body = req.body || {};
  const ids = body.ids;
  const requestedAction = String(body.action || '').toLowerCase();
  const action = ({ enable: 'status', disable: 'status', mark_featured: 'featured', remove_featured: 'featured', update_category: 'category', update_stock: 'adjust_stock', stock_adjustment: 'adjust_stock' })[requestedAction] || requestedAction;
  if (!Array.isArray(ids) || !ids.length || ids.length > 500 || ids.some(id => !productId(id)))
    return res.status(400).json({ error: 'Provide between 1 and 500 valid product IDs.' });
  const productIds = ids.map(Number);
  if (new Set(productIds).size !== productIds.length) return res.status(400).json({ error: 'Product IDs must not be repeated.' });
  if (!['delete', 'status', 'featured', 'category', 'adjust_stock'].includes(action)) return res.status(400).json({ error: 'Invalid bulk action.' });
  if (action === 'delete' && body.confirm !== true) return res.status(400).json({ error: 'Bulk deletion requires confirm: true.' });

  const placeholders = productIds.map(() => '?').join(', ');
  const products = await db.all(`SELECT id, name, stock FROM products WHERE id IN (${placeholders})`, ...productIds);
  if (products.length !== productIds.length) return res.status(404).json({ error: 'One or more selected products were not found.' });

  let status;
  let featured;
  let category;
  let adjustment;
  let reason;
  let note;
  if (action === 'status') {
    status = requestedAction === 'enable' ? 'active' : requestedAction === 'disable' ? 'inactive' : String(body.status || '').toLowerCase();
    if (!['active', 'inactive', 'draft'].includes(status)) return res.status(400).json({ error: 'Choose an active, inactive, or draft status.' });
  } else if (action === 'featured') {
    if (requestedAction === 'mark_featured') featured = 1;
    else if (requestedAction === 'remove_featured') featured = 0;
    else if (typeof body.featured === 'boolean') featured = body.featured ? 1 : 0;
    else return res.status(400).json({ error: 'Featured must be a boolean.' });
  } else if (action === 'category') {
    category = await getCategory(body.category_id);
    if (!category) return res.status(400).json({ error: 'Choose an active category.' });
  } else if (action === 'adjust_stock') {
    adjustment = Number(body.change ?? body.stock_change);
    reason = String(body.reason || '').trim();
    note = String(body.note || '').trim().slice(0, 1000);
    if (!Number.isSafeInteger(adjustment) || !adjustment || Math.abs(adjustment) > 1000000 || !reason || reason.length > 255)
      return res.status(400).json({ error: 'Provide a non-zero whole stock adjustment, within 1,000,000 units, and a reason.' });
    if (products.some(product => product.stock + adjustment < 0)) return res.status(400).json({ error: 'This adjustment would make one or more product stocks negative.' });
  } else if (action === 'delete') {
    const inCart = (await db.get(`SELECT COUNT(*) AS count FROM carts WHERE product_id IN (${placeholders})`, ...productIds)).count;
    if (inCart) return res.status(409).json({ error: 'Cannot delete selected products while any are in a cart. Set them inactive instead.' });
  }

  try {
    await db.transaction(async (tx) => {
      const logAudit = (actionText, product, details) => tx.run(
        'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
        req.user.id, actionText, 'product', String(product.id), details);
      if (action === 'delete') {
        await tx.run(`DELETE FROM products WHERE id IN (${placeholders})`, ...productIds);
        for (const product of products) await logAudit('bulk deleted', product, product.name);
      } else if (action === 'status') {
        await tx.run(`UPDATE products SET status = ? WHERE id IN (${placeholders})`, status, ...productIds);
        for (const product of products) await logAudit('bulk set status', product, status);
      } else if (action === 'featured') {
        await tx.run(`UPDATE products SET featured = ? WHERE id IN (${placeholders})`, featured, ...productIds);
        for (const product of products) await logAudit(featured ? 'bulk marked featured' : 'bulk removed featured', product, '');
      } else if (action === 'category') {
        await tx.run(`UPDATE products SET category_id = ?, category = ? WHERE id IN (${placeholders})`, category.id, category.name, ...productIds);
        for (const product of products) await logAudit('bulk set category', product, category.name);
      } else {
        for (const product of products) {
          // Conditional guard: the pre-check above can race a concurrent
          // checkout on PostgreSQL, so the database re-validates per row.
          const updated = await tx.run('UPDATE products SET stock = stock + ? WHERE id = ? AND stock + ? >= 0',
            adjustment, product.id, adjustment);
          if (updated.changes !== 1) throw new Error('This adjustment would make one or more product stocks negative.');
          await tx.run('INSERT INTO inventory_movements (product_id, change, reason, note, changed_by) VALUES (?, ?, ?, ?, ?)',
            product.id, adjustment, reason, note, req.user.id);
          await logAudit('bulk adjusted inventory', product, `${product.name}: ${adjustment > 0 ? '+' : ''}${adjustment}; ${reason}`);
        }
      }
    });
  } catch (error) {
    if (error.message === 'This adjustment would make one or more product stocks negative.')
      return res.status(400).json({ error: error.message });
    throw error;
  }
  res.json({ ok: true, count: productIds.length });
});

router.get('/products/export', catalogAccess, async (req, res) => {
  const products = await db.all(`SELECT p.id, p.name, p.slug, p.sku, p.price, p.old_price, COALESCE(c.name, p.category, '') AS category,
    p.category_id, p.stock, p.reorder_threshold, p.status, p.featured, p.flash_sale, p.badge, p.brand, p.description, p.image
    FROM products p LEFT JOIN categories c ON c.id = p.category_id ORDER BY p.id`);
  const headers = ['id', 'name', 'slug', 'sku', 'price', 'old_price', 'category', 'category_id', 'stock', 'reorder_threshold', 'status', 'featured', 'flash_sale', 'badge', 'brand', 'description', 'image'];
  const csv = [headers.join(','), ...products.map(product => headers.map(header => csvEscape(product[header])).join(','))].join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="products.csv"', 'Cache-Control': 'no-store' });
  res.send(`﻿${csv}\r\n`);
});

router.post('/products/import', catalogAccess, async (req, res) => {
  try {
    const csv = typeof req.body === 'string' ? req.body : req.body && req.body.csv;
    const rows = parseCsv(csv);
    const allowedHeaders = new Set(['id', 'name', 'slug', 'sku', 'price', 'old_price', 'category', 'category_id', 'stock', 'reorder_threshold', 'status', 'featured', 'flash_sale', 'badge', 'brand', 'description', 'image']);
    const unknownHeaders = Object.keys(rows[0]).filter(header => !allowedHeaders.has(header));
    if (unknownHeaders.length) return res.status(400).json({ error: `Unsupported CSV columns: ${unknownHeaders.join(', ')}.` });
    const seen = { id: new Set(), slug: new Set(), sku: new Set() };
    const validationErrors = [];
    const products = [];
    for (const [index, row] of rows.entries()) {
      try { products.push(await importProductRow(row, index + 2, seen)); }
      catch (error) { validationErrors.push(error.message); }
    }
    if (validationErrors.length) return res.status(400).json({ error: 'CSV validation failed.', errors: validationErrors });

    const conflicts = [];
    for (const product of products) {
      if (product.id && await db.get('SELECT id FROM products WHERE id = ?', product.id)) conflicts.push(`Row with id ${product.id} already exists.`);
      if (await db.get('SELECT id FROM products WHERE slug = ?', product.slug)) conflicts.push(`Slug "${product.slug}" already exists.`);
      if (product.sku && await db.get('SELECT id FROM products WHERE LOWER(sku) = ?', product.sku.toLowerCase())) conflicts.push(`SKU "${product.sku}" already exists.`);
    }
    if (conflicts.length) return res.status(409).json({ error: 'CSV would create duplicate products.', errors: conflicts });

    await db.transaction(async (tx) => {
      for (const product of products) {
        let id = product.id;
        if (id) {
          await tx.run(`INSERT INTO products (id, slug, name, description, price, old_price, image, category, category_id, badge, stock, featured, flash_sale, reorder_threshold, sku, status, brand)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            product.id, product.slug, product.name, product.description, product.price, product.oldPrice, product.image,
            product.category ? product.category.name : 'GoPro Accessories', product.category && product.category.id, product.badge, product.stock,
            product.featured, product.flashSale, product.reorderThreshold, product.sku, product.status, product.brand);
        } else {
          const inserted = await tx.insert(`INSERT INTO products (slug, name, description, price, old_price, image, category, category_id, badge, stock, featured, flash_sale, reorder_threshold, sku, status, brand)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            product.slug, product.name, product.description, product.price, product.oldPrice, product.image,
            product.category ? product.category.name : 'GoPro Accessories', product.category && product.category.id, product.badge, product.stock,
            product.featured, product.flashSale, product.reorderThreshold, product.sku, product.status, product.brand);
          id = inserted.id;
        }
        await tx.run('INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary) VALUES (?, ?, ?, ?, 0, 1)',
          id, product.image, 'image/*', path.basename(product.image));
        if (product.stock) await tx.run('INSERT INTO inventory_movements (product_id, change, reason, note, changed_by) VALUES (?, ?, ?, ?, ?)',
          id, product.stock, 'CSV import', 'Initial imported stock', req.user.id);
        await tx.run('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, ?, ?)',
          req.user.id, 'imported', 'product', String(id), product.name);
      }
    });
    await repairIdentitySequence('products');
    res.status(201).json({ ok: true, count: products.length });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Invalid CSV document.' });
  }
});

router.post('/products', catalogAccess, async (req, res) => {
  const { name, slug, price, old_price, image, description, category_id, badge, stock, featured, flash_sale, sku, status, brand } = req.body || {};
  const category = category_id == null || category_id === '' ? null : await getCategory(category_id);
  if (!String(name || '').trim() || !validSlug(slug) || !Number.isFinite(Number(price)) || Number(price) < 0)
    return res.status(400).json({ error: 'Name, URL-safe slug, and a non-negative price are required.' });
  if (category_id != null && category_id !== '' && !category) return res.status(400).json({ error: 'Choose an active category.' });
  if (!['active', 'inactive', 'draft'].includes(String(status || 'active'))) return res.status(400).json({ error: 'Invalid product status.' });
  const cleanSku = String(sku || '').trim() || null;
  if (cleanSku && cleanSku.length > 100) return res.status(400).json({ error: 'SKU is too long.' });
  const existing = await db.get('SELECT id FROM products WHERE slug = ? OR (sku IS NOT NULL AND sku = ?)', slug, cleanSku || '');
  if (existing) return res.status(409).json({ error: 'A product with this slug already exists.' });
  const id = await db.transaction(async (tx) => {
    const result = await tx.insert(`INSERT INTO products (slug, name, description, price, old_price, image, category, category_id, badge, stock, featured, flash_sale, sku, status, brand)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      String(slug).trim(), String(name).trim(), String(description || '').trim(), Number(price), old_price == null || old_price === '' ? null : Number(old_price),
      String(image || DEFAULT_PRODUCT_IMAGE).trim(), category ? category.name : 'GoPro Accessories', category && category.id, badge || null,
      Math.max(0, Number.parseInt(stock, 10) || 0), featured ? 1 : 0, flash_sale ? 1 : 0, cleanSku, String(status || 'active'), String(brand || '').trim());
    const newId = Number(result.id);
    await tx.run(`INSERT INTO product_images (product_id, image_data, mime_type, file_name, is_primary)
      VALUES (?, ?, ?, ?, 1)`, newId, String(image || DEFAULT_PRODUCT_IMAGE).trim(), 'image/*', 'legacy-image');
    return newId;
  });
  await audit(req, 'created', 'product', id, name);
  res.status(201).json({ ok: true, id });
});

router.put('/products/:id', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { name, slug, price, old_price, image, description, category_id, badge, stock, featured, flash_sale, rating, reorder_threshold, sku, status, brand } = req.body || {};
  const current = id && await db.get('SELECT * FROM products WHERE id = ?', id);
  if (!current) return res.status(404).json({ error: 'Product not found.' });
  const category = category_id == null || category_id === '' ? null : await getCategory(category_id);
  if (!String(name || '').trim() || !validSlug(slug) || !Number.isFinite(Number(price)) || Number(price) < 0)
    return res.status(400).json({ error: 'Name, URL-safe slug, and a non-negative price are required.' });
  if (category_id != null && category_id !== '' && !category) return res.status(400).json({ error: 'Choose an active category.' });
  if (!['active', 'inactive', 'draft'].includes(String(status || 'active'))) return res.status(400).json({ error: 'Invalid product status.' });
  const cleanSku = String(sku || '').trim() || null;
  if (cleanSku && cleanSku.length > 100) return res.status(400).json({ error: 'SKU is too long.' });
  const duplicate = await db.get('SELECT id FROM products WHERE (slug = ? OR (sku IS NOT NULL AND sku = ?)) AND id != ?', slug, cleanSku || '', id);
  if (duplicate) return res.status(409).json({ error: 'Another product already uses this slug or SKU.' });
  await db.transaction(async (tx) => {
    await tx.run(`UPDATE products SET
      name = ?, slug = ?, description = ?, price = ?, old_price = ?, image = ?,
      category = ?, category_id = ?, badge = ?, stock = ?, featured = ?, flash_sale = ?, rating = ?, reorder_threshold = ?, sku = ?, status = ?, brand = ?
      WHERE id = ?`,
      String(name).trim(), String(slug).trim(), String(description || '').trim(), Number(price), old_price == null || old_price === '' ? null : Number(old_price),
      String(image || current.image).trim(), category ? category.name : 'GoPro Accessories', category && category.id, badge || null, stock != null ? Math.max(0, Number.parseInt(stock, 10) || 0) : current.stock,
      featured ? 1 : 0, flash_sale ? 1 : 0, Number(rating) || 0, Math.max(0, Number(reorder_threshold) || 0), cleanSku, String(status || 'active'), String(brand || '').trim(), id);
    if (image && image !== current.image) {
      await tx.run('UPDATE product_images SET is_primary = 0 WHERE product_id = ?', id);
      await tx.run(`INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary)
        VALUES (?, ?, 'image/*', 'legacy-image', COALESCE((SELECT MAX(sort_order) + 1 FROM product_images WHERE product_id = ?), 0), 1)`,
        id, String(image).trim(), id);
    }
  });
  await audit(req, 'updated', 'product', id, name);
  res.json({ ok: true });
});

router.get('/products/:id/images', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id || !(await db.get('SELECT id FROM products WHERE id = ?', id))) return res.status(404).json({ error: 'Product not found.' });
  const images = await db.all(`SELECT id, image_data, mime_type, file_name, sort_order, is_primary, created_at
    FROM product_images WHERE product_id = ? ORDER BY sort_order, id`, id);
  res.json({ images });
});

router.post('/products/:id/images', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { data, file_name, is_primary } = req.body || {};
  if (!id || !(await db.get('SELECT id FROM products WHERE id = ?', id))) return res.status(404).json({ error: 'Product not found.' });
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(data || ''));
  if (!match || !validImageTypes.has(match[1])) return res.status(400).json({ error: 'Upload a PNG, JPEG, WebP, or GIF image encoded as base64.' });
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 5 * 1024 * 1024 || bytes.toString('base64') !== match[2])
    return res.status(400).json({ error: 'Image data is invalid or exceeds the 5 MB limit.' });
  const count = (await db.get('SELECT COUNT(*) AS count FROM product_images WHERE product_id = ?', id)).count;
  const cleanFileName = path.basename(String(file_name || 'upload')).slice(0, 255);
  let imageId;
  await db.transaction(async (tx) => {
    if (is_primary || count === 0) await tx.run('UPDATE product_images SET is_primary = 0 WHERE product_id = ?', id);
    const result = await tx.insert(`INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary)
      VALUES (?, ?, ?, ?, ?, ?)`,
      id, `data:${match[1]};base64,${match[2]}`, match[1], cleanFileName, count, is_primary || count === 0 ? 1 : 0);
    imageId = Number(result.id);
    if (is_primary || count === 0) await setPrimaryImage(tx, id, imageId);
  });
  await audit(req, 'uploaded image', 'product', id, cleanFileName);
  res.status(201).json({ ok: true, id: imageId });
});

router.put('/products/:id/images/:imageId/primary', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const imageId = productId(req.params.imageId);
  if (!id || !imageId) return res.status(400).json({ error: 'Invalid product or image id.' });
  let image;
  await db.transaction(async (tx) => { image = await setPrimaryImage(tx, id, imageId); });
  if (!image) return res.status(404).json({ error: 'Product image not found.' });
  await audit(req, 'set primary image', 'product', id, image.file_name || imageId);
  res.json({ ok: true });
});

router.put('/products/:id/images/reorder', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const ids = req.body && req.body.image_ids;
  if (!id || !Array.isArray(ids) || !ids.length || ids.some(imageId => !productId(imageId)))
    return res.status(400).json({ error: 'Provide an ordered list of image ids.' });
  const uniqueIds = [...new Set(ids.map(Number))];
  const images = await db.all('SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order, id', id);
  if (uniqueIds.length !== images.length || uniqueIds.some(imageId => !images.some(image => image.id === imageId)))
    return res.status(400).json({ error: 'The image order must include every image exactly once.' });
  await db.transaction(async (tx) => {
    for (const [index, imageId] of uniqueIds.entries()) {
      await tx.run('UPDATE product_images SET sort_order = ? WHERE id = ? AND product_id = ?', index, imageId, id);
    }
  });
  await audit(req, 'reordered images', 'product', id);
  res.json({ ok: true });
});

router.delete('/products/:id/images/:imageId', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const imageId = productId(req.params.imageId);
  if (!id || !imageId) return res.status(400).json({ error: 'Invalid product or image id.' });
  const image = await db.get('SELECT id, is_primary FROM product_images WHERE id = ? AND product_id = ?', imageId, id);
  if (!image) return res.status(404).json({ error: 'Product image not found.' });
  const images = await db.all('SELECT id FROM product_images WHERE product_id = ? ORDER BY sort_order, id', id);
  if (images.length === 1) return res.status(409).json({ error: 'A product must retain one image. Upload a replacement before deleting this image.' });
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM product_images WHERE id = ?', imageId);
    if (image.is_primary) await setPrimaryImage(tx, id, images.find(candidate => candidate.id !== imageId).id);
  });
  await audit(req, 'deleted image', 'product', id, imageId);
  res.json({ ok: true });
});

router.delete('/products/:id', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid product ID.' });
  const product = await db.get('SELECT id, name FROM products WHERE id = ?', id);
  if (!product) return res.status(404).json({ error: 'Product not found.' });
  const inCart = (await db.get('SELECT COUNT(*) c FROM carts WHERE product_id = ?', id)).c;
  if (inCart) return res.status(400).json({ error: 'Cannot delete: product is in someone\'s cart. Remove it from carts first or set stock to 0.' });
  await db.run('DELETE FROM products WHERE id = ?', id);
  await audit(req, 'deleted', 'product', id, product.name);
  res.json({ ok: true });
});

/* ---------------- INVENTORY ---------------- */
router.get('/inventory', catalogAccess, async (req, res) => {
  const products = await db.all(`SELECT p.id, p.name, p.image, p.sku, p.stock, p.reorder_threshold
    FROM products p ORDER BY stock ASC, name`);
  const lastUpdates = new Map();
  if (products.length) {
    const placeholders = products.map(() => '?').join(',');
    const rows = await db.all(`SELECT product_id, MAX(created_at) AS last_stock_update
      FROM inventory_movements WHERE product_id IN (${placeholders}) GROUP BY product_id`,
      ...products.map((p) => p.id));
    for (const row of rows) lastUpdates.set(Number(row.product_id), row.last_stock_update);
  }
  for (const product of products) product.last_stock_update = lastUpdates.get(Number(product.id)) || null;
  const movements = await db.all(`SELECT m.*, p.name AS product_name, u.username AS changed_by_name FROM inventory_movements m
    JOIN products p ON p.id = m.product_id LEFT JOIN users u ON u.id = m.changed_by ORDER BY m.id DESC LIMIT 50`);
  res.json({ products, movements });
});

router.post('/inventory/:id/adjust', catalogAccess, async (req, res) => {
  const id = productId(req.params.id);
  const { change, mode, reason, note } = req.body || {};
  const requested = Number(change);
  if (!id || !Number.isSafeInteger(requested) || !['set', 'adjust'].includes(mode) || (mode !== 'set' && requested === 0))
    return res.status(400).json({ error: 'Enter a valid whole stock adjustment.' });
  if (!String(reason || '').trim() || String(reason).trim().length > 200 || String(note || '').trim().length > 2000)
    return res.status(400).json({ error: 'Provide a stock reason and an optional note within the allowed length.' });
  // Read-modify-write under one locked transaction so concurrent adjustments
  // and checkouts cannot interleave on PostgreSQL.
  const outcome = await db.transaction(async (tx) => {
    const product = await tx.get(`SELECT id, name, stock FROM products WHERE id = ?${db.forUpdate()}`, id);
    if (!product) return { missing: true };
    const amount = mode === 'set' ? requested - product.stock : requested;
    if (product.stock + amount < 0 || product.stock + amount > 1000000) return { invalid: true };
    await tx.run('UPDATE products SET stock = stock + ? WHERE id = ?', amount, product.id);
    await tx.run('INSERT INTO inventory_movements (product_id, change, reason, note, changed_by) VALUES (?, ?, ?, ?, ?)',
      product.id, amount, String(reason).trim(), String(note || '').trim(), req.user.id);
    return { ok: true, product, amount };
  });
  if (outcome.missing) return res.status(404).json({ error: 'Product not found' });
  if (outcome.invalid) return res.status(400).json({ error: 'Stock must be between zero and 1,000,000.' });
  await audit(req, 'adjusted inventory', 'product', outcome.product.id, `${outcome.product.name}: ${outcome.amount > 0 ? '+' : ''}${outcome.amount}`);
  res.json({ ok: true });
});

/* ---------------- ADMIN NOTIFICATIONS ---------------- */
router.get('/notifications', async (req, res) => {
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 50));
  const read = String(req.query.read || 'all');
  if (!['all', 'true', 'false', '1', '0'].includes(read)) return res.status(400).json({ error: 'Invalid read filter.' });
  const where = read === 'all' ? '' : ' WHERE read = ?';
  const params = read === 'all' ? [] : [read === 'true' || read === '1' ? 1 : 0];
  const total = (await db.get(`SELECT COUNT(*) AS count FROM admin_notifications${where}`, ...params)).count;
  const notifications = await db.all(`SELECT id, type, title, body, entity_type, entity_id, read, created_at
    FROM admin_notifications${where} ORDER BY id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  const unread = (await db.get('SELECT COUNT(*) AS count FROM admin_notifications WHERE read = 0')).count;
  res.json({ notifications, unread, total, page, pages: Math.ceil(total / limit) });
});

router.put('/notifications/:id/read', async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid notification ID.' });
  const updated = await db.run('UPDATE admin_notifications SET read = 1 WHERE id = ?', id);
  if (!updated.changes) return res.status(404).json({ error: 'Notification not found.' });
  res.json({ ok: true });
});

router.post('/notifications/read', async (req, res) => {
  await db.run('UPDATE admin_notifications SET read = 1 WHERE read = 0');
  res.json({ ok: true });
});

/* ---------------- USERS ---------------- */
router.get('/users', owners, async (req, res) => {
  const { search } = req.query;
  let sql = `SELECT id, username, email, full_name, phone, role, created_at,
    'active' AS account_status
    FROM users WHERE 1=1`;
  const params = [];
  if (search) { sql += ' AND (lower(username) LIKE lower(?) OR lower(email) LIKE lower(?) OR lower(full_name) LIKE lower(?))';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY id DESC';
  const users = await db.all(sql, ...params);
  const summaries = await orderSummariesFor(users.map((u) => u.id));
  for (const user of users) {
    const summary = summaries.get(Number(user.id));
    user.order_count = summary ? Number(summary.order_count) : 0;
    user.total_spent = summary ? Number(summary.total_spent) : 0;
    user.last_order_date = summary ? summary.last_order_date : null;
  }
  res.json({ users });
});

router.get('/customers', owners, async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 100);
  let sql = `SELECT id, username, email, full_name, phone, created_at, 'active' AS account_status
    FROM users WHERE role = 'customer'`;
  const params = [];
  if (search) {
    sql += ' AND (lower(username) LIKE lower(?) OR lower(email) LIKE lower(?) OR lower(full_name) LIKE lower(?) OR lower(phone) LIKE lower(?))';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  sql += ' ORDER BY created_at DESC, id DESC';
  const customers = await db.all(sql, ...params);
  const summaries = await orderSummariesFor(customers.map((u) => u.id));
  for (const customer of customers) {
    const summary = summaries.get(Number(customer.id));
    customer.order_count = summary ? Number(summary.order_count) : 0;
    customer.total_spent = summary ? Number(summary.total_spent) : 0;
    customer.last_order_date = summary ? summary.last_order_date : null;
  }
  res.json({ customers });
});

router.get('/customers/:id', owners, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid customer id.' });
  const customer = await db.get(`SELECT id, username, email, full_name, phone, address, avatar, created_at,
    'active' AS account_status FROM users WHERE id = ? AND role = 'customer'`, id);
  if (!customer) return res.status(404).json({ error: 'Customer not found.' });
  const summary = await db.get(`SELECT COUNT(*) AS total_orders, COALESCE(SUM(CASE WHEN ${SALES_ORDER_FILTER}
    THEN total ELSE 0 END), 0) AS total_spent, MAX(created_at) AS last_order_date
    FROM orders WHERE user_id = ?`, id);
  const orders = await db.all(`SELECT o.id, o.created_at, o.status, o.payment_method, o.subtotal, o.shipping_fee, o.total
    FROM orders o WHERE o.user_id = ? ORDER BY o.created_at DESC, o.id DESC`, id);
  const counts = await itemCountsFor(orders.map((o) => o.id));
  for (const order of orders) order.item_count = counts.get(Number(order.id)) || 0;
  res.json({ customer, summary, orders, recent_orders: orders.slice(0, 10) });
});

router.put('/users/:id/role', ownerOnly, async (req, res) => {
  const id = productId(req.params.id);
  const { role } = req.body || {};
  const user = id && await db.get('SELECT id, role, is_active FROM users WHERE id = ?', id);
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (!['customer', ...ADMIN_ROLES].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
  if (id === req.user.id && role !== req.user.role) return res.status(400).json({ error: 'You cannot change your own role.' });
  if (await wouldRemoveLastOwner(user, role, user.is_active)) return res.status(400).json({ error: 'The final active owner cannot be demoted.' });
  await db.run('UPDATE users SET role = ? WHERE id = ?', role, id);
  await audit(req, 'changed role', 'user', id, role);
  res.json({ ok: true });
});

router.get('/audit-logs', owners, async (req, res) => {
  const actorId = req.query.admin === undefined ? null : productId(req.query.admin);
  const action = String(req.query.action || '').trim();
  const entityType = String(req.query.entity_type || req.query.entity || '').trim();
  const startDate = req.query.start_date || req.query.date_from;
  const endDate = req.query.end_date || req.query.date_to;
  const page = Math.max(1, Math.min(100000, Number.parseInt(req.query.page, 10) || 1));
  const limit = Math.max(1, Math.min(100, Number.parseInt(req.query.limit, 10) || 100));
  if ((req.query.admin !== undefined && !actorId) || action.length > 100 || entityType.length > 100 ||
      (startDate && !dateOnly(startDate)) || (endDate && !dateOnly(endDate)) || (startDate && endDate && startDate > endDate))
    return res.status(400).json({ error: 'Invalid activity log filters.' });
  const clauses = [];
  const params = [];
  if (actorId) { clauses.push('l.actor_id = ?'); params.push(actorId); }
  if (action) { clauses.push('l.action = ?'); params.push(action); }
  if (entityType) { clauses.push('l.entity_type = ?'); params.push(entityType); }
  if (startDate) { clauses.push('l.created_at >= ?'); params.push(`${startDate} 00:00:00`); }
  if (endDate) { clauses.push('l.created_at < ?'); params.push(`${addUtcDays(endDate, 1)} 00:00:00`); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const total = (await db.get(`SELECT COUNT(*) AS count FROM audit_logs l${where}`, ...params)).count;
  const logs = await db.all(`SELECT l.id, l.actor_id, l.action, l.entity_type, l.entity_id, l.details, l.created_at,
    u.username AS actor_name FROM audit_logs l LEFT JOIN users u ON u.id = l.actor_id${where}
    ORDER BY l.id DESC LIMIT ? OFFSET ?`, ...params, limit, (page - 1) * limit);
  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
});

/* ---------------- ADMIN USERS ---------------- */
router.get('/admin-users', ownerOnly, async (req, res) => {
  const users = await db.all(`SELECT id, username, email, full_name, phone, role, is_active, created_at
    FROM users WHERE role IN ('owner', 'admin', 'order_manager', 'catalog_manager', 'support')
    ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, id ASC`);
  res.json({ users });
});

router.post('/admin-users', ownerOnly, async (req, res) => {
  const account = adminUserPayload(req.body, { creating: true });
  if (account.error) return res.status(400).json({ error: account.error });
  const conflict = await db.get('SELECT id FROM users WHERE username = ? OR email = ?', account.username, account.email);
  if (conflict) return res.status(409).json({ error: 'Username or email is already in use.' });
  const result = await db.insert(`INSERT INTO users (username, email, password_hash, full_name, phone, role, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, account.username, account.email, bcrypt.hashSync(account.password, 10), account.fullName, account.phone, account.role, account.isActive);
  await audit(req, 'created', 'admin_user', result.id, account.role);
  res.status(201).json({ ok: true, id: result.id });
});

router.put('/admin-users/:id', ownerOnly, async (req, res) => {
  const id = productId(req.params.id);
  const account = adminUserPayload(req.body);
  const user = id && await db.get('SELECT id, role, is_active FROM users WHERE id = ?', id);
  if (!user || !ADMIN_ROLES.has(user.role)) return res.status(404).json({ error: 'Admin user not found.' });
  if (account.error) return res.status(400).json({ error: account.error });
  if (id === req.user.id && (account.role !== user.role || account.isActive !== 1)) return res.status(400).json({ error: 'You cannot change your own role or disable your own account.' });
  if (await wouldRemoveLastOwner(user, account.role, account.isActive)) return res.status(400).json({ error: 'The final active owner cannot be disabled or demoted.' });
  const conflict = await db.get('SELECT id FROM users WHERE (username = ? OR email = ?) AND id != ?', account.username, account.email, id);
  if (conflict) return res.status(409).json({ error: 'Username or email is already in use.' });
  if (account.password === undefined) {
    await db.run('UPDATE users SET username = ?, email = ?, full_name = ?, phone = ?, role = ?, is_active = ? WHERE id = ?',
      account.username, account.email, account.fullName, account.phone, account.role, account.isActive, id);
  } else {
    await db.run('UPDATE users SET username = ?, email = ?, full_name = ?, phone = ?, role = ?, is_active = ?, password_hash = ? WHERE id = ?',
      account.username, account.email, account.fullName, account.phone, account.role, account.isActive, bcrypt.hashSync(account.password, 10), id);
  }
  await audit(req, 'updated', 'admin_user', id, account.role);
  res.json({ ok: true });
});

router.put('/admin-users/:id/enabled', ownerOnly, async (req, res) => {
  const id = productId(req.params.id);
  const isActive = req.body && (req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === '1') ? 1 : 0;
  if (!id || !req.body || !Object.prototype.hasOwnProperty.call(req.body, 'is_active')) return res.status(400).json({ error: 'Provide an account status.' });
  const user = await db.get('SELECT id, role, is_active FROM users WHERE id = ?', id);
  if (!user || !ADMIN_ROLES.has(user.role)) return res.status(404).json({ error: 'Admin user not found.' });
  if (id === req.user.id && !isActive) return res.status(400).json({ error: 'You cannot disable your own account.' });
  if (await wouldRemoveLastOwner(user, user.role, isActive)) return res.status(400).json({ error: 'The final active owner cannot be disabled.' });
  await db.run('UPDATE users SET is_active = ? WHERE id = ?', isActive, id);
  await audit(req, isActive ? 'enabled' : 'disabled', 'admin_user', id, user.role);
  res.json({ ok: true });
});

/* ---------------- CONTACT MESSAGES ---------------- */
router.get('/messages', supportAccess, async (req, res) => {
  const messages = await db.all('SELECT * FROM contact_messages ORDER BY id DESC');
  res.json({ messages });
});

router.put('/messages/:id/read', supportAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid message ID.' });
  if (!(await db.get('SELECT id FROM contact_messages WHERE id = ?', id))) return res.status(404).json({ error: 'Message not found.' });
  const markRead = db.engine === 'postgres'
    ? 'INSERT INTO read_messages (contact_message_id) VALUES (?) ON CONFLICT DO NOTHING'
    : 'INSERT OR IGNORE INTO read_messages (contact_message_id) VALUES (?)';
  await db.run(markRead, id);
  await audit(req, 'marked read', 'contact_message', id);
  res.json({ ok: true });
});

/* ---------------- VENDOR APPLICATIONS ---------------- */
router.get('/vendors', owners, async (req, res) => {
  const vendors = await db.all(`
    SELECT v.*, u.username, u.email
    FROM vendor_applications v LEFT JOIN users u ON u.id = v.user_id
    ORDER BY v.id DESC`);
  res.json({ vendors });
});

router.put('/vendors/:id/status', owners, async (req, res) => {
  const id = productId(req.params.id);
  const { status } = req.body || {};
  if (!id || !['pending', 'approved', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid vendor status.' });
  const updated = await db.run('UPDATE vendor_applications SET status = ? WHERE id = ?', status, id);
  if (!updated.changes) return res.status(404).json({ error: 'Vendor application not found.' });
  await audit(req, 'updated status', 'vendor_application', id, status);
  res.json({ ok: true });
});

/* ---------------- REVIEWS ---------------- */
router.get('/reviews', supportAccess, async (req, res) => {
  const reviews = await db.all(`
    SELECT r.*, p.name AS product_name, u.username
    FROM reviews r
    JOIN products p ON p.id = r.product_id
    JOIN users u ON u.id = r.user_id
    ORDER BY r.id DESC`);
  res.json({ reviews });
});

router.delete('/reviews/:id', supportAccess, async (req, res) => {
  const id = productId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid review ID.' });
  const review = await db.get('SELECT id, product_id FROM reviews WHERE id = ?', id);
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  await db.transaction(async (tx) => {
    await tx.run('DELETE FROM reviews WHERE id = ?', id);
    const aggregate = await tx.get('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE product_id = ? AND is_visible = 1', review.product_id);
    await tx.run('UPDATE products SET rating = ?, rating_count = ? WHERE id = ?',
      aggregate.count ? Math.round(aggregate.average * 10) / 10 : 0, aggregate.count, review.product_id);
  });
  await audit(req, 'deleted', 'review', id, review.product_id);
  res.json({ ok: true });
});

router.put('/reviews/:id/visibility', supportAccess, async (req, res) => {
  const id = productId(req.params.id);
  const isVisible = req.body && (req.body.is_visible === true || req.body.is_visible === false)
    ? Number(req.body.is_visible) : null;
  if (!id || isVisible === null) return res.status(400).json({ error: 'Provide a valid review visibility value.' });
  const review = await db.get('SELECT id, product_id FROM reviews WHERE id = ?', id);
  if (!review) return res.status(404).json({ error: 'Review not found.' });
  await db.transaction(async (tx) => {
    await tx.run('UPDATE reviews SET is_visible = ? WHERE id = ?', isVisible, id);
    const aggregate = await tx.get('SELECT AVG(rating) AS average, COUNT(*) AS count FROM reviews WHERE product_id = ? AND is_visible = 1', review.product_id);
    await tx.run('UPDATE products SET rating = ?, rating_count = ? WHERE id = ?',
      aggregate.count ? Math.round(aggregate.average * 10) / 10 : 0, aggregate.count, review.product_id);
  });
  await audit(req, isVisible ? 'published' : 'hidden', 'review', id, review.product_id);
  res.json({ ok: true, is_visible: Boolean(isVisible) });
});

module.exports = router;
