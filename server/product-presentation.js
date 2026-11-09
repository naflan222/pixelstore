'use strict';
const manifests = [...require('../catalog/accessories-20261109.json'), ...require('../catalog/camping-20261109.json')];
const knownSkus = new Set(manifests.map(product => product.sku));
const boilerplate = [
  'Generic accessory. Reference-based product illustration; final supplied finish and model-specific version will be confirmed when stock arrives.',
  'Generic, unbranded product. Image is an illustration; final supplied details and colour will be confirmed when stock arrives.',
  'Fit and material details will be confirmed when stock arrives.',
  'Confirm the supplied suspension hardware and rated load when stock arrives.',
  'Confirm the supplied pieces and material when stock arrives; ',
  'Confirm the supplied quantity, length and locking mechanism when stock arrives.',
  'Confirm included poles, pegs and dimensions when stock arrives.'
];
function cleanDescription(value) {
  let text = String(value || '');
  let changed = false;
  for (const phrase of boilerplate) { if (text.includes(phrase)) { changed = true; text = text.split(phrase).join(''); } }
  return changed ? text.replace(/[ \t]{2,}/g, ' ').replace('. fuel and stove are not included.', '. Fuel and stove are not included.').trim() : text;
}
async function cleanStoredDescriptions(db) {
  return db.transaction(async tx => {
    const rows = await tx.all("SELECT id, sku, description FROM products WHERE sku LIKE 'PH-ACC-20261109-%' OR sku LIKE 'PH-CAMP-20261109-%'");
    let updated = 0;
    for (const row of rows) {
      if (!knownSkus.has(row.sku) || typeof row.description !== 'string') continue;
      const cleaned = cleanDescription(row.description);
      if (cleaned === row.description) continue;
      const result = await tx.run('UPDATE products SET description = ? WHERE id = ? AND description = ?', cleaned, row.id, row.description);
      updated += Number(result.changes || 0);
    }
    if (updated) await tx.run("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (NULL, 'cleaned product copy', 'catalog_cleanup', 'product-copy-20261110', ?)", JSON.stringify({ updated }));
    return updated;
  });
}
// Responsive sources leave the stored primary image and all product data intact.
const variants = require('../catalog/product-image-variants.json');
function withImageSources(product) {
  const list = variants[product.image];
  if (list) product.image_sources = list;
  return product;
}
module.exports = { cleanDescription, cleanStoredDescriptions, withImageSources };
