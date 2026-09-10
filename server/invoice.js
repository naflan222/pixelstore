/*
 * PixelHouse invoice documents.
 *
 * A finished purchase downloads a branded, print-ready A4 PDF: the PixelHouse
 * logo sits on a dark letterhead band, followed by the billing/delivery blocks,
 * an itemised table, totals, payment terms and the store contact details that
 * the owner sets in Admin → Settings.
 *
 * A self-contained HTML rendering of the same document is kept as a fallback, so
 * the download still works if the PDF renderer is unavailable (or when the
 * customer asks for a page they can print straight from the browser).
 */

const fs = require('fs');
const path = require('path');

const BRAND = {
  name: 'PixelHouse',
  tagline: 'GoPro Cameras  |  Accessories  |  Camera Rental',
  ink: '#15181D',
  body: '#33404F',
  muted: '#6B7684',
  faint: '#98A2AE',
  line: '#E4E9ED',
  zebra: '#F7F9FA',
  band: '#0B0B0C', // must match the background baked into img/core-img/pixelhouse-logo-print.png
  accent: '#F97316',
  accentDeep: '#B2410C',
  paid: '#15803D',
};

const LOGO_PRINT_PNG = path.join(__dirname, '..', 'img', 'core-img', 'pixelhouse-logo-print.png');
const LOGO_JPG = path.join(__dirname, '..', 'img', 'core-img', 'pixelhouse-logo.jpg');
const PAGE = { width: 595.28, height: 841.89, margin: 42 };
const CONTENT_RIGHT = PAGE.width - PAGE.margin;
const CONTENT_WIDTH = PAGE.width - PAGE.margin * 2;
const TOP_BAR = 92;      // dark letterhead band height (page 1)
const ACCENT_BAR = 3.2;  // orange rule under the band
const BODY_FLOOR = PAGE.height - 78; // nothing flows below this line
const BODY_TOP = 76;               // first content line on continuation pages

const SHIPPING_LABELS = { standard: 'Standard delivery', express: 'Express delivery', pickup: 'Store pickup', courier: 'Courier' };
const PAYMENT_LABELS = { cash: 'Cash on delivery', 'credit-card': 'Credit / debit card', bank: 'Bank transfer', paypal: 'PayPal' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Symbols that read better with a space keep it here, so money() stays a template.
const CURRENCY_SYMBOLS = {
  PKR: 'Rs. ', INR: 'Rs. ', USD: 'US$ ', EUR: '€', GBP: '£', AED: 'AED ', SAR: 'SAR ', AUD: 'A$ ', CAD: 'C$ ', TRY: '₺',
};

/* ------------------------------- helpers ------------------------------- */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

// The PDF uses the standard Helvetica encoding, which only covers Latin-1 plus a
// handful of typographic marks, so anything else is dropped rather than emitted
// as a broken glyph.
const PDF_ALLOWED_EXTRA = new Set(['€', '‚', 'ƒ', '„', '…', '†', '‡', '‰', '‹', '›', '‘', '’',
  '“', '”', '•', '–', '—', '™', 'ˆ', '˜', 'š', 'Š', 'œ', 'Œ', 'ž', 'Ž', 'ª', 'º', '×', '÷']);

function pdfText(value) {
  const collapsed = String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
  const withoutAccents = collapsed.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let out = '';
  for (const character of withoutAccents) {
    const code = character.codePointAt(0);
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) || code === 0xad
      || PDF_ALLOWED_EXTRA.has(character) || PDF_ALLOWED_EXTRA.has(character.normalize('NFC'))) {
      out += character;
    }
  }
  return out;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyCode(shop) {
  return String(shop.currency || 'PKR').toUpperCase();
}

