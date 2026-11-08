const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/api-client.js'), 'utf8');

function harness(pathname = '/') {
  let product = { slug: 'fhstick', rating: 5, rating_count: 1 };
  let fail = false;
  const rating = { outerHTML: 'No reviews yet' };
  const staticCard = { querySelector: selector => selector === '.product-rating' ? rating : { getAttribute: () => 'fhstick.html' } };
  const dynamicRating = { outerHTML: 'No reviews yet' };
  const dynamicCard = { querySelector: selector => selector === '.product-rating' ? dynamicRating : { getAttribute: () => 'single-product.html?product=fhstick' } };
  const events = {}, windowEvents = {}, dispatched = [], requests = [];
  let tick;
  const document = { visibilityState: 'visible', querySelectorAll: () => [staticCard, dynamicCard],
    addEventListener: (name, callback) => { events[name] = callback; },
    dispatchEvent: event => { dispatched.push(event.type); } };
  const context = { document, location: { pathname, href: 'https://pixelhouse.lk' + pathname }, URL, URLSearchParams,
    window: { addEventListener: (name, callback) => { windowEvents[name] = callback; } },
    CustomEvent: class { constructor(type) { this.type = type; } },
    setInterval: callback => { tick = callback; },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (fail) throw new Error('Offline');
      return { ok: true, json: async () => ({ products: [product] }) };
    } };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.homeTest = { refreshHomepageRatings, startHomepageRatingSync, productRatingHTML };})();'), context);
  return { api: context.homeTest, rating, dynamicRating, events, windowEvents, dispatched, requests, document,
    setProduct: value => { product = value; }, fail: () => { fail = true; }, tick: () => tick() };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test('root homepage and its aliases replace static placeholders with the actual rating and count', async () => {
  for (const pathname of ['/', '/home.html', '/index.html']) {
    const h = harness(pathname);
    await h.api.refreshHomepageRatings();
    assert.match(h.rating.outerHTML, /5\.0/);
    assert.match(h.rating.outerHTML, /1 review/);
    assert.equal(h.rating.outerHTML, h.dynamicRating.outerHTML);
    assert.equal(h.requests[0].options.cache, 'no-store');
    assert.deepEqual(h.dispatched, ['pixelhouse:reviews-refreshed']);
  }
});

test('periodic/focus/tab notifications refresh counts while failed requests preserve the last good result', async () => {
  const h = harness();
  h.api.startHomepageRatingSync(); await flush();
  h.setProduct({ slug: 'fhstick', rating: 4.5, rating_count: 2 });
  h.tick(); await flush();
  assert.match(h.rating.outerHTML, /2 reviews/);
  assert.match(h.rating.outerHTML, /4\.5/);
  assert.equal(h.dispatched.length, 2);
  h.windowEvents.focus(); await flush();
  h.windowEvents.storage({ key: 'pixelhouse:reviews-updated' }); await flush();
  h.events.visibilitychange(); await flush();
  assert.equal(h.dispatched.length, 2, 'Unchanged counts must not keep resetting the review carousel');
  const before = h.requests.length;
  h.document.visibilityState = 'hidden';
  h.tick(); await flush();
  assert.equal(h.requests.length, before);
  const previous = h.rating.outerHTML;
  h.fail();
  await h.api.refreshHomepageRatings();
  assert.equal(h.rating.outerHTML, previous);
});

test('zero reviews remain honest and non-home pages do not start polling', async () => {
  const h = harness('/products.html');
  h.api.startHomepageRatingSync();
  await h.api.refreshHomepageRatings();
  assert.equal(h.requests.length, 0);
  assert.match(h.api.productRatingHTML({ rating: 5, rating_count: 0 }), /No reviews yet/);
  assert.match(h.api.productRatingHTML({ rating: 5, rating_count: 12 }), /12 reviews/);
});
