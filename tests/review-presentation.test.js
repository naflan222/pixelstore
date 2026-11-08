const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../js/api-client.js'), 'utf8');
const review = { username: 'Ags Lakshan', rating: 5, comment: 'Great quality floating hand grip!',
  created_at: '2026-11-07 15:38:21.586484+00', product_name: 'Floating Handle', product_slug: 'fhstick' };
const flush = () => new Promise(resolve => setImmediate(resolve));

function load({ pathname = '/fhstick.html', document = { addEventListener() {} }, fetch = async () => {
  throw new Error('Offline');
} } = {}) {
  const context = { document, fetch, location: { pathname, search: '' }, URLSearchParams, Intl, Date,
    CustomEvent: class { constructor(type) { this.type = type; } }, setTimeout: () => 0 };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, 'globalThis.reviewsTest = { reviewDetails, productReviewHTML, footerReviewHTML, ensureStoreFooter, wireProductReviews, setUser: user => { currentUser = user; } };})();'), context);
  return context.reviewsTest;
}

test('review dates support SQLite and PostgreSQL timestamps without exposing raw values', () => {
  const api = load();
  for (const created_at of ['2026-11-07 15:38:21', '2026-11-07T15:38:21.586Z', review.created_at]) {
    const details = api.reviewDetails({ ...review, created_at });
    assert.equal(details.date, '7 Nov 2026');
    assert.match(details.dateTime, /^2026-11-07T15:38:21/);
  }
  for (const created_at of ['', null, 'not a date']) assert.equal(api.reviewDetails({ ...review, created_at }).date, '');
});

test('review cards place the public reviewer name before stars and comment, using initials instead of a stock photo', () => {
  const api = load();
  const html = api.productReviewHTML(review);
  assert.match(html, /class="review-avatar"[^>]*>AL<\/span>/);
  assert.ok(html.indexOf('Ags Lakshan') < html.indexOf('Great quality'));
  assert.ok(html.indexOf('Ags Lakshan') < html.indexOf('class="rating"'));
  assert.match(html, /aria-label="5 out of 5 stars"/);
  assert.match(html, />7 Nov 2026<\/time>/);
  assert.doesNotMatch(html, /<img|9\.jpg|586484\+00|Verified/);
  assert.equal(api.reviewDetails({ username: 'agslakshan' }).initials, 'AG');
  assert.equal(api.reviewDetails({ username: ' ' }).name, 'Customer');
  assert.match(api.productReviewHTML({ ...review, comment: '' }), /Rated this product/);
});

test('untrusted review fields are escaped and all footer cards use the same name/date format', () => {
  const api = load();
  const bad = { ...review, username: '<img src=x onerror=alert(1)>', comment: '<script>alert(1)</script>',
    product_name: '<svg onload=alert(1)>', product_slug: 'x" onclick="bad' };
  for (const html of [api.productReviewHTML(bad), api.footerReviewHTML(bad)]) {
    assert.doesNotMatch(html, /<script>|<img src=x|<svg onload=/);
    assert.match(html, /&lt;script&gt;/);
  }
  const html = api.footerReviewHTML(review);
  assert.ok(html.indexOf('Ags Lakshan') < html.indexOf('Great quality'));
  assert.match(html, /product=fhstick/);
  assert.match(html, />7 Nov 2026<\/time>/);
});

function element() {
  return { textContent: '', innerHTML: '', hidden: false, disabled: false, attributes: {}, listeners: {},
    classList: { add() {}, remove() {} }, setAttribute(k, v) { this.attributes[k] = v; },
    removeAttribute(k) { delete this.attributes[k]; }, addEventListener(k, v) { this.listeners[k] = v; },
    insertAdjacentHTML(_where, value) { this.innerHTML += value; } };
}

test('anonymous product visitors can read reviews even when no review-submission form is present', async () => {
  const list = element(), summary = element();
  const api = load({ document: { addEventListener() {}, querySelector(selector) {
    if (selector === '.rating-review-content ul') return list;
    if (selector === '#productRatingSummary') return summary;
    return null;
  } }, fetch: async () => ({ ok: true, json: async () => ({ product: { rating: 5 }, reviews: [review] }) }) });
  await api.wireProductReviews();
  assert.match(list.innerHTML, /Ags Lakshan/);
  assert.match(summary.innerHTML, /1 customer review/);
  assert.doesNotMatch(summary.innerHTML, /Verified/);
});

