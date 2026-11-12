'use strict';

function slugify(name, id) {
  return String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 120).replace(/-$/, '') || 'product-' + id;
}
async function lockUrls(tx) {
  const suffix = require('./database').forUpdate();
  await tx.get('SELECT id FROM store_settings WHERE id = 1' + suffix);
}
async function assignProductUrl(tx, id) {
  await lockUrls(tx);
  const product = await tx.get('SELECT id, name, url_slug FROM products WHERE id = ?', id);
  if (!product || product.url_slug) return product && product.url_slug;
  const base = slugify(product.name, id);
  const existing = await tx.get('SELECT id FROM products WHERE url_slug = ? AND id != ?', base, id);
  let candidate = existing ? base + '-' + id : base;
  // A product name can itself end in an ID; never overwrite an existing URL.
  while (await tx.get('SELECT id FROM products WHERE url_slug = ? AND id != ?', candidate, id)) candidate += '-' + id;
  await tx.run('UPDATE products SET url_slug = ? WHERE id = ? AND url_slug IS NULL', candidate, id);
  return candidate;
}
async function ensureProductUrls(db) {
  await db.transaction(async tx => {
    await lockUrls(tx);
    const rows = await tx.all('SELECT id FROM products WHERE url_slug IS NULL ORDER BY id' + (db.forUpdate ? db.forUpdate() : ''));
    for (const row of rows) await assignProductUrl(tx, row.id);
  });
}
function productPath(product) { return product && product.url_slug ? '/product/' + product.url_slug : null; }
module.exports = { slugify, assignProductUrl, ensureProductUrls, productPath };
