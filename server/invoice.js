const fs = require('fs');
const path = require('path');

const logoPath = path.join(__dirname, '..', 'img', 'core-img', 'pixelhouse-logo.jpg');
const logoDataUri = `data:image/jpeg;base64,${fs.readFileSync(logoPath).toString('base64')}`;

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatAmount(amount) {
  return `Rs. ${Number(amount || 0).toLocaleString('en-PK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function sendInvoice(res, order, items) {
  const rows = items.map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>${formatAmount(item.price)}</td><td>${formatAmount(item.price * item.quantity)}</td></tr>`).join('');
  const discount = Number(order.discount_amount || 0);

  res.set({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Disposition': `attachment; filename="pixelhouse-invoice-${order.id}.html"`,
    'X-Content-Type-Options': 'nosniff',
  });
  res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Invoice #${order.id}</title><style>body{font-family:Arial,sans-serif;color:#1f2937;margin:40px;max-width:900px}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #f97316;padding-bottom:18px}.brand{background:#050505;border-radius:8px;padding:10px 14px;display:inline-block}.brand img{display:block;width:230px;max-width:100%;height:auto}h1{color:#f97316;margin:0 0 8px;font-size:28px}h2{font-size:18px;margin:28px 0 8px}p{line-height:1.55}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{text-align:left;padding:10px;border-bottom:1px solid #d1d5db}th{background:#fff7ed;color:#9a3412}.total{margin-left:auto;width:280px}.total div{display:flex;justify-content:space-between;padding:6px 0}.grand{font-size:18px;font-weight:bold;border-top:2px solid #1f2937;margin-top:6px;padding-top:10px!important}@media(max-width:600px){body{margin:20px}header{display:block}.brand{margin-bottom:18px}.total{width:100%}}</style></head><body><header><div class="brand"><img src="${logoDataUri}" alt="PixelHouse"></div><div><h1>Invoice #${order.id}</h1><strong>Order date</strong><br>${escapeHtml(order.created_at)}<br><strong>Payment</strong><br>${escapeHtml(order.payment_method)}</div></header><h2>Bill to</h2><p>${escapeHtml(order.full_name)}<br>${escapeHtml(order.email)}<br>${escapeHtml(order.phone)}<br>${escapeHtml(order.address)}</p><table><thead><tr><th>Item</th><th>Quantity</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="total"><div><span>Subtotal</span><span>${formatAmount(order.subtotal)}</span></div>${discount ? `<div><span>Discount</span><span>-${formatAmount(discount)}</span></div>` : ''}<div><span>Shipping</span><span>${formatAmount(order.shipping_fee)}</span></div><div class="grand"><span>Total</span><span>${formatAmount(order.total)}</span></div></div></body></html>`);
}

module.exports = { sendInvoice };
