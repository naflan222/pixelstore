const db = require('./db');

const EVENT_TYPES = new Set(['order', 'customer', 'vendor', 'contact', 'review']);
const PREFERENCE_FOR_TYPE = { order: 'new_orders', vendor: 'vendor_applications' };

function notificationsEnabled(type) {
  const preference = PREFERENCE_FOR_TYPE[type];
  if (!preference) return true;
  const row = db.prepare('SELECT notification_preferences FROM store_settings WHERE id = 1').get();
  try {
    const preferences = JSON.parse(row && row.notification_preferences || '{}');
    return preferences[preference] !== false;
  } catch (_) {
    return true;
  }
}

function createAdminNotification({ type, title, body = '', entityType, entityId }) {
  if (!EVENT_TYPES.has(type) || !notificationsEnabled(type)) return;
  db.prepare(`INSERT INTO admin_notifications (type, title, body, entity_type, entity_id)
    VALUES (?, ?, ?, ?, ?)`).run(type, String(title).slice(0, 160), String(body).slice(0, 500), entityType, String(entityId));
}

module.exports = { createAdminNotification };