function money(amount, shop) {
  const code = currencyCode(shop);
  const symbol = CURRENCY_SYMBOLS[code] ?? `${code} `;
  const value = number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${symbol}${value}`.trimEnd();
}

// SQLite datetimes are "YYYY-MM-DD HH:MM:SS" (UTC); tolerate ISO strings too.
function parseDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value) {
  const date = parseDate(value);
  if (!date) return String(value || '—');
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function addDays(value, days) {
  const date = parseDate(value);
  if (!date) return null;
  const next = new Date(date.getTime() + days * 86400000);
  return `${next.getUTCDate()} ${MONTHS[next.getUTCMonth()]} ${next.getUTCFullYear()}`;
}

function titleCase(value) {
  return String(value || '').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function padded(value, size) {
  return String(value).padStart(size, '0');
}

/**
 * Sequential, human-quotable invoice numbers: PH-INV-<year>-<order id>.
 * Exported so the checkout response can hand the same number to the success page.
 */
function invoiceNumberFor(orderId, createdAt) {
  const year = (parseDate(createdAt)?.getUTCFullYear()) || new Date().getUTCFullYear();
  return { number: `PH-INV-${year}-${padded(orderId, 5)}`, fileKey: `${year}-${padded(orderId, 5)}` };
}

function imageSize(buffer) {
  if (!buffer || buffer.length < 24) return null;
  if (buffer.readUInt32BE(0) === 0x89504e47) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isFrame) return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return null;
}

let logoCache;
function loadLogo() {
  if (logoCache !== undefined) return logoCache;
  const candidates = [process.env.INVOICE_LOGO_PATH, LOGO_PRINT_PNG, LOGO_JPG].filter(Boolean);
  for (const file of candidates) {
    try {
      const buffer = fs.readFileSync(file);
      const size = imageSize(buffer);
      if (size) {
        logoCache = { file, buffer, ...size };
        return logoCache;
      }
    } catch (_) { /* try the next candidate */ }
  }
  logoCache = null;
  return null;
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch (_) {
    return fallback;
  }
}

function requirePdfKit() {
  let module;
  try {
    module = require('pdfkit'); // eslint-disable-line global-require
  } catch (_) {
    throw new Error('pdfkit is not installed — run `npm install pdfkit` for PDF invoices.');
  }
  return module;
}

/* --------------------------- data gathering --------------------------- */

// Store details live in the same table the admin Settings tab edits, so an owner
// changing the store name or contact info updates every future invoice.
function readShopSettings() {
  const fallback = {
    name: BRAND.name, tagline: BRAND.tagline, email: '', phone: '', address: '', website: '', currency: 'PKR',
  };
  let db;
  try { db = require('./db'); } catch (_) { return fallback; } // eslint-disable-line global-require
  try {
    const row = db.prepare('SELECT * FROM store_settings WHERE id = 1').get();
    if (!row) return fallback;
    const contact = parseJson(row.contact, {});
    return {
      name: String(row.store_name || '').trim() || fallback.name,
      tagline: BRAND.tagline,
      email: String(contact.email || '').trim(),
      phone: String(contact.phone || '').trim(),
      address: String(contact.address || '').trim(),
      website: String(process.env.PUBLIC_URL || process.env.SITE_URL || '').replace(/\/+$/, ''),
      currency: String(row.currency || 'PKR').trim() || 'PKR',
    };
  } catch (_) {
    return fallback;
  }
}

function readPaymentRecord(orderId) {
  let db;
  try { db = require('./db'); } catch (_) { return null; } // eslint-disable-line global-require
  try {
    return db.prepare(`SELECT payment_method, payment_status, transaction_id, paid_at, amount_paid
      FROM payments WHERE order_id = ?`).get(orderId) || null;
  } catch (_) {
    return null;
  }
}

function buildInvoiceModel(order, items, options = {}) {
  const shop = options.shop || readShopSettings();
  const payment = options.payment === undefined ? readPaymentRecord(order.id) : options.payment;
  const lines = (items || []).map((item, index) => {
    const unitPrice = number(item.price);
    const quantity = number(item.quantity);
    return {
      index: index + 1,
      name: String(item.name || `Item ${index + 1}`),
      sku: String(item.sku || '').trim(),
      quantity,
      unitPrice,
      amount: unitPrice * quantity,
    };
  });

  const lineTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  // Orders store their own subtotal; fall back to the lines for hand-built models.
  const subtotal = order.subtotal === null || order.subtotal === undefined ? lineTotal : number(order.subtotal);
  const discount = Math.max(0, number(order.discount_amount));
  const shipping = number(order.shipping_fee);
  const total = number(order.total) || Math.max(0, subtotal - discount + shipping);
  const itemCount = lines.reduce((sum, line) => sum + line.quantity, 0);

  const paymentStatus = String(payment?.payment_status || 'pending').toLowerCase();
  const methodKey = String(order.payment_method || payment?.payment_method || 'cash').toLowerCase();
  const methodLabel = PAYMENT_LABELS[methodKey] || titleCase(methodKey);
  const cancelled = ['cancelled', 'refunded'].includes(String(order.status || '').toLowerCase());

  let statusLabel = 'Amount due';
  if (cancelled) statusLabel = paymentStatus === 'refunded' ? 'Refunded' : 'Cancelled';
  else if (paymentStatus === 'paid') statusLabel = 'Paid in full';
  else if (methodKey === 'cash') statusLabel = 'Due on delivery';

  // Cash orders are settled at the door, so a calendar due date would be misleading.
  const dueOn = paymentStatus === 'paid' ? 'Settled'
    : (cancelled ? '—' : (methodKey === 'cash' ? 'On delivery' : (addDays(order.created_at, 3) || 'On delivery')));

  const { number: invoiceNumber, fileKey } = invoiceNumberFor(order.id, order.created_at);

  const terms = [];
  if (paymentStatus === 'paid') {
    terms.push(`Payment received${payment?.paid_at ? ` on ${formatDate(payment.paid_at)}` : ''}${payment?.transaction_id ? ` (reference ${payment.transaction_id})` : ''}.`);
  } else if (methodKey === 'cash') {
    terms.push('Payment is collected by the courier when this order is handed over. Please keep this invoice ready for reference.');
  } else if (methodKey === 'bank') {
    terms.push('Bank transfers must be settled before dispatch. Quote the order number in the transfer description.');
  } else {
    terms.push(`Payment was collected with ${methodLabel.toLowerCase()} at checkout. No further amount is payable.`);
  }
  terms.push(`Prices are shown in ${currencyCode(shop)} and include all applicable taxes and duties.`);
  terms.push('Undamaged accessories can be returned within 7 days of delivery; rental items must be returned by the agreed date.');
  if (shop.email || shop.phone) {
    terms.push(`Questions about this invoice? ${[shop.email, shop.phone].filter(Boolean).join(' · ')}.`);
  }

  const contactLines = [order.email, order.phone].filter((value) => String(value || '').trim());

  return {
    shop,
    invoiceNumber,
    fileKey,
    orderNumber: `#${order.id}`,
    totalLabel: paymentStatus === 'paid' ? 'Total paid' : (cancelled ? 'Order total' : 'Amount due'),
    statusLabel,
    dueOn,
    currency: currencyCode(shop),
    buyer: {
      name: order.full_name || 'Customer',
      lines: contactLines,
    },
    delivery: {
      address: order.address || '—',
      method: SHIPPING_LABELS[String(order.shipping_method || 'standard')] || titleCase(order.shipping_method || 'Standard delivery'),
      carrier: order.carrier ? `${titleCase(order.carrier)}${order.tracking_number ? ` · ${order.tracking_number}` : ''}` : '',
      status: order.shipping_status ? titleCase(order.shipping_status) : '',
    },
    lines,
    totals: { subtotal, discount, shipping, total, itemCount, coupon: String(order.coupon_code || '').trim() },
    meta: [
      ['Invoice number', invoiceNumber],
      ['Order number', `#${order.id}`],
      ['Issue date', formatDate(order.created_at)],
      ['Due', dueOn],
      ['Payment method', methodLabel],
      ['Order status', titleCase(order.status || 'pending')],
    ],
    terms,
  };
}

