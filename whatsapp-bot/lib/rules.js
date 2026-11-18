'use strict';

// Auto-reply rules engine (pure functions, no I/O).
//
// getReply(text) matches inbound text against FAQ intents and returns a
// reply string, or null when nothing matches confidently. The webhook
// handler sends HOLDING_REPLY for null matches via replyForMessage().
//
// CONTENT RULES (do not weaken these):
// - Only the facts below may be stated. Never invent prices, stock,
//   delivery fees/times, discounts, or opening hours.
// - Replies are short, friendly, simple English, with at most one question.
// - Anything the bot cannot answer confidently (orders, complaints, stock
//   checks, anything else) gets the holding reply and a human follows up.

const SHOP = {
  name: 'PIXELHOUSE',
  town: 'Tangalle',
  country: 'Sri Lanka',
  phone: '0777 466 675',
  tagline: 'Capture Your World',
  website: 'pixelhouse.lk',
};

// Prices in LKR, exactly as approved. Keywords are matched as whole words
// or phrases (word-boundary regex) so "3m" never matches inside "13m".
const PRODUCTS = [
  { name: '50-in-1 Accessories Kit', price: 8000, keywords: ['50-in-1', '50 in 1', '50in1', 'accessories kit'] },
  { name: 'Dome Port', price: 14000, keywords: ['dome port', 'dome'] },
  { name: 'Floating Handle Stick', price: 1200, keywords: ['floating handle', 'float handle', 'floating stick'] },
  { name: '3 Way Selfie Stick', price: 4500, keywords: ['3 way', '3-way', '3way'] },
  { name: '3M Selfie Stick', price: 8500, keywords: ['3m selfie', '3 m selfie', '3 metre', '3 meter', '3-metre', '3-meter', '3m stick', '3m'] },
  { name: 'Helmet Chin Strap Mount', price: 2990, keywords: ['helmet chin', 'chin strap', 'chin mount'] },
  { name: '2.7M Selfie Stick', price: 7400, keywords: ['2.7m', '2.7 m', '2.7 metre', '2.7 meter'] },
  { name: 'Waterproof Diving Case', price: 4300, keywords: ['waterproof', 'diving case', 'waterproof case'] },
  { name: 'Head Strap Mount', price: 1800, keywords: ['head strap', 'head mount'] },
  { name: 'Chest Strap Mount', price: 2499, keywords: ['chest strap', 'chest mount'] },
];

const RENTAL_KEYWORDS = ['rent', 'rental', 'renting', 'hire'];
const DELIVERY_KEYWORDS = ['deliver', 'delivery', 'shipping', 'courier', 'cod', 'cash on delivery', 'send to', 'island wide', 'islandwide'];
const LOCATION_KEYWORDS = ['where', 'location', 'address', 'tangalle', 'directions', 'opening hours', 'open', 'hours', 'what time'];
const PRICE_KEYWORDS = ['price', 'prices', 'pricing', 'cost', 'how much', 'rate', 'rates'];
const GREETING_KEYWORDS = ['hello', 'hi', 'hey', 'good morning', 'good afternoon', 'good evening', 'ayubowan'];

const GREETING_REPLY =
  'Hi! Welcome to PIXELHOUSE — Capture Your World. We sell GoPro cameras, accessories and camera rental in Tangalle. How can I help you today?';

const SELFIE_STICK_REPLY =
  'We have three selfie sticks: 3 Way Selfie Stick Rs. 4,500, 2.7M Selfie Stick Rs. 7,400, and 3M Selfie Stick Rs. 8,500. Which one are you asking about?';

const STRAP_MOUNT_REPLY =
  'We have Head Strap Mount Rs. 1,800, Chest Strap Mount Rs. 2,499, and Helmet Chin Strap Mount Rs. 2,990. Which one do you need?';

