'use strict';
function cameraProduct(product) {
  if (/^hero\d+$/i.test(String(product.slug || '')) || /^PH-BUNDLE-HERO\d+-/i.test(String(product.sku || '')) || /^GoPro\s+HERO\s*\d+(?:\s+Black|\s+Bundle)?$/i.test(String(product.name || '').trim())) return true;
  return ['action cameras','insta360 camera','insta360 cameras','dji osmo camera','dji osmo cameras'].includes(String(product.category || '').trim().toLowerCase());
}
function serialValues(value, quantity) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > quantity) throw new Error('Enter at most one serial number per unit.');
  return value.map(raw => {
    if (typeof raw !== 'string' || raw.length > 128 || /[\x00-\x1f\x7f]/.test(raw)) throw new Error('Serial numbers must be printable text, up to 128 characters.');
    return raw.trim();
  });
}
async function loadRows(db, orderId, kind) {
  return db.all(`SELECT s.order_item_id, s.unit_index, s.serial_number FROM invoice_serials s
    JOIN order_items i ON i.id = s.order_item_id WHERE i.order_id = ? AND s.document_kind = ? ORDER BY s.order_item_id, s.unit_index`, orderId, kind);
}
async function saveLine(tx, itemId, kind, values) {
  await tx.run('DELETE FROM invoice_serials WHERE order_item_id = ? AND document_kind = ?', itemId, kind);
  for (const [unit, serial] of values.entries()) if (serial) await tx.run('INSERT INTO invoice_serials (order_item_id, document_kind, unit_index, serial_number) VALUES (?, ?, ?, ?)', itemId, kind, unit, serial);
}
async function documentItems(db, orderId) {
  const items = await db.all(`SELECT i.*, p.category, p.sku, p.slug FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ? ORDER BY i.id`, orderId);
  const rows = await loadRows(db, orderId, 'copy');
  return items.map(item => {
    const values = [];for (const row of rows.filter(r => r.order_item_id === item.id)) values[row.unit_index] = row.serial_number;
    return { ...item, serial_eligible: cameraProduct(item), serial_numbers: Array.from({length:values.length}, (_,i) => values[i] || '') };
  });
}
async function saveCopy(db, orderId, input) {
  if (!Array.isArray(input) || input.length > 40) throw new Error('Provide valid invoice items.');
  return db.transaction(async tx => {
    if (!(await tx.get('SELECT id FROM orders WHERE id = ?' + db.forUpdate(), orderId))) throw new Error('Order no longer exists.');
    const items = await tx.all('SELECT id, quantity FROM order_items WHERE order_id = ? ORDER BY id', orderId);
    const seen = new Set();
    for (const item of input) {
      const found = items.find(i => i.id === Number(item.order_item_id));
      if (!found || seen.has(found.id)) throw new Error('Every invoice item must belong to this order and appear once.');
      seen.add(found.id);serialValues(item.serial_numbers, found.quantity);
    }
    for (const item of items) {
      const values = input.find(i => Number(i.order_item_id) === item.id)?.serial_numbers || [];
      await saveLine(tx, item.id, 'copy', serialValues(values, item.quantity));
    }
  });
}
async function pauseBankTransfer(db) {
  return db.transaction(async tx => {
    await tx.get('SELECT id FROM store_settings WHERE id = 1' + db.forUpdate());
    if (await tx.get("SELECT id FROM audit_logs WHERE entity_type='checkout_configuration' AND entity_id='cod-only-20261115'")) return false;
    await tx.run('UPDATE store_settings SET payment_methods = ? WHERE id = 1', JSON.stringify(['cash']));
    await tx.run("INSERT INTO audit_logs (actor_id,action,entity_type,entity_id,details) VALUES (NULL,'paused bank transfer','checkout_configuration','cod-only-20261115','Website checkout: cash on delivery only; historical orders unchanged.')");
    return true;
  });
}
module.exports = { cameraProduct, serialValues, loadRows, saveLine, saveCopy, documentItems, pauseBankTransfer };