/* ----------------------------- PDF rendering ----------------------------- */

function setFont(doc, { font = 'Helvetica', size = 9, color = BRAND.body }) {
  doc.font(font).fontSize(size).fillColor(color);
  return doc;
}

function writeText(doc, text, x, y, options = {}) {
  setFont(doc, options);
  doc.text(pdfText(text), x, y, {
    width: options.width,
    align: options.align || 'left',
    characterSpacing: options.spacing || 0,
    lineGap: options.lineGap || 0,
    lineBreak: options.lineBreak === false ? false : true,
  });
  return doc.y;
}

// Right-align by measuring and positioning the text directly: pdfkit wraps any
// text it thinks is too wide for the box it was given, and single-line invoice
// cells must never wrap.
function rightText(doc, text, rightEdge, y, options = {}) {
  const width = textWidth(doc, text, options);
  return writeText(doc, text, Math.max(PAGE.margin, rightEdge - width), y, { ...options, align: 'left' });
}

function textHeight(doc, text, options = {}) {
  setFont(doc, options);
  return doc.heightOfString(pdfText(text), {
    width: options.width,
    characterSpacing: options.spacing || 0,
    lineGap: options.lineGap || 0,
  });
}

function textWidth(doc, text, options = {}) {
  setFont(doc, options);
  return doc.widthOfString(pdfText(text), { characterSpacing: options.spacing || 0 });
}

function drawLabel(doc, text, x, y) {
  return writeText(doc, text.toUpperCase(), x, y, {
    font: 'Helvetica-Bold', size: 7.4, color: BRAND.accentDeep, spacing: 1.1, lineBreak: false,
  });
}

function drawLogo(doc, x, y, height) {
  const logo = loadLogo();
  if (!logo) return 0;
  const width = (height * logo.width) / logo.height;
  doc.image(logo.buffer, x, y, { width, height });
  return width;
}

function drawLetterhead(doc, model) {
  doc.rect(0, 0, PAGE.width, TOP_BAR).fill(BRAND.band);
  doc.rect(0, TOP_BAR, PAGE.width, ACCENT_BAR).fill(BRAND.accent);

  const logoHeight = 52;
  drawLogo(doc, PAGE.margin, Math.round((TOP_BAR - logoHeight) / 2) - 1, logoHeight);

  // Right-aligned document title, invoice number and payment status pill.
  rightText(doc, 'INVOICE', CONTENT_RIGHT, 22, {
    font: 'Helvetica-Bold', size: 22, color: '#FFFFFF', spacing: 2.4, lineBreak: false,
  });
  rightText(doc, `No. ${model.invoiceNumber}`, CONTENT_RIGHT, 50, {
    font: 'Helvetica-Bold', size: 9, color: BRAND.accent, spacing: 0.5, lineBreak: false,
  });

  const pillLabel = pdfText(model.statusLabel).toUpperCase();
  const pillWidth = textWidth(doc, pillLabel, { font: 'Helvetica-Bold', size: 7.6, spacing: 1 }) + 20;
  const pillX = CONTENT_RIGHT - pillWidth;
  const pillY = 63;
  const paid = model.statusLabel === 'Paid in full';
  doc.roundedRect(pillX, pillY, pillWidth, 16, 8).fill(paid ? BRAND.paid : BRAND.accent);
  writeText(doc, pillLabel, pillX, pillY + 4.6, {
    font: 'Helvetica-Bold', size: 7.6, color: '#FFFFFF', spacing: 1, width: pillWidth, align: 'center', lineBreak: false,
  });
}

