const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../js/api-client.js'), 'utf8');
const start = source.indexOf('  function cameraFilterMatches(');
const end = source.indexOf('  function wireCameraFilters(', start);
const context = {};
vm.runInNewContext(source.slice(start, end), context);
const matches = context.cameraFilterMatches;
const values = (extra = {}) => ({ brand: [], compatibility: [], type: [], min: '', max: '', ...extra });
const gopro = { name: 'Telesin Battery GoPro Hero 13', description: 'Replacement battery', price: 7500 };
const dji = { name: 'DJI Action 5Pro/4/3 Lens Cover', price: 1490 };
const insta = { name: 'Insta 360 X4 Silicone Case', price: 1900 };

test('camera filters combine groups with AND and selections within a group with OR', () => {
  assert.ok(matches(gopro, values({ brand: ['gopro', 'dji'], type: ['power'] })));
  assert.equal(matches(dji, values({ brand: ['gopro', 'dji'], type: ['power'] })), false);
  assert.ok(matches(insta, values({ brand: ['insta360'], type: ['case'], compatibility: ['insta360'] })));
  assert.ok(matches(dji, values({ compatibility: ['action'], type: ['lens'] })));
  assert.equal(matches(dji, values({ compatibility: ['pocket'] })), false);
  assert.equal(matches({ name: 'GoPro HERO 13', category: 'Action Cameras' }, values({ compatibility: ['action'] })), false);
});

test('price bounds are inclusive and blank filters preserve the catalog', () => {
  assert.ok(matches(gopro, values({ min: '7500', max: '7500' })));
  assert.equal(matches(gopro, values({ max: '7499' })), false);
  assert.ok(matches({ name: 'Unspecified accessory', price: 0 }, values()));
  assert.equal(matches({ name: 'Unspecified accessory', price: 0 }, values({ compatibility: ['hero'] })), false);
});
