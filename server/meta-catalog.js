// Public Meta Commerce Manager data feed for the active PixelHouse catalog.
// No Meta credentials are needed. Commerce Manager periodically fetches /meta-catalog.csv.
'use strict';

const ORIGIN = 'https://pixelhouse.lk';
const FIELDS = [
  'id', 'title', 'description', 'availability', 'condition',
  'price', 'sale_price', 'link', 'image_link', 'brand', 'mpn', 'gtin',
];

function csvCell(value) {
  return '"' + String(value == null ? '' : value).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').replace(/"/g, '""') + '"';
}

function textOnly(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function imageUrl(product, origin = ORIGIN) {
  const value = String(product.image || '').trim();
  const id = Number(product.id);
  if (!Number.isSafeInteger(id) || id < 1) return null;

  // Admin-uploaded photos live in the database as base64 data URLs. Never
  // embed them in a CSV or use them as image_link: Meta needs an HTTPS URL.
  if (value === 'data:' || /^data:image\/(?:jpeg|png|webp|gif);base64,/i.test(value)) {
    const version = Number(product.primary_image_id) || id;
    return origin + '/meta-catalog/images/' + id + '?v=' + encodeURIComponent(version);
  }
  if (/^https:\/\/[^\s]+$/i.test(value)) return value;

  // Only the public /img tree is served by this app; refuse unserved paths,
  // traversal and schemed URLs rather than pointing Meta at 404 pages.
  const clean = value.replace(/^\/+/, '');
  const segments = clean.split('/');
  if (segments.length < 2 || segments[0] !== 'img' ||
      segments.some(s => !s || s === '.' || s === '..' || /[\\?#\x00-\x1f]/.test(s))) return null;
  return origin + '/' + segments.map(encodeURIComponent).join('/');
}

function catalogRow(product, origin = ORIGIN) {
  const id = Number(product.id);
  const price = Number(product.price);
  const title = textOnly(product.name);
  const image = imageUrl(product, origin);
  if (!Number.isSafeInteger(id) || id < 1 || !title || !image ||
      !Number.isFinite(price) || price <= 0) return null;

  // Product URL slugs are generated and kept stable by ensureProductUrls().
  const slug = String(product.url_slug || '').trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) return null;

  const oldPrice = Number(product.old_price);
  const onSale = Number.isFinite(oldPrice) && oldPrice > price;
  const description = textOnly(product.description).slice(0, 4999) ||
    'Shop ' + title + ' at PixelHouse Sri Lanka.';

  return {
    id: 'PH-' + id,
    title: title.slice(0, 200),
    description,
    availability: Number(product.stock) > 0 ? 'in stock' : 'out of stock',
    condition: 'new',
    price: (onSale ? oldPrice : price).toFixed(2) + ' LKR',
    sale_price: onSale ? price.toFixed(2) + ' LKR' : '',
    link: origin + '/product/' + encodeURIComponent(slug),
    image_link: image,
    // Use the explicit catalog brand. "Unbranded" is a placeholder only for
    // products without a brand; fill in actual manufacturer brands in admin.
    brand: textOnly(product.brand) || 'Unbranded',
    mpn: textOnly(product.mpn),
    gtin: textOnly(product.gtin),
  };
}

function buildFeed(products, origin = ORIGIN) {
  let skipped = 0;
  const rows = [FIELDS.map(csvCell).join(',')];
  for (const product of products) {
    const row = catalogRow(product, origin);
    if (!row) { skipped += 1; continue; }
    rows.push(FIELDS.map(field => csvCell(row[field])).join(','));
  }
  return { csv: rows.join('\r\n') + '\r\n', count: rows.length - 1, skipped };
}

function registerMetaCatalogRoutes(app, db) {
  // Select a tiny placeholder for large uploaded data URIs. Each product
  // photo is downloaded separately by Meta using the /images/:id endpoint.
  app.get('/meta-catalog.csv', async (_req, res, next) => {
    try {
      const products = await db.all(`
        SELECT p.id, p.name, p.description, p.price, p.old_price, p.stock,
          p.url_slug, p.brand, p.mpn, p.gtin,
          CASE WHEN p.image LIKE 'data:image/%' THEN 'data:' ELSE p.image END AS image,
          (SELECT pi.id FROM product_images pi
            WHERE pi.product_id = p.id AND pi.is_primary = 1
            ORDER BY pi.id DESC LIMIT 1) AS primary_image_id
        FROM products p WHERE p.status = 'active' ORDER BY p.id
      `);
      const feed = buildFeed(products);
      if (feed.skipped) console.warn('[META CATALOG] Excluded invalid active products:', feed.skipped);
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Disposition', 'inline; filename="pixelhouse-meta-catalog.csv"');
      res.status(200).type('text/csv; charset=utf-8').send(feed.csv);
    } catch (error) { next(error); }
  });

  // Expose ONLY active products' admin-uploaded primary images. No private
  // account or admin API data is served, and uploads were already capped at 5MB.
  app.get('/meta-catalog/images/:id', async (req, res, next) => {
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.sendStatus(404);
    try {
      const product = await db.get(
        "SELECT image FROM products WHERE id = ? AND status = 'active'", id
      );
      const match = product && /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/i.exec(product.image || '');
      if (!match) return res.sendStatus(404);
      const buffer = Buffer.from(match[2], 'base64');
      if (!buffer.length || buffer.length > 5 * 1024 * 1024 ||
          buffer.toString('base64') !== match[2]) return res.sendStatus(404);
      res.set('Cache-Control', 'public, max-age=3600');
      res.set('X-Content-Type-Options', 'nosniff');
      res.type(match[1].toLowerCase()).send(buffer);
    } catch (error) { next(error); }
  });
}

module.exports = { FIELDS, csvCell, imageUrl, catalogRow, buildFeed, registerMetaCatalogRoutes };
