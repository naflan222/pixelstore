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
| Owner stats | — | `GET /api/admin/stats` |

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
```

🔒 = requires login (cookie session)

## Deployment

Any Node host works (Railway, Render, VPS, etc.):

1. `npm install && npm start` (set `PORT` via env if needed)
2. Set `GEMINI_API_KEY` if you use the chat feature
3. For production: serve over HTTPS and consider adding `secure: true` to the session cookie in `server/routes.js`

## Production TODOs (currently dev-mode)

- Password reset codes are printed to the server console — hook up an email/SMS provider (e.g. Resend, Twilio)
- Payments: `checkout-credit-card.html` / `checkout-paypal.html` record the method but don't charge — integrate Stripe/PayPal when ready
- `api/admin/stats` is open — protect it with an admin role check before going live
- Add rate limiting (e.g. `express-rate-limit`) on auth endpoints

## Email OTP Setup (Forgot Password)

The forgot-password flow sends a real 6-digit code by email once SMTP is configured.

**Railway:** Variables tab → add these 4 variables → redeploy:
```
SMTP_HOST = smtp.gmail.com
SMTP_PORT = 465
SMTP_USER = your-email@gmail.com
SMTP_PASS = your-16-char-Gmail-App-Password
```

**Get a Gmail App Password:** myaccount.google.com → Security → turn ON 2-Step Verification → search "App passwords" → create one for "Mail" → copy the 16-letter code (no spaces).

Without SMTP configured, the code prints to the server logs instead (dev mode).
