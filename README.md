# Pixels Store — Full-Stack E-commerce (GoPro & Action Camera Accessories)

Your static "Suha" template is now a working full-stack store: **Node.js + Express + SQLite** backend wired into the existing HTML pages, with **zero changes to the template's design**.

## Quick Start

```bash
npm install
npm start
# → http://localhost:3000
```

**Demo account:** `demo@pixels.com` / `demo1234`

For development with auto-restart: `npm run dev`

## What Now Works (was static before)

| Feature | Pages | Backend |
|---|---|---|
| Register / Login / Logout | `register.html`, `login.html`, sidenav | Session cookies (30 days), bcrypt-hashed passwords |
| Forgot / change password | `forget-password.html`, `otp-confirm.html`, `change-password.html` | 6-digit reset codes (printed to server console in dev) |
| Product catalog | `featured-products.html`, `flash-sale.html`, detail pages | SQLite, seeded with your 17 real products |
| Cart | `cart.html` | Add / update qty / remove, per-user |
| Wishlist | `wishlist-grid.html`, `wishlist-list.html`, heart buttons everywhere | Toggle per user |
| Checkout & orders | `checkout.html`, `my-order.html`, `payment-success.html` | Stock checks, order history, cart clearing |
| Profile | `edit-profile.html`, `checkout.html` billing | Read/update, auto-fills billing info |
| Vendor applications | `become-vendor.html` | Stored for review |
| Contact / support | `contact.html` | Message inbox |
| Notifications | `notifications.html`, sidenav badge | Real unread count, auto-generated on order/welcome |
| AI chat | `message.html` | Gemini proxy — set `GEMINI_API_KEY` env var |
| Admin operations | `admin/` | Role-aware dashboard, orders, products, inventory, users, inbox, vendors and reviews |
| Order fulfillment | Admin order details | Carrier, tracking number, internal notes and status history |
| Branded invoice on every purchase | `payment-success.html`, `my-order.html`, admin orders | Print-ready A4 PDF with the PixelHouse logo, downloaded automatically when the order is placed |
| Inventory controls | Admin inventory | Reorder thresholds, stock adjustments and movement history |
| Administrative audit trail | Admin activity log | Records fulfillment, inventory, product and staff-role changes |

## Project Structure

```
pixels-main/
├── server/
│   ├── index.js    # Express app: static files + API + chat
│   ├── routes.js   # All REST endpoints
│   ├── auth.js     # Session middleware
│   └── db.js       # SQLite schema + product seed
├── js/api-client.js  # Frontend bridge (auto-included in all 67 pages)
├── data/pixels.db    # SQLite database (auto-created)
└── api/chat.js       # Original Vercel-style file (kept; backend now serves /api/chat itself)
```

## API Reference

```
POST   /api/auth/register            { username, email, password }
POST   /api/auth/login               { username, password }
POST   /api/auth/logout
GET    /api/auth/me                  → user + unread notifications + cart count
POST   /api/auth/forgot-password     { email } → generates 6-digit code, emails it (SMTP)
POST   /api/auth/verify-code         { email, code } → checks code without consuming it
POST   /api/auth/reset-password      { email, code, password } → sets new password, kills sessions
POST   /api/auth/change-password     { current_password, new_password } 🔒
PUT    /api/profile                  { username, phone, email, address } 🔒

GET    /api/products                 ?category=&featured=1&flash_sale=1&q=
GET    /api/products/:slug           → product + related + reviews
POST   /api/products/:slug/reviews   { rating, comment } 🔒

GET    /api/cart 🔒                   POST /api/cart 🔒  { product_id, quantity }
PUT    /api/cart/:id 🔒               DELETE /api/cart/:id 🔒

GET    /api/wishlist 🔒               POST /api/wishlist 🔒 (toggle)   DELETE /api/wishlist/:id 🔒

POST   /api/orders 🔒                { full_name, email, phone, address, shipping_method, payment_method }
GET    /api/orders 🔒                 GET /api/orders/:id 🔒

POST   /api/vendor/apply 🔒          { account_type, store_name, location, mobile }
POST   /api/contact                  { name, email, subject, message }
GET    /api/notifications 🔒          POST /api/notifications/read 🔒
POST   /api/chat                     { message } — needs GEMINI_API_KEY
GET    /api/admin/stats              → users / products / orders / revenue counts
GET    /api/admin/inventory          → products needing reorder + stock movement history
POST   /api/admin/inventory/:id/adjust { change, reason, note }
PUT    /api/admin/orders/:id/fulfillment { carrier, tracking_number, internal_notes }
GET    /api/admin/audit-logs         → latest administrative activity

GET    /api/orders/:id/invoice 🔒     → PDF invoice (add ?view=1 to open in the browser, ?format=html for the print-page version)
GET    /api/admin/orders/:id/invoice  → same PDF invoice, for staff (audited)
```

