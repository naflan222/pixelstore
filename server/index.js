// Pixels store — Express server (API + static frontend)
const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const { attachUser } = require('./auth');
const apiRoutes = require('./routes');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(attachUser);

// ---- Chat endpoint ----
// Works in TWO modes:
//  1) Built-in smart shop assistant (always available, answers from the real product DB)
//  2) Gemini AI (used automatically when GEMINI_API_KEY is set)

function shopAssistant(message) {
  const msg = String(message).toLowerCase();
  const products = db.prepare('SELECT name, price, old_price, slug, stock, badge FROM products').all();
  const fmt = (n) => 'Rs. ' + Number(n).toLocaleString('en-US');

  // Product search: match any word of the question against product names
  const words = msg.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2);
  const matches = products.filter(p =>
    words.some(w => p.name.toLowerCase().includes(w))
  );

  if (/price|cost|how much|rate/.test(msg) && matches.length) {
    const p = matches[0];
    return `The ${p.name} costs ${fmt(p.price)}${p.old_price ? ` (was ${fmt(p.old_price)})` : ''}. We currently have ${p.stock} in stock — you can add it to your cart right from the product page!`;
  }
  if (matches.length) {
    const list = matches.slice(0, 3).map(p => `• ${p.name} — ${fmt(p.price)}`).join('\n');
    return `Here's what I found for you:\n${list}\n\nWould you like the price or details of any of these?`;
  }
  if (/cheap|budget|low price|afford/.test(msg)) {
    const cheapest = [...products].sort((a, b) => a.price - b.price).slice(0, 3);
    return 'Our most affordable items right now:\n' + cheapest.map(p => `• ${p.name} — ${fmt(p.price)}`).join('\n');
  }
  if (/sale|offer|discount|deal|flash/.test(msg)) {
    const onSale = products.filter(p => p.old_price).slice(0, 4);
    return 'Here are our current deals:\n' + onSale.map(p => `• ${p.name} — ${fmt(p.price)} (was ${fmt(p.old_price)})`).join('\n');
  }
  if (/buy|order|how can i get|purchase/.test(msg))
    return 'Ordering is easy — no account needed! Just tap a product, hit the "+" button to add it to your cart, then open the Cart tab and tap "Checkout Now". Fill in your name, phone and address, choose delivery and payment — done! 🛒';
  if (/shipping|deliver|courier|dispatch/.test(msg))
    return 'We offer three delivery options at checkout: Fast Shipping (1 day, Rs. 500), Regular (3–7 days, Rs. 250), and Courier (5–8 days, free). You can pick your preferred one on the checkout page.';
  if (/payment|pay|card|paypal|cash/.test(msg))
    return 'We accept Cash on Delivery, Credit/Debit Card, Bank Transfer and PayPal. You can choose your payment method at checkout.';
  if (/order|track|status|purchase/.test(msg))
    return 'You can see all your orders on the "My Orders" page (my-order.html) after logging in. Each order shows its items, total and status.';
  if (/return|refund|exchange|warranty/.test(msg))
    return 'For returns, refunds or warranty questions, please reach out via our Contact page and the PixelHouse team will help you within 24 hours.';
  if (/hi|hello|hey|assalam|salam/.test(msg))
    return 'Hello! 👋 Welcome to PixelHouse. I can help you find GoPro accessories, check prices, explain shipping or payments. What are you looking for?';
  if (/thank/.test(msg))
    return 'You\'re most welcome! Happy shooting 📷 Anything else I can help with?';

  return 'I can help with product prices, availability, current deals, shipping options and payment methods. Try asking "price of dome port" or "any deals?" 😊';
}

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: 'Message is required.' });

    // Mode 2: Gemini when an API key is configured
    if (process.env.GEMINI_API_KEY) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: message }] }] }),
        }
      );
      const data = await response.json();
      if (response.ok && data.candidates && data.candidates.length)
        return res.json({ reply: data.candidates[0].content.parts[0].text });
      // Fall through to the built-in assistant if Gemini fails
    }

    // Mode 1: built-in assistant (always works)
    res.json({ reply: shopAssistant(message) });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---- Store API ----
app.use('/api', apiRoutes);

// ---- Admin-lite stats (useful for the shop owner) ----
app.get('/api/admin/stats', (req, res) => {
  res.json({
    users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
    products: db.prepare('SELECT COUNT(*) c FROM products').get().c,
    orders: db.prepare('SELECT COUNT(*) c FROM orders').get().c,
    revenue: db.prepare("SELECT COALESCE(SUM(total),0) t FROM orders WHERE status != 'cancelled'").get().t,
    vendor_applications: db.prepare('SELECT COUNT(*) c FROM vendor_applications').get().c,
    contact_messages: db.prepare('SELECT COUNT(*) c FROM contact_messages').get().c,
  });
});

// ---- Static frontend (all existing HTML/CSS/JS/images stay untouched at the root) ----
app.use(express.static(path.join(__dirname, '..')));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => console.log(`Pixels server running at http://localhost:${PORT}`));
