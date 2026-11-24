'use strict';

function inspectProduct(product, skuCount, imageCount) {
  const issues = [];
  if (!product.sku?.trim()) issues.push('Seller SKU');
  else if (skuCount > 1) issues.push('Unique seller SKU');
  if (!product.name?.trim()) issues.push('Product name');
  if (!product.description?.trim()) issues.push('Description');
  if (!product.brand?.trim()) issues.push('Brand');
  if (!imageCount) issues.push('Product image');
  if (!Number.isFinite(product.price) || product.price <= 0) issues.push('Valid price');
  if (!Number.isInteger(product.stock) || product.stock < 0) issues.push('Valid stock');

  const discounted = Number.isFinite(product.old_price) && product.old_price > product.price;
  return {
    id: product.id,
    name: product.name,
    sku: product.sku,
    category: product.category,
    stock: product.stock,
    regularPrice: discounted ? product.old_price : product.price,
    promotionalPrice: discounted ? product.price : null,
    imageCount,
    issues
  };
}

async function inspectCatalog(db) {
  const products = await db.all(`
    SELECT p.id, p.name, p.sku, p.category, p.stock, p.price, p.old_price, p.brand, p.description,
      CASE WHEN p.image IS NOT NULL AND TRIM(p.image) <> '' THEN 1 ELSE 0 END AS has_main_image,
      (SELECT COUNT(*) FROM product_images pi WHERE pi.product_id = p.id
        AND pi.image_data IS NOT NULL AND TRIM(pi.image_data) <> '') AS gallery_count
    FROM products p WHERE p.status = 'active' ORDER BY p.id`);
  const skuCounts = new Map();
  for (const { sku } of products) {
    const key = sku?.trim().toLowerCase();
    if (key) skuCounts.set(key, (skuCounts.get(key) || 0) + 1);
  }
  return products.map(product => inspectProduct(product,
    skuCounts.get(product.sku?.trim().toLowerCase()), Number(product.gallery_count) || product.has_main_image));
}

module.exports = { inspectCatalog, inspectProduct };
