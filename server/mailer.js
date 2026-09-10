// Email sending for the Pixels store (password-reset OTP codes).
//
// Two transports, in this order of preference:
//   1) Brevo HTTP API   — set BREVO_API_KEY (works over plain HTTPS, most reliable)
//   2) SMTP (Brevo, Gmail, Outlook, any relay) — set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS
//
// Configure with environment variables (or a local .env file — see README,
// "Email OTP Setup"):
//
// Brevo HTTP API (https://app.brevo.com → ⚙ Account settings → API keys →
// create a key with "Transactional" scope):
//   BREVO_API_KEY=<v3 api key>
//   MAIL_FROM=<sender address verified in Brevo>
//
// Brevo SMTP (https://app.brevo.com → Transactions → SMTP):
//   SMTP_HOST=smtp-relay.brevo.com SMTP_PORT=587
//   SMTP_USER=<SMTP login from Brevo SMTP settings>
//   SMTP_PASS=<SMTP password from Brevo SMTP settings (NOT your login password)>
//   MAIL_FROM=<sender address verified in Brevo>
//
// Gmail (https://myaccount.google.com/apppasswords — requires 2-Step Verification):
//   SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<16-char App Password>
//
// Optional, for every email the store sends:
//   MAIL_FROM_NAME = PixelHouse          (From display name)
//   MAIL_REPLY_TO = support@yourdomain   (where customer replies land)
//
// Dev only: FORCE_DEV_CODES=1 always returns the code in the API response and
// logs it, even when a transport is configured (for UI testing without mail).
const nodemailer = require('nodemailer');

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) return null;
  const port = Number(process.env.SMTP_PORT || 465);
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,            // 465 = implicit SSL, 587 = STARTTLS
    requireTLS: port !== 465,        // never fall back to unencrypted mail
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  return transporter;
}

function smtpConfigured() {
  return !!getTransporter();
}

function brevoApiConfigured() {
  return !!process.env.BREVO_API_KEY;
}

function emailEnabled() {
  return brevoApiConfigured() || smtpConfigured();
}

/* --------------------- shared sender identity --------------------- */

function senderIdentity() {
  return {
    name: process.env.MAIL_FROM_NAME || 'PixelHouse',
    email: process.env.MAIL_FROM || process.env.SMTP_USER || '',
  };
}

// Customer replies should land in a real inbox (engagement with replies is a
// positive spam-filter signal), defaulting to the sending account itself.
function replyToIdentity() {
  const email = process.env.MAIL_REPLY_TO || process.env.SMTP_USER || '';
  return email ? { name: senderIdentity().name, email } : null;
}

let warnedFromMismatch = false;
// Sending SMTP mail "from" a domain other than the authenticated account is the
// #1 code-level reason mail lands in spam (providers flag it as spoofing).
// The Brevo API transport is exempt — Brevo verifies senders on its side.
function checkSmtpFromDomain() {
  const from = senderIdentity().email;
  const user = process.env.SMTP_USER || '';
  const dom = (a) => String(a || '').split('@').pop().trim().toLowerCase();
  if (!warnedFromMismatch && user && dom(from) && dom(from) !== dom(user)) {
    warnedFromMismatch = true;
    console.warn(`[MAIL] From address "${from}" does not match the SMTP user "${user}". `
      + 'Most providers rewrite or reject this and it often lands in spam. Use MAIL_FROM = SMTP_USER, '
      + 'or authenticate the From domain with SPF + DKIM + DMARC (see EMAIL-DELIVERABILITY.md).');
  }
}

// Public (no secrets) summary of the mail configuration — used by the
// startup log and GET /api/email/status so operators can verify on the
// deployed service that the env vars actually arrived.
function describeConfig() {
  const port = Number(process.env.SMTP_PORT || 465);
  return {
    email_enabled: emailEnabled(),
    transport: brevoApiConfigured() ? 'brevo_api' : smtpConfigured() ? 'smtp' : null,
    smtp_host: process.env.SMTP_HOST || null,
    smtp_port: smtpConfigured() ? port : null,
    smtp_user: process.env.SMTP_USER || null,
    mail_from: process.env.MAIL_FROM || null,
    force_dev_codes: process.env.FORCE_DEV_CODES === '1',
  };
}

function describeError(e) {
  const msg = String(e && e.message || e);
  // Help operators fix the most common SMTP/API misconfigurations
  if (/550/.test(msg) && /sender|mail from|reject|not allowed|verify|permission/i.test(msg))
    return `Mail provider rejected the sender address (MAIL_FROM): ${msg} — make sure the MAIL_FROM address is verified/allowed on your mail account (Brevo: sender addresses must be verified, and the API key needs "Transactional" scope).`;
  if (/535|authentication/i.test(msg))
    return `Authentication failed: ${msg} — for Brevo SMTP, SMTP_PASS is the SMTP password from Brevo → Transactions → SMTP (not your Brevo login password).`;
  if (/ENOTFOUND|EAI_AGAIN|ENETUNREACH/i.test(msg))
    return `Could not reach the mail provider: ${msg}`;
  if (/socket/i.test(msg))
    return `Connection to the SMTP server was interrupted: ${msg} — check the host/port, or switch to the Brevo HTTP API (BREVO_API_KEY), which only needs HTTPS.`;
  return msg;
}

