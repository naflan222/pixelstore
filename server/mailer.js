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
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  if (!from) throw new Error('Set MAIL_FROM to a sender address verified in Brevo.');
  const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': process.env.BREVO_API_KEY,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: { name: 'Pixels Store', email: from },
      to: [{ email: toEmail }],
      subject: 'Your Pixels password reset code',
      htmlContent: otpHtml(code),
      content: otpText(code),
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
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  const info = await t.sendMail({
    from: `"Pixels Store" <${from}>`,
    to: toEmail,
    subject: 'Your Pixels password reset code',
    text: otpText(code),
    html: otpHtml(code),
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

module.exports = { emailEnabled, sendOtpEmail };
