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
POST   /api/auth/forgot-password     { email } → generates 6-digit code
POST   /api/auth/reset-password      { email, code, password }
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

- Payments: `checkout-credit-card.html` / `checkout-paypal.html` record the method but don't charge — integrate Stripe/PayPal when ready
- Keep the owner account protected and assign the least-privileged staff role required: order manager, catalog manager, or support
- Add rate limiting (e.g. `express-rate-limit`) on auth endpoints

## Email (SMTP)

Once SMTP is configured the store sends real emails automatically:

- **Forgot password** — a 6-digit reset code (`forget-password.html`)
- **Order confirmation** — sent right after checkout to the customer's email
  (works for guests too, using the address typed at checkout) with a short
  professional message and the **branded invoice PDF attached**
  (`server/mailer.js` → `sendOrderConfirmationEmail`)

**Railway:** Variables tab → add these variables → redeploy:
```
SMTP_HOST = smtp.gmail.com
SMTP_PORT = 465
SMTP_USER = your-email@gmail.com
SMTP_PASS = your-16-char-Gmail-App-Password
MAIL_FROM_NAME = PixelHouse            # optional display name (default "PixelHouse")
MAIL_REPLY_TO = support@yourdomain.com # optional; where replies go
MAIL_FROM   = same as SMTP_USER        # keep equal, or see the deliverability guide
```

**Get a Gmail App Password:** myaccount.google.com → Security → turn ON 2-Step Verification → search "App passwords" → create one for "Mail" → copy the 16-letter code (no spaces).

Without SMTP configured, the reset code prints to the server logs instead (dev mode) and order emails are skipped.

**Emails going to spam?** See **[EMAIL-DELIVERABILITY.md](EMAIL-DELIVERABILITY.md)** —
the short version: keep `MAIL_FROM` equal to `SMTP_USER`, and if you send from a
custom domain, publish **SPF + DKIM + DMARC** DNS records (the guide has copy-paste
values and a 10/10 [mail-tester.com](https://www.mail-tester.com) checklist).

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