function otpHtml(code) {
  return `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px;background:#fff">
        <h2 style="color:#625AFA;margin:0 0 12px">Pixels Store</h2>
        <p>Password reset requested for your account. Enter this code to continue:</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f4f3ff;padding:16px;text-align:center;border-radius:8px;color:#625AFA">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:16px">The code expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
      </div>`;
}

function otpText(code) {
  return `Your password reset code is: ${code}\n\nIt expires in 15 minutes. If you didn't request this, ignore this email.`;
}

// ---- Brevo HTTP API transport ----
async function sendViaBrevoApi(toEmail, code) {
  const sender = senderIdentity();
  if (!sender.email) throw new Error('Set MAIL_FROM to a sender address verified in Brevo.');
  const reply = replyToIdentity();
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: sender.name, email: sender.email },
      to: [{ email: toEmail }],
      subject: 'Your Pixels password reset code',
      htmlContent: otpHtml(code),
      content: otpText(code),
      ...(reply ? { replyTo: reply } : {}),
    }),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Brevo API error ${resp.status}: ${data.message || data.type || JSON.stringify(data)}`);
  }
  const messageId = data.messageIds && data.messageIds[0];
  console.log(`[EMAIL] OTP sent via Brevo API to ${toEmail} (messageId: ${messageId || 'n/a'})`);
  return data;
}

// ---- SMTP transport ----
async function sendViaSmtp(toEmail, code) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS).');
  checkSmtpFromDomain();
  const sender = senderIdentity();
  const reply = replyToIdentity();
  const info = await t.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: toEmail,
    subject: 'Your Pixels password reset code',
    text: otpText(code),
    html: otpHtml(code),
    headers: reply ? { 'Reply-To': reply.email } : undefined,
  });
  console.log(`[EMAIL] OTP sent via SMTP to ${toEmail} (messageId: ${info.messageId})`);
  return info;
}

// Pick the best available transport.
async function sendOtpEmail(toEmail, code) {
  try {
    if (brevoApiConfigured()) return await sendViaBrevoApi(toEmail, code);
    return await sendViaSmtp(toEmail, code);
  } catch (e) {
    const detail = describeError(e);
    console.error('[EMAIL ERROR]', detail);
    throw new Error(detail);
  }
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

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Short, professional order confirmation with the invoice PDF attached.
 * `data.order`     — the order row
 * `data.model`     — invoice model from invoice.js (shop details, totals, invoice number)
 * `data.pdfBuffer` — rendered invoice PDF; when null the email links to the invoice instead
 */
function buildOrderMessage({ order, model, pdfBuffer }) {
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

  return {
    subject: `${shop.name} order ${model.orderNumber} confirmed — invoice attached`,
    text,
    html,
    attachment: pdfBuffer ? {
      name: `PixelHouse-Invoice-${model.fileKey}.pdf`,
      base64: pdfBuffer.toString('base64'),
    } : null,
  };
}

// ---- Brevo HTTP API transport (attachment as base64) ----
async function sendOrderViaBrevoApi(toEmail, message) {
  const sender = senderIdentity();
  if (!sender.email) throw new Error('Set MAIL_FROM to a sender address verified in Brevo.');
  const reply = replyToIdentity();
  const body = {
    sender: { name: sender.name, email: sender.email },
    to: [{ email: toEmail }],
    subject: message.subject,
    htmlContent: message.html,
    textContent: message.text,
    ...(reply ? { replyTo: reply } : {}),
    ...(message.attachment ? { attachment: [{ name: message.attachment.name, content: message.attachment.base64 }] } : {}),
  };
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(`Brevo API error ${resp.status}: ${data.message || data.type || JSON.stringify(data)}`);
  }
  console.log(`[EMAIL] order confirmation sent via Brevo API to ${toEmail}`);
  return data;
}

// ---- SMTP transport (nodemailer takes the PDF buffer directly) ----
async function sendOrderViaSmtp(toEmail, message) {
  const t = getTransporter();
  if (!t) throw new Error('SMTP is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS).');
  checkSmtpFromDomain();
  const sender = senderIdentity();
  const reply = replyToIdentity();
  const info = await t.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: toEmail,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: reply ? { 'Reply-To': reply.email } : undefined,
    attachments: message.attachment ? [{
      filename: message.attachment.name,
      content: Buffer.from(message.attachment.base64, 'base64'),
      contentType: 'application/pdf',
    }] : undefined,
  });
  console.log(`[EMAIL] order confirmation sent via SMTP to ${toEmail} (messageId: ${info.messageId})`);
  return info;
}

async function sendOrderConfirmationEmail(toEmail, data) {
  const message = buildOrderMessage(data);
  try {
    if (brevoApiConfigured()) return await sendOrderViaBrevoApi(toEmail, message);
    return await sendOrderViaSmtp(toEmail, message);
  } catch (e) {
    const detail = describeError(e);
    console.error('[EMAIL ERROR]', detail);
    throw new Error(detail);
  }
}

module.exports = { emailEnabled, describeConfig, sendOtpEmail, sendOrderConfirmationEmail };