function drawContinuationHead(doc, model) {
  doc.rect(0, 0, PAGE.width, 46).fill(BRAND.band);
  doc.rect(0, 46, PAGE.width, 2.4).fill(BRAND.accent);
  drawLogo(doc, PAGE.margin, 11, 24);
  rightText(doc, `Invoice ${model.invoiceNumber} — continued`, CONTENT_RIGHT, 19, {
    size: 8.4, color: BRAND.faint, lineBreak: false,
  });
}

function drawAddressBlocks(doc, model, startY) {
  const leftWidth = 214;
  let y = startY;

  drawLabel(doc, 'Billed to', PAGE.margin, y);
  y += 12;
  writeText(doc, model.buyer.name, PAGE.margin, y, { font: 'Helvetica-Bold', size: 10.8, color: BRAND.ink, width: leftWidth });
  y = doc.y + 1;
  for (const line of model.buyer.lines) y = writeText(doc, line, PAGE.margin, y, { size: 8.6, color: BRAND.muted, width: leftWidth }) + 0.5;

  y += 11;
  drawLabel(doc, 'Deliver to', PAGE.margin, y);
  y += 12;
  writeText(doc, model.delivery.address, PAGE.margin, y, { size: 8.8, color: BRAND.body, width: leftWidth, lineGap: 1.6 });
  y = doc.y + 3;
  const deliveryBits = [model.delivery.method, model.delivery.carrier].filter(Boolean);
  if (deliveryBits.length) y = writeText(doc, deliveryBits.join('  ·  '), PAGE.margin, y, { size: 8, color: BRAND.muted, width: leftWidth }) + 0.5;
  if (model.delivery.status) y = writeText(doc, `Delivery status: ${model.delivery.status}`, PAGE.margin, y, { size: 8, color: BRAND.muted, width: leftWidth }) + 0.5;

  // Meta card
  const cardX = 292;
  const cardWidth = CONTENT_RIGHT - cardX;
  const rows = model.meta;
  const rowHeight = 15.6;
  const cardHeight = 20 + rows.length * rowHeight;
  doc.roundedRect(cardX, startY - 8, cardWidth, cardHeight, 6).fillAndStroke(BRAND.zebra, BRAND.line);

  rows.forEach((row, index) => {
    const rowY = startY + 6 + index * rowHeight;
    writeText(doc, row[0], cardX + 12, rowY + 3.4, { size: 7.4, color: BRAND.muted, spacing: 0.5, lineBreak: false });
    rightText(doc, row[1], CONTENT_RIGHT - 12, rowY + 1.6, {
      font: 'Helvetica-Bold', size: 8.6, color: BRAND.ink, lineBreak: false,
    });
    if (index < rows.length - 1) {
      doc.moveTo(cardX + 12, rowY + rowHeight - 2.6).lineTo(CONTENT_RIGHT - 12, rowY + rowHeight - 2.6)
        .lineWidth(0.5).strokeColor('#EDF1F4').stroke();
    }
  });

  return Math.max(y + 4, startY - 8 + cardHeight) + 22;
}

const TABLE_COLUMNS = [
  { key: 'index', label: '#', width: 30, align: 'left' },
  { key: 'name', label: 'Item description', width: 242, align: 'left' },
  { key: 'quantity', label: 'Qty', width: 38, align: 'right' },
  { key: 'unitPrice', label: 'Unit price', width: 96, align: 'right' },
  { key: 'amount', label: 'Amount', width: 105, align: 'right' },
];

function columnPositions() {
  let x = PAGE.margin;
  return TABLE_COLUMNS.map((column) => {
    const position = { ...column, x };
    x += column.width;
    return position;
  });
}

function drawTableHeader(doc, columns, y) {
  doc.rect(PAGE.margin, y, CONTENT_WIDTH, 21).fill(BRAND.band);
  columns.forEach((column) => {
    writeText(doc, column.label, column.x + 11, y + 6.8, {
      font: 'Helvetica-Bold', size: 7.4, color: '#FFFFFF', spacing: 1, width: column.width - 22, align: column.align, lineBreak: false,
    });
  });
  return y + 21;
}

function newPage(doc, model) {
  doc.addPage({ size: 'A4', margin: PAGE.margin });
  drawContinuationHead(doc, model);
  return BODY_TOP;
}

