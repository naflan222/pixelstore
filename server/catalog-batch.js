const { assignProductUrl } = require('./product-urls');
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = function createCatalogBatch(BATCH, products) {
const error = message => Object.assign(new Error(message), { status: 409 });
async function state(db) {
  return db.get("SELECT * FROM audit_logs WHERE entity_type = 'catalog_batch' AND entity_id = ? ORDER BY id DESC LIMIT 1", BATCH);
}
function validateAssets() {
  for (const product of products) for (const image of [product.image, product.zoom_image]) {
    if (!fs.existsSync(path.join(__dirname, '..', image))) throw error('Product images are not deployed yet. Deploy this update before adding the catalog.');
  }
}
async function apply(db, actor) {
  validateAssets();
  return db.transaction(async tx => {
    const previous = await state(tx);
    if (previous) {
      if (previous.action === 'rolled back') throw error('This batch was rolled back. Manage its existing products individually; it will not recreate or reactivate them.');
      return { applied: false, already_applied: true, created: JSON.parse(previous.details).created };
    }
    // Lock an existing singleton to serialize two simultaneous owner imports.
    await tx.get(`SELECT id FROM store_settings WHERE id = 1${db.forUpdate()}`);
    const locked = await state(tx);
    if (locked) {
      if (locked.action === 'rolled back') throw error('This batch was rolled back.');
      return { applied: false, already_applied: true, created: JSON.parse(locked.details).created };
    }
    for (const product of products) {
      if (await tx.get('SELECT id FROM products WHERE slug = ? OR sku = ?', product.slug, product.sku)) throw error(`A product already uses ${product.sku} or its URL. No products were added; review the collision before retrying.`);
    }
    const categories = new Map();
    for (const name of new Set(products.map(product => product.category))) {
      let category = await tx.get('SELECT id, is_active FROM categories WHERE name = ?', name);
      if (category && !Number(category.is_active)) throw error(`The ${name} category must be active. No products were added.`);
      if (!category) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        if (await tx.get('SELECT id FROM categories WHERE slug = ?', slug)) throw error(`A different category already uses ${slug}. No products were added.`);
        category = await tx.insert('INSERT INTO categories (name, slug) VALUES (?, ?)', name, slug);
      }
      categories.set(name, category.id);
    }
    const created = [];
    for (const product of products) {
      const category = { id: categories.get(product.category) };
      const inserted = await tx.insert(`INSERT INTO products (slug, name, description, price, old_price, image, category, category_id, stock, status, brand, sku, featured, flash_sale, rating, rating_count)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 0, 'active', '', ?, 0, 0, 0, 0)`,
      product.slug, product.name, product.description, product.price, product.image, product.category, category.id, product.sku);
      await assignProductUrl(tx, inserted.id);
      await tx.run(`INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary) VALUES (?, ?, 'image/webp', ?, 0, 0)`, inserted.id, product.zoom_image, path.basename(product.zoom_image));
      created.push({ id: Number(inserted.id), sku: product.sku });
    }
    await tx.run("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, 'applied', 'catalog_batch', ?, ?)", actor, BATCH, JSON.stringify({ created }));
    return { applied: true, already_applied: false, created };
  });
}
async function rollback(db, actor) {
  return db.transaction(async tx => {
    await tx.get(`SELECT id FROM store_settings WHERE id = 1${db.forUpdate()}`);
    const previous = await state(tx);
    if (!previous) throw error('This batch has not been added.');
    const created = JSON.parse(previous.details).created;
    if (previous.action === 'rolled back') return { rolled_back: true, changed: 0 };
    let changed = 0;
    for (const row of created) {
      const result = await tx.run("UPDATE products SET status = 'inactive' WHERE id = ? AND sku = ?", row.id, row.sku);
      changed += Number(result.changes || 0);
    }
    // Deactivate instead of deleting: retain quantities, edits, reviews and any order history.
    await tx.run("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (?, 'rolled back', 'catalog_batch', ?, ?)", actor, BATCH, JSON.stringify({ created }));
    return { rolled_back: true, changed };
  });
}
return { BATCH, products, state, apply, rollback };
};
