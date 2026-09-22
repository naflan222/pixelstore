const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const page = name => fs.readFileSync(path.join(root, name), 'utf8');

test('category pages use matching banner assets', () => {
  assert.match(page('actioncamera.html'), /img\/bg-img\/5\.jpg/);
  assert.match(page('catagory.html'), /img\/bg-img\/gopro-accessories-premium\.webp/);
  assert.match(page('insta360-camera.html'), /img\/bg-img\/insta360-cameras-premium\.webp/);
  assert.match(page('360accesories.html'), /img\/bg-img\/insta360-accessories-premium\.webp/);
  assert.match(page('dji-osmo-camera.html'), /img\/bg-img\/osmobanner\.jpg/);
  assert.match(page('osmocat.html'), /img\/bg-img\/osmobanner\.jpg/);
  assert.match(page('rental-services.html'), /img\/bg-img\/rental-banner\.jpg/);
  assert.match(page('camera-trade.html'), /img\/bg-img\/camera-trade-banner\.jpg/);
});

test('category headings identify the selected product family', () => {
  assert.match(page('catagory.html'), />GoPro Accessories</);
  assert.match(page('insta360-camera.html'), />Insta360 Cameras</);
  assert.match(page('360accesories.html'), />Insta360 Accessories</);
});

test('premium category banners keep accessible labels and model copy', () => {
  assert.match(page('catagory.html'), /aria-label="Premium GoPro accessories collection"/);
  assert.match(page('insta360-camera.html'), />Insta360 Cameras</);
  assert.match(page('360accesories.html'), />Insta360 X4 Accessories</);
});