function drawItemsTable(doc, model, startY) {
  const columns = columnPositions();
  let y = startY;
  y = drawTableHeader(doc, columns, y);

  const descriptionColumn = columns[1];
  const cell = (column, text, rowY, rowHeight, options = {}) => {
    const centered = { ...options, size: options.size || 9, lineBreak: false };
    if (options.align === 'left') return writeText(doc, text, column.x + 11, rowY + (rowHeight - (options.size || 9) * 1.06) / 2, centered);
    return rightText(doc, text, column.x + column.width - 11, rowY + (rowHeight - (options.size || 9) * 1.06) / 2, centered);
  };

  model.lines.forEach((line, index) => {
    const descriptionHeight = Math.max(textHeight(doc, line.name, { size: 9.1, width: descriptionColumn.width - 22, lineGap: 1.4 }), 10);
    const rowHeight = Math.max(24, descriptionHeight + (line.sku ? 20 : 11), line.sku ? 34 : 24);
    if (y + rowHeight > BODY_FLOOR) {
      y = drawTableHeader(doc, columns, newPage(doc, model) + 14);
    }
    if (index % 2 === 1) doc.rect(PAGE.margin, y, CONTENT_WIDTH, rowHeight).fill(BRAND.zebra);

    cell(columns[0], String(line.index), y, rowHeight, { size: 8.4, color: BRAND.muted, align: 'left' });
    writeText(doc, line.name, descriptionColumn.x + 11, y + 6, {
      size: 9.1, color: BRAND.ink, width: descriptionColumn.width - 22, lineGap: 1.4,
    });
    if (line.sku) {
      writeText(doc, `Item code ${line.sku}`, descriptionColumn.x + 11, y + descriptionHeight + 9.5, {
        size: 6.9, color: BRAND.faint, spacing: 0.5, width: descriptionColumn.width - 22, lineBreak: false,
      });
    }
    cell(columns[2], String(line.quantity), y, rowHeight, { size: 8.8, color: BRAND.body });
    cell(columns[3], money(line.unitPrice, model.shop), y, rowHeight, { size: 8.8, color: BRAND.body });
    cell(columns[4], money(line.amount, model.shop), y, rowHeight, {
      font: 'Helvetica-Bold', size: 9.2, color: BRAND.ink,
    });

    y += rowHeight;
    doc.moveTo(PAGE.margin, y).lineTo(CONTENT_RIGHT, y).lineWidth(0.5).strokeColor('#EEF2F5').stroke();
  });

  writeText(doc, `All amounts in ${model.currency}. ${model.totals.itemCount} unit${model.totals.itemCount === 1 ? '' : 's'} across ${model.lines.length} line${model.lines.length === 1 ? '' : 's'}.`,
    PAGE.margin, y + 7, { size: 7.4, color: BRAND.faint, width: CONTENT_WIDTH, lineBreak: false });

  return y + 26;
}

function drawTotalsAndNotes(doc, model, startY) {
  const totalsWidth = 244;
  const totalsX = CONTENT_RIGHT - totalsWidth;
  const notesWidth = CONTENT_WIDTH - totalsWidth - 34;
  let y = startY;

  // Make sure the summary block starts on a page with room for it.
  if (y + 132 > BODY_FLOOR) y = newPage(doc, model) + 6;

  const totals = [
    ['Subtotal', money(model.totals.subtotal, model.shop), null],
  ];
  if (model.totals.discount > 0) {
    totals.push([`Discount${model.totals.coupon ? ` (${model.totals.coupon})` : ''}`, `-${money(model.totals.discount, model.shop)}`, 'discount']);
  }
  totals.push(['Delivery', model.totals.shipping > 0 ? money(model.totals.shipping, model.shop) : 'Free', model.totals.shipping > 0 ? null : 'free']);
  totals.push([model.totalLabel, money(model.totals.total, model.shop), 'grand']);

  let totalsY = y;
  totals.forEach((row) => {
    const [label, value, kind] = row;
    if (kind === 'grand') {
      totalsY += 3;
      doc.roundedRect(totalsX, totalsY, totalsWidth, 42, 6).fill(BRAND.band);
      writeText(doc, label.toUpperCase(), totalsX + 13, totalsY + 10, { size: 7.6, color: BRAND.faint, spacing: 1, lineBreak: false });
      writeText(doc, `Incl. all applicable taxes · ${model.currency}`, totalsX + 13, totalsY + 25, { size: 6.6, color: '#6F7C88', spacing: 0.3, lineBreak: false });
      rightText(doc, value, totalsX + totalsWidth - 13, totalsY + 11, {
        font: 'Helvetica-Bold', size: 14.5, color: '#FFFFFF', lineBreak: false,
      });
      totalsY += 46;
      return;
    }
    writeText(doc, label.toUpperCase(), totalsX, totalsY + 2.6, { size: 7.4, color: BRAND.muted, spacing: 0.7, width: 120, lineBreak: false });
    rightText(doc, value, CONTENT_RIGHT - 2, totalsY + 0.4, {
      font: 'Helvetica-Bold', size: 9.4,
      color: kind === 'discount' ? BRAND.accentDeep : (kind === 'free' ? BRAND.paid : BRAND.ink),
      lineBreak: false,
    });
    doc.moveTo(totalsX, totalsY + 14).lineTo(CONTENT_RIGHT, totalsY + 14).lineWidth(0.5).strokeColor('#EEF2F5').stroke();
    totalsY += 20;
  });

  // Notes / payment terms on the left.
  let notesY = y;
  drawLabel(doc, 'Notes & payment terms', PAGE.margin, notesY);
  notesY += 12;
  model.terms.forEach((term) => {
    doc.circle(PAGE.margin + 2.2, notesY + 4.2, 1.5).fill(BRAND.accent);
    writeText(doc, term, PAGE.margin + 12, notesY, { size: 8.2, color: BRAND.muted, width: notesWidth - 12, lineGap: 1.2 });
    notesY = doc.y + 4.5;
  });

  return Math.max(totalsY, notesY) + 16;
}

