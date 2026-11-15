'use strict';
const { productPath, assignProductUrl } = require('./product-urls');
const BUNDLE_SKU = 'PH-BUNDLE-HERO13-20261115';
const launchKey = 'hero13-promotion-launch-20261115';
const description = 'A GoPro HERO13 camera bundle for travel and outdoor filming.\n\nIncluded items:\n• GoPro HERO13 Black\n• Battery\n• USB-C cable\n• 50-in-1 accessories kit\n• 10 ft selfie stick\n• Waterproof case\n\nCheck the supplied camera and housing instructions before water use. Accessories and spare batteries must match the camera model. Contact PixelHouse for product and ordering support.';
async function listPromotions(db, publicOnly = false) {
  const now = db.utcNow();
  const rows = await db.all(`SELECT r.*, p.name, p.description, p.price, p.old_price, p.image, p.stock, p.status, p.slug, p.url_slug, p.badge, p.rating, p.rating_count
    FROM promotions r JOIN products p ON p.id = r.product_id
    ${publicOnly ? "WHERE r.is_active = 1 AND p.status = 'active' AND (r.starts_at IS NULL OR r.starts_at <= ?) AND (r.ends_at IS NULL OR r.ends_at > ?)" : ''}
    ORDER BY r.display_order, r.id`, ...(publicOnly ? [now, now] : []));
  return rows.map(row => ({ ...row, url_path: productPath(row) }));
}
// One-time owner-authorized launch, protected by the same store lock as catalog imports.
async function launch(db) {
  return db.transaction(async tx => {
    await tx.get('SELECT id FROM store_settings WHERE id = 1' + db.forUpdate());
    if (await tx.get("SELECT id FROM audit_logs WHERE entity_type = 'promotion_launch' AND entity_id = ?", launchKey)) return false;
    const hero = await tx.get("SELECT id FROM products WHERE slug = 'hero13'");
    if (!hero) return false;
    await tx.run('UPDATE products SET price = ?, old_price = ? WHERE id = ?', 92000, 120000, hero.id);
    let bundle = await tx.get('SELECT id FROM products WHERE sku = ?', BUNDLE_SKU);
    if (!bundle) {
      if (await tx.get("SELECT id FROM products WHERE slug = 'gopro-hero13-bundle'")) throw new Error('Bundle URL already belongs to another product.');
      const category = await tx.get("SELECT id FROM categories WHERE name = 'Action Cameras'");
      bundle = await tx.insert(`INSERT INTO products (slug, name, description, price, old_price, image, category, category_id, stock, status, sku, brand, badge, featured, flash_sale, rating, rating_count)
        VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, 'active', ?, 'GoPro', 'Bundle', 0, 0, 0, 0)`,
        'gopro-hero13-bundle', 'GoPro HERO13 Bundle', description, 105000, 'img/product/hero13-bundle-20261115-600.webp', 'Action Cameras', category?.id || null, 20, BUNDLE_SKU);
      await assignProductUrl(tx, bundle.id);
      await tx.run("INSERT INTO product_images (product_id, image_data, mime_type, file_name, sort_order, is_primary) VALUES (?, ?, 'image/webp', ?, 0, 0)", bundle.id, 'img/product/hero13-bundle-20261115-1536.webp', 'hero13-bundle-20261115-1536.webp');
    }
    if (!(await tx.get('SELECT id FROM promotions WHERE product_id = ?', bundle.id))) {
      await tx.run('INSERT INTO promotions (product_id, is_active, show_popup, display_order) VALUES (?, 1, 1, 0)', bundle.id);
    }
    await tx.run("INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, details) VALUES (NULL, 'applied', 'promotion_launch', ?, ?)", launchKey, JSON.stringify({ bundle_id: Number(bundle.id), initial_stock: 20 }));
    return true;
  });
}
module.exports = { listPromotions, launch, BUNDLE_SKU };
