// Email sending via SMTP (Gmail, Outlook, or any SMTP provider)
// Configure with environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS
//   MAIL_FROM       (optional) "From" address; must equal SMTP_USER unless your domain has SPF/DKIM/DMARC set up
//   MAIL_FROM_NAME  (optional) display name, default "PixelHouse"
//   MAIL_REPLY_TO   (optional) replies go to this address instead of the From address
// For Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<16-char App Password>
//
// Deliverability rules baked in below (why this matters for the spam folder):
//   1. From address always matches the authenticated SMTP account (a mismatch is the #1 code-level spam trigger).
//   2. Every message ships as multipart/alternative (plain text + HTML), which spam filters expect.
//   3. Subjects are specific and calm — no ALL CAPS, no "!!!" and no spam-bait words.
//   4. A Reply-To points at a real, reachable inbox so customers can answer (engagement improves inbox placement).
const nodemailer = require('nodemailer');

let transporter = null;
let warnedFromMismatch = false;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure: Number(process.env.SMTP_PORT || 465) === 465, // 465 = SSL, 587 = STARTTLS
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

function emailEnabled() {
  return !!getTransporter();
}

function domainOf(address) {
  return String(address || '').split('@').pop().trim().toLowerCase();
}

function fromAddress() {
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const name = process.env.MAIL_FROM_NAME || 'PixelHouse';
  const userDomain = domainOf(process.env.SMTP_USER);
  if (!warnedFromMismatch && userDomain && domainOf(from) !== userDomain) {
    warnedFromMismatch = true;
    console.warn(`[MAIL] From address "${from}" does not match the SMTP user "${process.env.SMTP_USER}". `
      + 'Most providers rewrite or reject this and it often lands in spam. Use MAIL_FROM = SMTP_USER, '
      + 'or set up SPF + DKIM + DMARC for the From domain (see EMAIL-DELIVERABILITY.md).');
  }
  return `"${name}" <${from}>`;
}

function baseHeaders() {
  const replyTo = process.env.MAIL_REPLY_TO || process.env.SMTP_USER;
  return replyTo ? { 'Reply-To': replyTo } : undefined;
}

/** Shared message envelope so every store email is consistent and deliverable. */
function baseMessage({ to, subject, text, html, attachments }) {
  return {
    from: fromAddress(),
    to,
    subject,
    text,
    html,
    headers: baseHeaders(),
    attachments,
  };
}

/* ------------------------------ OTP email ------------------------------ */

