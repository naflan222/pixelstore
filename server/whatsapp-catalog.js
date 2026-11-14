// WhatsApp-only Meta catalog feed. Original storefront photo URLs and the
// existing /meta-catalog.csv feed are deliberately left unchanged.
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { FIELDS, csvCell, catalogRow } = require('./meta-catalog');

const BASE = 'https://pixelhouse.lk';
const CARD_DIR = path.join(__dirname, '..', 'img', 'whatsapp-cards');

function whatsappImageFor(row, opts = {}) {
  const cardDir = opts.cardDir || CARD_DIR;
  const origin = opts.origin || BASE;
  // Match existing Meta item IDs exactly. Never change IDs when changing art.
  if (!/^PH-[1-9][0-9]*$/.test(row.id)) return row.image_link;
  const filename = row.id + '.jpg';
  const card = path.join(cardDir, filename);
  // Products without a custom image continue using their real storefront
  // photo, so additions or missing cards never create broken Meta image URLs.
  if (!fs.existsSync(card)) return row.image_link;
  return origin + '/img/whatsapp-cards/' + filename;
}

function buildWhatsAppFeed(products, opts = {}) {
  const origin = opts.origin || BASE;
  const out = [FIELDS.map(csvCell).join(',')];
  let skipped = 0;
  let redesigned = 0;
  let fallback = 0;
  for (const p of products) {
    const row = catalogRow(p, origin);
    if (!row) { skipped++; continue; }
    const custom = whatsappImageFor(row, opts);
    if (custom !== row.image_link) redesigned++; else fallback++;
    row.image_link = custom;
    // WhatsApp is an order-by-message channel: active items can be sourced on
    // request even when their physical on-hand website stock is zero.
    // This deliberately does NOT change the website product.stock field or
    // the standard /meta-catalog.csv feed. Never promise immediate dispatch.
    row.availability = 'in stock';
    row.description = (row.description + ' Please message Pixel House to confirm ' +
      'availability and delivery time before ordering.').slice(0, 4999);
    out.push(FIELDS.map(key => csvCell(row[key])).join(','));
  }
  return {
    csv: out.join('\r\n') + '\r\n',
    count: out.length - 1,
    redesigned,
    fallback,
    skipped,
  };
}

function registerWhatsAppCatalogRoute(app, db) {
  app.get('/whatsapp-catalog.csv', async (_req, res, next) => {
    try {
      // Use the same live product query as /meta-catalog.csv. Prices, names,
      // links and original storefront product images remain unchanged. This
      // WhatsApp feed alone advertises active products as orderable, even when
      // site stock is zero, and includes an availability confirmation note.
      const products = await db.all(`
        SELECT p.id, p.name, p.description, p.price, p.old_price, p.stock,
          p.url_slug, p.brand, p.mpn, p.gtin,
          CASE WHEN p.image LIKE 'data:image/%' THEN 'data:' ELSE p.image END AS image,
          (SELECT pi.id FROM product_images pi
            WHERE pi.product_id = p.id AND pi.is_primary = 1
            ORDER BY pi.id DESC LIMIT 1) AS primary_image_id
        FROM products p WHERE p.status = 'active' ORDER BY p.id
      `);
      const feed = buildWhatsAppFeed(products);
      if (feed.skipped || feed.fallback) {
        console.info('[WHATSAPP CATALOG] count=%d redesigned=%d missing custom art=%d excluded=%d',
          feed.count, feed.redesigned, feed.fallback, feed.skipped);
      }
      res.set('Cache-Control', 'public, max-age=300');
      res.set('Content-Disposition', 'inline; filename="pixelhouse-whatsapp-catalog.csv"');
      res.status(200).type('text/csv; charset=utf-8').send(feed.csv);
    } catch (err) { next(err); }
  });
}

module.exports = { whatsappImageFor, buildWhatsAppFeed, registerWhatsAppCatalogRoute };