function drawFooter(doc, model, pageNumber, pageCount) {
  const footerY = PAGE.height - 52;
  doc.moveTo(PAGE.margin, footerY).lineTo(CONTENT_RIGHT, footerY).lineWidth(0.7).strokeColor(BRAND.line).stroke();

  // Footers are stamped after the content is laid out, so they must never trigger
  // a page break: the line is shortened (then shrunk) until it fits on one line.
  const pageLabel = `Page ${pageNumber} of ${pageCount}`;
  const available = CONTENT_WIDTH - textWidth(doc, pageLabel, { size: 7.3 }) - 26;
  const variants = [
    [model.shop.address, model.shop.phone, model.shop.email, model.shop.website].filter(Boolean).join('   ·   '),
    [model.shop.phone, model.shop.email, model.shop.website].filter(Boolean).join('   ·   '),
    [model.shop.email, model.shop.website].filter(Boolean).join('   ·   '),
    `${model.shop.name} — thank you for your order`,
  ];
  let size = 7.3;
  let text = variants.find(Boolean) || `${model.shop.name} — thank you for your order`;
  while (textWidth(doc, text, { size }) > available && size > 6) size -= 0.3;
  if (textWidth(doc, text, { size }) > available) text = model.shop.name;

  writeText(doc, text, PAGE.margin, footerY + 9, { size, color: BRAND.faint, lineBreak: false });
  rightText(doc, pageLabel, CONTENT_RIGHT, footerY + 9, { size: 7.3, color: BRAND.faint, lineBreak: false });
}