🔒 = requires login (cookie session)

## Deployment

Any Node host works (Railway, Render, VPS, etc.):

1. `npm install && npm start` (set `PORT` via env if needed)
2. Set `GEMINI_API_KEY` if you use the chat feature
3. For production: serve over HTTPS and consider adding `secure: true` to the session cookie in `server/routes.js`

## Production TODOs (currently dev-mode)

- ~~Password reset emails~~ — done: SMTP-based OTP flow (see "Email OTP Setup" above)
- Payments: `checkout-credit-card.html` / `checkout-paypal.html` record the method but don't charge — integrate Stripe/PayPal when ready
- Keep the owner account protected and assign the least-privileged staff role required: order manager, catalog manager, or support
- Add rate limiting (e.g. `express-rate-limit`) on auth endpoints

## Email (OTP + Order Confirmations)

The store sends real emails once a mail transport is configured:

- **Forgot password** — a 6-digit code by email over SMTP, then the user
enters the code (`otp-confirm.html`) and picks a new password (`change-password.html`).
Old sessions are killed on reset, so the user must log in again with the new password.
- **Order confirmation** — sent automatically right after checkout to the
customer's email address (guests included), with a short professional message and
the **branded invoice PDF attached** (`server/mailer.js` → `sendOrderConfirmationEmail`).
The email is sent *after* the checkout response, so a mail outage can never delay
or fail an order; if PDF rendering fails, the email still goes out with the invoice link.

**Flow:** `forget-password.html` → email with 6-digit code (15-min expiry) → `otp-confirm.html`
(verify code) → `change-password.html` (new password) → `forget-password-success.html`.

**Security:** max 3 code requests per email per 15 minutes, max 5 attempts per code,
codes are single-use, new codes invalidate older ones, unknown emails return the same
response (no account enumeration).

### Brevo (recommended — what this deployment uses)

**Option A — Brevo HTTP API (preferred, most reliable).** Only needs HTTPS, so it
works even on hosts that block SMTP ports. Get a key: Brevo → ⚙ Account settings →
**API keys** → create a key with **Transactional** scope.

Railway → your service → **Variables** tab → add → **Redeploy**:
```
BREVO_API_KEY = <your v3 API key>
MAIL_FROM = support@lankalens.online # sender address, verified in Brevo
MAIL_FROM_NAME = PixelHouse          # optional From display name
MAIL_REPLY_TO = support@lankalens.online # optional; where customer replies land
```

**Option B — Brevo SMTP** (used when no API key is set):
```
SMTP_HOST = smtp-relay.brevo.com
SMTP_PORT = 587
SMTP_USER = <SMTP login shown in Brevo: Transactions → SMTP>
SMTP_PASS = <SMTP password from Brevo: Transactions → SMTP>
MAIL_FROM = support@lankalens.online # sender address, verified in Brevo
MAIL_FROM_NAME = PixelHouse          # optional From display name
MAIL_REPLY_TO = support@lankalens.online # optional; where customer replies land
```

Notes:
- The SMTP password is **not** your Brevo login password — copy it under
  Brevo → **Transactions → SMTP**.
- `MAIL_FROM` must be a sender address **verified** in Brevo, otherwise the relay
  rejects the mail with a 550 error (the server log says exactly that when it happens).