async function sendOtpEmail(toEmail, code) {
  const t = getTransporter();
  if (!t) throw new Error('Email is not configured on the server.');
  await t.sendMail(baseMessage({
    to: toEmail,
    subject: 'Your PixelHouse password reset code',
    text: `Your PixelHouse password reset code is: ${code}\n\nIt expires in 15 minutes. If you didn't request this, you can safely ignore this email.`,
    html: `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
        <h2 style="color:#15181D;margin:0 0 12px">PixelHouse</h2>
        <p>Your password reset code is:</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f4f3ff;padding:16px;text-align:center;border-radius:8px;color:#625AFA">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:16px">Expires in 15 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  }));
}

/* ------------------------ order confirmation email ------------------------ */

function paymentLabel(method) {
  return ({ cash: 'Cash on delivery', 'credit-card': 'Credit / debit card', bank: 'Bank transfer', paypal: 'PayPal' })[String(method).toLowerCase()] || String(method);
}

function shippingLabel(method) {
  return ({ standard: 'Standard delivery', express: 'Express delivery', courier: 'Courier', pickup: 'Store pickup' })[String(method).toLowerCase()] || String(method);
}

function formatMoney(amount, currency = 'PKR') {
  const symbol = currency === 'PKR' ? 'Rs. ' : `${currency} `;
  return symbol + Number(amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatOrderDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/**
 * Short, professional order confirmation with the invoice PDF attached.
 * `data.model`   — invoice model from invoice.js (shop details, totals, invoice number)
 * `data.pdfBuffer` — rendered invoice PDF; when null the email is sent without the attachment
 */
async function sendOrderConfirmationEmail(toEmail, data) {
  const t = getTransporter();
  if (!t) throw new Error('Email is not configured on the server.');

  const { order, model, pdfBuffer } = data;
  const shop = model.shop;
  const items = model.lines;
  const currency = shop.currency;

  const itemRowsText = items.map((l) => `- ${l.name} × ${l.quantity} — ${formatMoney(l.amount, currency)}`).join('\n');
  const summaryText =
    `Order ${model.orderNumber}${order.created_at ? ` · ${formatOrderDate(order.created_at)}` : ''}\n` +
    `Payment: ${paymentLabel(order.payment_method)}\n` +
    `Delivery: ${shippingLabel(order.shipping_method)}\n\n` +
    `${itemRowsText}\n\n` +
    (model.totals.discount > 0 ? `Discount: -${formatMoney(model.totals.discount, currency)}\n` : '') +
    `Shipping: ${formatMoney(model.totals.shipping, currency)}\n` +
    `Total: ${formatMoney(model.totals.total, currency)}\n`;

  const text = [
    `Hi ${order.full_name || 'there'},`,
    '',
    `Thank you for your order at ${shop.name}! We have received it and it is now being processed.`,
    '',
    summaryText,
    pdfBuffer
      ? 'Your invoice is attached to this email as a PDF. Please keep it for your records.'
      : 'You can view and download your invoice here: ' + `${shop.website || ''}/api/orders/${order.id}/invoice`,
    '',
    `Delivering to: ${order.address}`,
    '',
    'Questions about your order? Just reply to this email — we are happy to help.',
    '',
    `${shop.name} — ${shop.tagline}`,
  ].join('\n');

  const itemRowsHtml = items.map((l) => `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #E4E9ED;color:#33404F">${escapeHtml(l.name)}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E4E9ED;text-align:center;color:#33404F">${l.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E4E9ED;text-align:right;color:#33404F">${formatMoney(l.amount, currency)}</td>
      </tr>`).join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;border:1px solid #E4E9ED;border-radius:12px;overflow:hidden">
      <div style="background:#0B0B0C;padding:20px 24px">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
          <td style="color:#fff;font-size:20px;font-weight:bold;letter-spacing:0.5px">${escapeHtml(shop.name)}</td>
          <td align="right" style="color:#F97316;font-size:12px;font-weight:bold;letter-spacing:1px">ORDER CONFIRMED</td>
        </tr></table>
      </div>
      <div style="padding:24px">
        <p style="margin:0 0 6px;font-size:16px;color:#15181D"><strong>Hi ${escapeHtml(order.full_name || 'there')}, thank you for your order!</strong></p>
        <p style="margin:0 0 18px;color:#6B7684;font-size:14px">We have received your order and it is now being processed. Your invoice is attached to this email as a PDF.</p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F7F9FA;border-radius:8px;font-size:13px;color:#33404F;margin-bottom:18px">
          <tr>
            <td style="padding:12px 16px"><strong>Order</strong> ${escapeHtml(model.orderNumber)}</td>
            <td style="padding:12px 16px"><strong>Date</strong> ${formatOrderDate(order.created_at) || '—'}</td>
          </tr>
          <tr>
            <td style="padding:0 16px 12px"><strong>Payment</strong> ${paymentLabel(order.payment_method)}</td>
            <td style="padding:0 16px 12px"><strong>Delivery</strong> ${shippingLabel(order.shipping_method)}</td>
          </tr>
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
          <tr>
            <th align="left" style="padding:6px 0;color:#98A2AE;font-weight:normal;font-size:12px;text-transform:uppercase">Item</th>
            <th style="padding:6px 0;color:#98A2AE;font-weight:normal;font-size:12px;text-transform:uppercase">Qty</th>
            <th align="right" style="padding:6px 0;color:#98A2AE;font-weight:normal;font-size:12px;text-transform:uppercase">Amount</th>
          </tr>
          ${itemRowsHtml}
        </table>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#33404F;margin-top:12px">
          ${model.totals.discount > 0 ? `<tr><td style="padding:3px 0">Discount${model.totals.coupon ? ` (${escapeHtml(model.totals.coupon)})` : ''}</td><td align="right" style="padding:3px 0">-${formatMoney(model.totals.discount, currency)}</td></tr>` : ''}
          <tr><td style="padding:3px 0">Shipping</td><td align="right" style="padding:3px 0">${formatMoney(model.totals.shipping, currency)}</td></tr>
          <tr><td style="padding:10px 0 0;font-weight:bold;font-size:16px;color:#15181D">Total</td><td align="right" style="padding:10px 0 0;font-weight:bold;font-size:16px;color:#15181D">${formatMoney(model.totals.total, currency)}</td></tr>
        </table>

        <p style="margin:18px 0 0;color:#6B7684;font-size:13px"><strong style="color:#33404F">Delivering to:</strong> ${escapeHtml(order.address)}</p>

        <p style="margin:18px 0 0;color:#6B7684;font-size:13px">Questions about your order? Just reply to this email — we are happy to help.</p>
      </div>
      <div style="background:#F7F9FA;padding:14px 24px;font-size:12px;color:#98A2AE">
        ${escapeHtml(shop.name)} — ${escapeHtml(shop.tagline)}
      </div>
    </div>`;

  const attachments = pdfBuffer
    ? [{ filename: `PixelHouse-Invoice-${model.fileKey}.pdf`, content: pdfBuffer, contentType: 'application/pdf' }]
    : undefined;

  await t.sendMail(baseMessage({
    to: toEmail,
    subject: `${shop.name} order ${model.orderNumber} confirmed — invoice attached`,
    text,
    html,
    attachments,
  }));
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { emailEnabled, sendOtpEmail, sendOrderConfirmationEmail };