test('submitting a review refreshes the public list and notifies the footer immediately', async () => {
  const list = element(), summary = element(), form = element();
  const notice = { style: {} };
  form.parentElement = { querySelector: () => notice };
  form.querySelector = selector => selector.includes('star') ? { id: 'star5' } : { value: 'My new review' };
  form.reset = () => {};
  const events = [];
  let posted = false;
  const api = load({ document: { addEventListener() {}, dispatchEvent(event) { events.push(event.type); }, querySelector(selector) {
    if (selector === '.ratings-submit-form form') return form;
    if (selector === '.rating-review-content ul') return list;
    if (selector === '#productRatingSummary') return summary;
    return null;
  } }, fetch: async (_url, options) => {
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.comment, 'My new review');
      assert.equal(body.rating, 5);
      posted = true;
      return { ok: true, json: async () => ({ ok: true }) };
    }
    return { ok: true, json: async () => ({ product: { rating: 5 }, reviews: posted ? [review, { ...review, comment: 'My new review' }] : [review] }) };
  } });
  api.setUser({ id: 1 });
  await api.wireProductReviews();
  await form.listeners.submit({ preventDefault() {} });
  assert.match(list.innerHTML, /My new review/);
  assert.match(summary.innerHTML, /2 customer reviews/);
  assert.deepEqual(events, ['pixelhouse:review-published']);
  assert.equal(notice.textContent, 'Your review is now live.');
});

function footerHarness(home, failMore = false) {
  const selectors = ['.site-footer-manual-review-card', '[data-manual-review-text]', '[data-manual-review-author]',
    '[data-manual-review-position]', '[data-review-avatar]', '[data-review-date]', '[data-review-stars]',
    '[data-review-source]', '[data-review-product]', '[data-manual-review-prev]', '[data-manual-review-next]',
    '[data-customer-reviews]', '[data-review-more]'];
  const nodes = Object.fromEntries(selectors.map(selector => [selector, element()]));
  const footer = element(); footer.querySelector = selector => nodes[selector];
  const events = {};
  const document = { addEventListener(name, callback) { events[name] = callback; },
    createElement: () => footer, querySelector: selector => selector === '#footerNav' ? { before() {} } : null };
  const requests = [];
  const fetch = async url => {
    requests.push(url);
    const page = Number(new URL(url, 'https://pixelhouse.lk').searchParams.get('page'));
    if (failMore && page === 2) throw new Error('Offline');
    const start = (page - 1) * 6;
    return { ok: true, json: async () => ({ reviews: Array.from({ length: page === 1 ? 6 : 2 }, (_, i) => ({
      ...review, username: 'Customer ' + (start + i + 1), comment: 'Review ' + (start + i + 1),
    })), pagination: { page, pages: 2, total: 8, limit: 6 } }) };
  };
  const api = load({ pathname: home ? '/' : '/fhstick.html', document, fetch });
  api.ensureStoreFooter();
  return { nodes, requests, events };
}

test('homepage shows actual published reviews and lets visitors reach reviews beyond the first six', async () => {
  const { nodes, requests } = footerHarness(true);
  await flush();
  assert.equal(nodes['[data-manual-review-author]'].textContent, 'Customer 1');
  assert.equal(nodes['[data-review-source]'].textContent, 'Customer review');
  for (let i = 0; i < 7; i++) { nodes['[data-manual-review-next]'].listeners.click(); await flush(); }
  assert.equal(nodes['[data-manual-review-author]'].textContent, 'Customer 8');
  assert.equal(nodes['[data-manual-review-position]'].textContent, '8 / 8');
  assert.equal(nodes['[data-manual-review-next]'].disabled, true);
  assert.ok(requests.some(url => url.endsWith('page=2')));
});

test('footer load-more retains existing cards and makes all pages available', async () => {
  const { nodes, events } = footerHarness(false);
  await flush();
  const list = nodes['[data-customer-reviews]'], more = nodes['[data-review-more]'];
  assert.equal((list.innerHTML.match(/<article/g) || []).length, 6);
  assert.equal(more.hidden, false);
  more.listeners.click(); await flush();
  assert.equal((list.innerHTML.match(/<article/g) || []).length, 8);
  assert.equal(more.hidden, true);
  events['pixelhouse:review-published'](); await flush();
  assert.equal((list.innerHTML.match(/<article/g) || []).length, 6);
  const css = fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8');
  assert.doesNotMatch(css, /site-footer-review:nth-child\(n\+4\)/);
});

test('a failed next-page request leaves existing reviews visible and offers a retry', async () => {
  const { nodes } = footerHarness(false, true);
  await flush();
  const list = nodes['[data-customer-reviews]'], before = list.innerHTML;
  nodes['[data-review-more]'].listeners.click(); await flush();
  assert.equal(list.innerHTML, before);
  assert.equal(nodes['[data-review-more]'].textContent, 'Try again');
  assert.equal(nodes['[data-review-more]'].disabled, false);
});