const GENERIC_PRICE_REPLY =
  'Which product would you like the price of? We sell GoPro cameras, accessories and camera rental — see the full range at pixelhouse.lk.';

const RENTAL_REPLY =
  'Yes, we offer camera rental. Tell us what gear you need and a team member will help with the details.';

const DELIVERY_REPLY =
  'Yes, delivery is available. A team member will confirm the delivery cost and timing for your area — please share your location.';

const LOCATION_REPLY =
  'We are in Tangalle, Sri Lanka. For opening hours, please message us here and a team member will confirm.';

const HOLDING_REPLY =
  'Thanks for your message! A team member will reply soon. For urgent help, call or message us on 0777 466 675.';

function formatPrice(price) {
  return 'Rs. ' + price.toLocaleString('en-US');
}

function priceReply(product) {
  return (
    'The ' + product.name + ' is ' + formatPrice(product.price) +
    '. Reply here if you would like to order, and a team member will help you.'
  );
}

function normalize(text) {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsPhrase(normalized, phrase) {
  return new RegExp('\\b' + escapeRegExp(phrase) + '\\b').test(normalized);
}

function hasAny(normalized, keywords) {
  return keywords.some((kw) => containsPhrase(normalized, kw));
}

function matchProduct(normalized) {
  for (const product of PRODUCTS) {
    if (hasAny(normalized, product.keywords)) return product;
  }
  return null;
}

function matchIntent(text) {
  if (typeof text !== 'string') return { intent: null, product: null };
  const normalized = normalize(text);
  if (!normalized) return { intent: null, product: null };

  // Most specific first: a named product beats a generic question, and a
  // question beats a bare greeting ("hi, price of chest strap?" -> price).
  const product = matchProduct(normalized);
  if (product) return { intent: 'price', product };
  if (containsPhrase(normalized, 'selfie stick') || containsPhrase(normalized, 'selfie')) {
    return { intent: 'selfie_stick_options', product: null };
  }
  if (containsPhrase(normalized, 'strap') || containsPhrase(normalized, 'mount')) {
    return { intent: 'strap_mount_options', product: null };
  }
  if (hasAny(normalized, RENTAL_KEYWORDS)) return { intent: 'rental', product: null };
  if (hasAny(normalized, DELIVERY_KEYWORDS)) return { intent: 'delivery', product: null };
  if (hasAny(normalized, LOCATION_KEYWORDS)) return { intent: 'location', product: null };
  if (hasAny(normalized, PRICE_KEYWORDS)) return { intent: 'price_generic', product: null };
  if (hasAny(normalized, GREETING_KEYWORDS)) return { intent: 'greeting', product: null };
  return { intent: null, product: null };
}

// Returns a reply string, or null when nothing matches confidently.
function getReply(text) {
  const { intent, product } = matchIntent(text);
  switch (intent) {
    case 'price': return priceReply(product);
    case 'selfie_stick_options': return SELFIE_STICK_REPLY;
    case 'strap_mount_options': return STRAP_MOUNT_REPLY;
    case 'rental': return RENTAL_REPLY;
    case 'delivery': return DELIVERY_REPLY;
    case 'location': return LOCATION_REPLY;
    case 'price_generic': return GENERIC_PRICE_REPLY;
    case 'greeting': return GREETING_REPLY;
    default: return null;
  }
}

// The reply actually sent for a message: the matched FAQ reply, or the
// holding reply when nothing matched (human follows up).
function replyForMessage(text) {
  return getReply(text) || HOLDING_REPLY;
}

module.exports = {
  SHOP,
  PRODUCTS,
  HOLDING_REPLY,
  GREETING_REPLY,
  SELFIE_STICK_REPLY,
  STRAP_MOUNT_REPLY,
  GENERIC_PRICE_REPLY,
  RENTAL_REPLY,
  DELIVERY_REPLY,
  LOCATION_REPLY,
  getReply,
  replyForMessage,
  matchIntent,
  matchProduct,
};
