// Email sending via SMTP (Gmail, Outlook, or any SMTP provider)
// Configure with environment variables:
//   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, MAIL_FROM
// For Gmail: SMTP_HOST=smtp.gmail.com SMTP_PORT=465 SMTP_USER=you@gmail.com SMTP_PASS=<16-char App Password>
const nodemailer = require('nodemailer');

let transporter = null;

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

async function sendOtpEmail(toEmail, code) {
  const t = getTransporter();
  if (!t) throw new Error('Email is not configured on the server.');
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  await t.sendMail({
    from: `"Pixels Store" <${from}>`,
    to: toEmail,
    subject: 'Your Pixels password reset code',
    text: `Your password reset code is: ${code}\n\nIt expires in 15 minutes. If you didn't request this, ignore this email.`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;border:1px solid #eee;border-radius:12px">
        <h2 style="color:#625AFA;margin:0 0 12px">Pixels Store</h2>
        <p>Your password reset code is:</p>
        <div style="font-size:32px;letter-spacing:8px;font-weight:bold;background:#f4f3ff;padding:16px;text-align:center;border-radius:8px;color:#625AFA">${code}</div>
        <p style="color:#888;font-size:13px;margin-top:16px">Expires in 15 minutes. If you didn't request this, you can ignore this email.</p>
      </div>`,
  });
}

module.exports = { emailEnabled, sendOtpEmail };