function renderPdf(model) {
  return new Promise((resolve, reject) => {
    let PDFDocument;
    try {
      PDFDocument = requirePdfKit();
    } catch (error) {
      reject(error);
      return;
    }

    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margin: PAGE.margin,
      bufferPages: true,
      info: {
        Title: `${model.shop.name} invoice ${model.invoiceNumber}`,
        Author: model.shop.name,
        Subject: `Invoice for order ${model.orderNumber}`,
        Keywords: `invoice, ${model.invoiceNumber}, ${model.shop.name}, order ${model.orderNumber}`,
        Creator: `${model.shop.name} storefront`,
      },
    });

    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    try {
      drawLetterhead(doc, model);
      let y = drawAddressBlocks(doc, model, TOP_BAR + ACCENT_BAR + 26);
      y = drawItemsTable(doc, model, y);
      y = drawTotalsAndNotes(doc, model, y);

      const closingY = Math.min(y + 4, BODY_FLOOR - 6);
      writeText(doc, `Thank you for choosing ${model.shop.name}. ${model.shop.tagline}`, PAGE.margin, closingY, {
        font: 'Helvetica-Bold', size: 8.2, color: BRAND.accentDeep, width: CONTENT_WIDTH, align: 'center', lineBreak: false,
      });

      // Stamp the page footers last. The bottom margin is released while they are
      // drawn so a footer near the trim edge cannot push pdfkit onto a new page.
      const range = doc.bufferedPageRange();
      for (let index = range.start; index < range.start + range.count; index += 1) {
        doc.switchToPage(index);
        const savedBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        drawFooter(doc, model, index + 1, range.count);
        doc.page.margins.bottom = savedBottom;
      }
      if (typeof doc.flushPages === 'function') doc.flushPages();
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/* ------------------------------ HTML fallback ------------------------------ */

function logoDataUri() {
  const logo = loadLogo();
  if (!logo) return '';
  const mime = logo.file.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${logo.buffer.toString('base64')}`;
}

function renderHtml(model) {
  const moneyHtml = (amount) => escapeHtml(money(amount, model.shop));
  const rows = model.lines.map((line) => `<tr>
      <td class="qty">${line.index}</td>
      <td><strong>${escapeHtml(line.name)}</strong>${line.sku ? `<span class="sku">${escapeHtml(line.sku)}</span>` : ''}</td>
      <td class="num">${line.quantity}</td>
      <td class="num">${moneyHtml(line.unitPrice)}</td>
      <td class="num total">${moneyHtml(line.amount)}</td>
    </tr>`).join('');
  const meta = model.meta.map(([label, value]) => `<div class="meta-row"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('');
  const logo = logoDataUri();

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(model.invoiceNumber)} — ${escapeHtml(model.shop.name)}</title>
<style>
  :root{--ink:#15181D;--body:#33404F;--muted:#6B7684;--line:#E4E9ED;--band:${BRAND.band};--accent:${BRAND.accent};--accent-deep:${BRAND.accentDeep};--zebra:${BRAND.zebra}}
  *{box-sizing:border-box}
  body{margin:0;padding:28px 16px 44px;background:#EEF2F5;color:var(--body);font:15px/1.55 "Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:820px;margin:0 auto;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden;box-shadow:0 18px 45px rgba(16,24,40,.12)}
  .band{background:var(--band);padding:26px 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;flex-wrap:wrap}
  .band img{display:block;width:206px;height:auto}
  .band h1{margin:0;color:#fff;font-size:24px;letter-spacing:3px;font-weight:700}
  .band .no{color:var(--accent);font-weight:700;font-size:12.5px;letter-spacing:.6px;margin-top:4px}
  .pill{display:inline-block;margin-top:9px;background:var(--accent);color:#fff;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:999px}
  .pill.paid{background:${BRAND.paid}}
  .accent{height:4px;background:var(--accent)}
  .body{padding:30px 32px 8px}
  .grid{display:grid;grid-template-columns:1fr 1fr;gap:26px}
  .label{font-size:10.5px;letter-spacing:1.3px;text-transform:uppercase;color:var(--accent-deep);font-weight:700;margin:0 0 7px}
  .party strong{display:block;color:var(--ink);font-size:16px;margin-bottom:3px}
  .party p{margin:0;color:var(--muted);font-size:13.5px;white-space:pre-line}
  .card{background:var(--zebra);border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .meta-row{display:flex;justify-content:space-between;gap:16px;padding:6.5px 0;border-bottom:1px solid #EDF1F4;font-size:12.5px}
  .meta-row:last-child{border-bottom:0}
  .meta-row span{color:var(--muted)}
  .meta-row strong{color:var(--ink)}
  table{width:100%;border-collapse:collapse;margin:26px 0 10px}
  thead th{background:var(--band);color:#fff;font-size:10.5px;letter-spacing:1.1px;text-transform:uppercase;padding:11px 10px;text-align:left}
  tbody td{padding:11px 10px;border-bottom:1px solid #EEF2F5;font-size:13.5px;vertical-align:top;color:var(--ink)}
  tbody tr:nth-child(even){background:#FAFBFC}
  td.qty,th.qty{width:34px;color:var(--muted)}
  td.num,th.num{text-align:right;width:104px;color:var(--body)}
  td.total{font-weight:700;color:var(--ink)}
  .sku{display:block;font-size:11px;color:var(--muted);letter-spacing:.5px}
  .foot{display:grid;grid-template-columns:1fr 300px;gap:30px;margin-top:26px}
  .terms{margin:0;padding-left:16px;font-size:12.5px;color:var(--muted)}
  .terms li{margin-bottom:6px}
  .totals{align-self:start;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .totals div{display:flex;justify-content:space-between;gap:14px;padding:10px 14px;font-size:13px;border-bottom:1px solid #EEF2F5}
  .totals div span{color:var(--muted);text-transform:uppercase;font-size:10.5px;letter-spacing:.8px;align-self:center}
  .totals .discount b{color:var(--accent-deep)}
  .totals .free b{color:${BRAND.paid}}
  .totals .grand{background:var(--band);border:0;padding:14px}
  .totals .grand span{color:#9AA3AE}
  .totals .grand b{color:#fff;font-size:18px}
  .thanks{text-align:center;color:var(--accent-deep);font-weight:700;font-size:12.5px;margin:26px 0 0}
  .contact{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;border-top:1px solid var(--line);margin:22px -32px 0;padding:16px 32px 20px;background:#FBFCFD;font-size:11.5px;color:var(--muted)}
  .actions{max-width:820px;margin:0 auto 18px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .actions a,.actions button{border:0;border-radius:8px;padding:9px 15px;font-size:13px;font-weight:700;cursor:pointer;text-decoration:none;background:var(--accent);color:#fff}
  .actions .ghost{background:#fff;color:var(--body);border:1px solid var(--line)}
  @media(max-width:700px){.grid,.foot{grid-template-columns:1fr}.body{padding:22px 18px 6px}.band{padding:20px 18px}.contact{margin:22px -18px 0;padding:14px 18px 18px}}
  @media print{body{background:#fff;padding:0}.sheet{border:0;border-radius:0;box-shadow:none;max-width:none}thead th{-webkit-print-color-adjust:exact}.actions{display:none}}
</style></head>
<body>
  <div class="actions">
    <button type="button" onclick="window.print()">Print or save as PDF</button>
    <a class="ghost" href="${escapeHtml(model.shop.website || '#')}">${escapeHtml(model.shop.website ? model.shop.website.replace(/^https?:\/\//, '') : model.shop.name)}</a>
  </div>
  <div class="sheet">
    <div class="band">
      <div>${logo ? `<img src="${logo}" alt="${escapeHtml(model.shop.name)}">` : `<div class="no" style="font-size:20px;color:#fff;letter-spacing:2px">${escapeHtml(model.shop.name.toUpperCase())}</div>`}</div>
      <div style="text-align:right">
        <h1>INVOICE</h1>
        <div class="no">No. ${escapeHtml(model.invoiceNumber)}</div>
        <div class="pill${model.statusLabel === 'Paid in full' ? ' paid' : ''}">${escapeHtml(model.statusLabel)}</div>
      </div>
    </div>
    <div class="accent"></div>
    <div class="body">
      <div class="grid">
        <div>
          <p class="label">Billed to</p>
          <div class="party"><strong>${escapeHtml(model.buyer.name)}</strong><p>${escapeHtml(model.buyer.lines.join('\n'))}</p></div>
          <p class="label" style="margin-top:18px">Deliver to</p>
          <div class="party"><p>${escapeHtml(model.delivery.address)}\n${escapeHtml(model.delivery.method)}${model.delivery.carrier ? ` · ${escapeHtml(model.delivery.carrier)}` : ''}</p></div>
        </div>
        <div>
          <p class="label">Invoice details</p>
          <div class="card">${meta}</div>
        </div>
      </div>
      <table>
        <thead><tr><th class="qty">#</th><th>Item description</th><th class="num">Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="foot">
        <div>
          <p class="label">Notes &amp; payment terms</p>
          <ul class="terms">${model.terms.map((term) => `<li>${escapeHtml(term)}</li>`).join('')}</ul>
        </div>
        <div class="totals">
          <div><span>Subtotal</span><b>${moneyHtml(model.totals.subtotal)}</b></div>
          ${model.totals.discount > 0 ? `<div class="discount"><span>Discount${model.totals.coupon ? ` (${escapeHtml(model.totals.coupon)})` : ''}</span><b>-${moneyHtml(model.totals.discount)}</b></div>` : ''}
          <div${model.totals.shipping > 0 ? '' : ' class="free"'}><span>Delivery</span><b>${model.totals.shipping > 0 ? moneyHtml(model.totals.shipping) : 'Free'}</b></div>
          <div class="grand"><span>${escapeHtml(model.totalLabel)} · ${escapeHtml(model.currency)}</span><b>${moneyHtml(model.totals.total)}</b></div>
        </div>
      </div>
      <p class="thanks">Thank you for choosing ${escapeHtml(model.shop.name)}. ${escapeHtml(model.shop.tagline)}</p>
      <div class="contact">
        <span>${escapeHtml([model.shop.address, model.shop.phone, model.shop.email].filter(Boolean).join('  ·  ') || `${model.shop.name} — add contact details in Admin → Settings`)}</span>
        <span>Invoice ${escapeHtml(model.invoiceNumber)} · Order ${escapeHtml(model.orderNumber)}</span>
      </div>
    </div>
  </div>
</body></html>`;
}

/* --------------------------------- exports --------------------------------- */

function disposition(filename, inline) {
  return `${inline ? 'inline' : 'attachment'}; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/**
 * Send the invoice for an order.
 * Resolves `options` from the query string when a request object is supplied so
 * both the customer and admin routes keep their current call signature.
 */
function sendInvoice(res, order, items, options = {}) {
  const request = options.req || (typeof res.req === 'object' && res.req ? res.req : null);
  const query = request?.query || {};
  const settings = {
    ...options,
    inline: options.inline ?? (query.view === '1' || query.view === 'true'),
    format: options.format ?? (query.format === 'html' ? 'html' : 'pdf'),
  };

  const task = (async () => {
    const model = buildInvoiceModel(order, items, settings);
    const baseName = `PixelHouse-Invoice-${model.fileKey}`;
    const usePdf = settings.format !== 'html';

    if (usePdf) {
      try {
        const buffer = await renderPdf(model);
        res.set({
          'Content-Type': 'application/pdf',
          'Content-Disposition': disposition(`${baseName}.pdf`, settings.inline),
          'Content-Length': buffer.length,
          'Cache-Control': 'private, no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        return res.end(buffer);
      } catch (error) {
        if (process.env.INVOICE_STRICT === '1') throw error;
        console.error('[invoice] PDF render failed, serving the HTML invoice instead:', error.message);
      }
    }

    res.set({
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': disposition(`${baseName}.html`, settings.inline),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    return res.end(renderHtml(model));
  })();

  task.catch((error) => {
    console.error('[invoice] could not build the invoice:', error);
    if (!res.headersSent) res.status(500).json({ error: 'The invoice could not be created. Please try again.' });
    else res.end();
  });

  return task;
}

module.exports = {
  sendInvoice,
  invoiceNumberFor,
  buildInvoiceModel,
  renderPdf,
  renderHtml,
  money,
};
