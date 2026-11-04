const db = require('./database');

const EVENT_TYPES = new Set(['order', 'customer', 'vendor', 'contact', 'review']);
const PREFERENCE_FOR_TYPE = { order: 'new_orders', vendor: 'vendor_applications' };

async function notificationsEnabled(type, tx = db) {
  const preference = PREFERENCE_FOR_TYPE[type];
  if (!preference) return true;
  const row = await tx.get('SELECT notification_preferences FROM store_settings WHERE id = 1');
  try {
    const preferences = JSON.parse(row && row.notification_preferences || '{}');
    return preferences[preference] !== false;
  } catch (_) {
    return true;
  }
}

// tx lets callers inside a transaction keep this write atomic with the rest.
// Outside transactions it defaults to the shared handle.
async function createAdminNotification({ type, title, body = '', entityType, entityId }, tx = db) {
  if (!EVENT_TYPES.has(type) || !(await notificationsEnabled(type, tx))) return;
  await tx.run(`INSERT INTO admin_notifications (type, title, body, entity_type, entity_id)
    VALUES (?, ?, ?, ?, ?)`, type, String(title).slice(0, 160), String(body).slice(0, 500), entityType, String(entityId));
}

module.exports = { createAdminNotification };