- Port 587 uses STARTTLS (automatic). Port 465 (implicit SSL) also works.
- Set `FORCE_DEV_CODES = 1` **locally only** to see the code in the browser instead
  of emailing it (useful when testing the UI without a mail account). Never set it on Railway.

### Gmail (alternative)

```
SMTP_HOST = smtp.gmail.com
SMTP_PORT = 465
SMTP_USER = your-email@gmail.com
SMTP_PASS = <16-char App Password>
```
Get an App Password: myaccount.google.com → Security → turn ON 2-Step Verification →
search "App passwords" → create one for "Mail" → copy the 16-letter code (no spaces).

### Local development

Create a `.env` file in the project root (already git-ignored) with the same variables —
the server loads it automatically and never overrides real environment variables.

Without any SMTP configured, the code prints to the server logs instead (dev mode), so
you can still test the whole flow offline.

### Checking the mail config on a live deployment

The server logs its mail configuration on startup (`[MAIL] enabled — transport: ...`),
and a public endpoint (no secrets) shows the live state:

```
GET https://<your-app>/api/email/status
→ {"email_enabled":true,"transport":"smtp","smtp_host":"smtp-relay.brevo.com",
   "smtp_port":587,"smtp_user":"...","mail_from":"support@lankalens.online",...}
```

If `email_enabled` is `false` on Railway, the env vars did not arrive (check the
Variables tab and redeploy). When a reset email fails, the Railway logs show
`[EMAIL ERROR]` with a specific hint (550 = sender not verified, 535 = wrong SMTP
password, socket = connectivity — in which case use `BREVO_API_KEY` instead).

### Emails going to spam?

See **[EMAIL-DELIVERABILITY.md](EMAIL-DELIVERABILITY.md)** for the full fix — the
short version: authenticate your sender domain in Brevo (SPF/DKIM/DMARC records),
keep `MAIL_FROM` the same address everywhere, and verify with a 10/10 score on
[mail-tester.com](https://www.mail-tester.com). The code already sends
well-formed mail (multipart text+HTML, branded From, Reply-To, calm subjects)
and prints a console warning if the From address looks like spoofing.

## Branded PDF Invoices

When an order is placed the store generates the customer's invoice and the confirmation page downloads it
automatically (`server/invoice.js`).

- **Letterhead** — `img/core-img/pixelhouse-logo-print.png` sits on a dark brand band with the invoice number
  and a payment-status pill (`PAID IN FULL` / `DUE ON DELIVERY` / `CANCELLED`). That file is a trimmed,
  background-matched export of `pixelhouse-logo.jpg`; regenerate it after a logo change:
  ```bash
  convert img/core-img/pixelhouse-logo.jpg -resize 1400x -strip \
    -fuzz 8% -fill '#0B0B0C' -opaque '#000000' -fuzz 3% -trim +repage \
    -colors 256 -dither None -define png:compression-level=9 png8:img/core-img/pixelhouse-logo-print.png
  ```
  Point `INVOICE_LOGO_PATH` at another PNG/JPG to use a different logo (transparent, or on `#0B0B0C`, so the
  band stays seamless).
- **Store identity** — store name, currency and the contact line in the footer come from
  Admin → Settings (`store_settings`), and `PUBLIC_URL` / `SITE_URL` is printed as the website when set.
- **Content** — billed-to and deliver-to blocks, courier + tracking number when filled in, itemised lines with
  the product SKU, subtotal / discount with the coupon code / delivery / amount due, payment terms, the
  transaction reference once paid, and page numbers. Internal admin notes are never printed.
- **Numbering** — `PH-INV-<year>-<order id, 5 digits>`; the same number is returned by `POST /api/orders` and
  shown on `payment-success.html`, and the file is saved as `PixelHouse-Invoice-<year>-<id>.pdf`.
- **Fallbacks** — the document is rendered with `pdfkit` (pure JS, no system binaries). If it is ever missing,
  the endpoint still serves a styled, printable HTML invoice instead of failing. Request
  `?format=html` to get that page on purpose, `?view=1` to open the PDF in the browser rather than download it.
