// Shared demo-seed catalog for development databases.
//
// Used by BOTH engines (server/db.js for SQLite, server/db-pg.js for
// PostgreSQL) so a seeded database looks the same regardless of engine.
//
// Seeding NEVER happens implicitly on PostgreSQL: it runs only when
// SEED_DEMO_DATA=true. SQLite keeps its historical convenience behaviour
// (seed when empty) unless SEED_DEMO_DATA=false.
//
// This module contains no credentials. The demo user's password is hashed at
// seed time from a constant defined in the engine file (never logged).

const SEED_PRODUCTS = [
  { slug: 'single-product', name: '50 in 1 Accessories Kit GoPro', price: 8000, old_price: 13000, image: 'img/product/18.png', badge: 'Sale', featured: 1, flash_sale: 1, description: 'Complete 50-in-1 accessory bundle for GoPro Hero cameras — mounts, straps, grips, cases and more.' },
  { slug: '12in1kit', name: 'GoPro 12 in 1 Kit', price: 4800, old_price: 5990, image: 'img/product/12.png', badge: 'Sale', featured: 1, description: 'Essential 12-in-1 GoPro accessory kit with mounts and straps for everyday shooting.' },
  { slug: '19kit', name: '19 in 1 Kit GoPro', price: 4990, old_price: 5900, image: 'img/product/14.png', badge: 'Sale', featured: 1, flash_sale: 1, description: '19-piece GoPro accessory kit covering helmet, chest, bike and hand mounts.' },
  { slug: '27mstick', name: '2.7M Selfie Stick GoPro', price: 7400, old_price: 10500, image: 'img/product/5.png', badge: 'New', featured: 1, description: 'Extra-long 2.7 metre extendable selfie stick for dramatic wide-angle GoPro shots.' },
  { slug: '3mstick', name: '3M Selfie Stick', price: 8000, old_price: 14000, image: 'img/product/3mstick.png', badge: 'Sale', description: 'Ultra-long 3 metre carbon selfie stick for GoPro and action cameras.' },
  { slug: '3slotcharger', name: '3 Slot Battery Charger', price: 5000, old_price: 7000, image: 'img/product/3slot.png', badge: 'Sale', featured: 1, description: 'Charge three GoPro batteries simultaneously with smart LED indicators.' },
  { slug: '3waystick', name: '3 Way Selfie Stick (Adjustable)', price: 4500, old_price: 5900, image: 'img/product/6.png', badge: 'New', description: '3-way grip, arm and tripod combo — the most versatile GoPro mount.' },
  { slug: 'cover', name: 'GoPro Silicone Case 13/12/11/10/9/8/7/6/5', price: 1990, old_price: 2500, image: 'img/product/15.png', badge: 'Sale', description: 'Soft silicone protective sleeve with lanyard for GoPro Hero 5–13.' },
  { slug: 'domeport', name: 'Dome Port', price: 14000, old_price: 22000, image: 'img/product/domeport.png', badge: 'Sale', featured: 1, description: '6-inch dome port for stunning split over/under water shots.' },
  { slug: 'fhstick', name: 'Floating Handle Stick GoPro', price: 1200, old_price: 1500, image: 'img/product/9.png', badge: '-18%', description: 'Bright floating hand grip keeps your GoPro afloat during water sports.' },
  { slug: 'gbattery', name: 'Telesin Battery GoPro Hero 13/12/11/10/9', price: 7500, old_price: 9500, image: 'img/product/20.png', badge: 'Sale', featured: 1, description: 'High-capacity Telesin replacement battery compatible with Hero 9–13.' },
  { slug: 'goggles', name: 'Goggles With Mount', price: 4700, old_price: 5400, image: 'img/product/21.png', badge: 'New', description: 'Diving goggles with built-in GoPro mount for hands-free underwater filming.' },
  { slug: 'gptemp', name: 'GoPro Tempered Glass', price: 1800, old_price: 2400, image: 'img/product/gptemp.png', badge: 'Sale', description: '9H tempered glass screen and lens protector kit for GoPro.' },
  { slug: 'helmetstrap', name: 'Helmet Chin Strap Mount', price: 2990, old_price: 3300, image: 'img/product/11.png', badge: 'Sale', flash_sale: 1, description: 'Secure chin-strap helmet mount for POV moto and cycling footage.' },
  { slug: 'lensfilter', name: 'GoPro Lens Filter (UnderWater)', price: 6000, old_price: 8500, image: 'img/product/4.png', badge: 'On Sale', description: 'Red/magenta dive filters that restore natural colour underwater.' },
  { slug: 'wpdcase', name: 'Water Proof Diving Case', price: 4300, old_price: 6500, image: 'img/product/8.png', badge: '-11%', description: '45 m waterproof dive housing for GoPro Hero cameras.' },
  { slug: 'x4case1', name: 'Insta 360 X4 Silicone Case', price: 1900, old_price: 2800, image: 'img/product/19.png', badge: 'New', description: 'Shock-absorbing silicone case for the Insta360 X4.' },
  { slug: 'btrychrger13', name: 'Battery charger for Hero 13', price: 8200, old_price: 9400, image: 'img/product/22.png', badge: 'New', description: 'Hero 13 3Slot Battery Charger' },
  { slug: 'antifog', name: 'GoPro Hero Anti-Fog Inserts 12 Pack', price: 300, old_price: 360, image: 'img/product/23.png', badge: 'New', description: 'GoPro Hero Anti-Fogs' },
  { slug: 'hero13', name: 'GoPro Hero 13 Black', price: 92000, old_price: 98000, image: 'img/product/hero13.png', badge: 'New', description: 'GoPro Hero 13 Black' },
  { slug: 'osmocap', name: 'DJI Action 5Pro/4/3 Lens Cover', price: 1490, old_price: 1800, image: 'img/product/osmocap.png', badge: 'New', description: 'Soft Silicone Action Camera Lens Protective Case Cover for Dji Action 5Pro/4/3 ActionCam' },
  { slug: 'osmobag', name: 'All-purpose Set Storage Bag Dji Action', price: 5490, old_price: 6300, image: 'img/product/osmobag.png', badge: 'New', description: 'All-purpose Set Storage Bag Dji Action' },
];

const DEMO_USER = {
  username: 'demo',
  email: 'demo@pixels.com',
  full_name: 'Demo User',
  phone: '+92 300 0000000',
  address: '28/C Green Road',
  balance: 99,
  role: 'owner',
};

const DEFAULT_STORE_SETTINGS = {
  contact: { email: '', phone: '', address: '' },
  payment_methods: ['cash', 'credit-card', 'bank', 'paypal'],
  shipping_fee: 250,
  delivery_options: [
    { method: 'standard', label: 'Regular delivery', fee: 250, enabled: true },
    { method: 'express', label: 'Express delivery', fee: 500, enabled: true },
    { method: 'pickup', label: 'Pickup', fee: 0, enabled: true },
  ],
  notification_preferences: { new_orders: true, low_stock: true, vendor_applications: true },
};

module.exports = { SEED_PRODUCTS, DEMO_USER, DEFAULT_STORE_SETTINGS };
