// Engine-agnostic API suite: identical behaviour is asserted on SQLite and
// PostgreSQL. Runners: tests/api-sqlite.test.js, tests/api-pg.test.js.
//
// ctx = { base, db, makeSession, engine, realTransactions }
//   realTransactions is false ONLY on the pg-mem test double, which cannot
//   roll back (verified by probe). Rollback/race semantics are fully asserted
//   on SQLite here and on real PostgreSQL via TEST_DATABASE_URL / staging.
const assert = require('node:assert/strict');

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function defineSuite(t, ctx) {
  const state = {};
  const owner = ctx.makeSession();
  const bob = ctx.makeSession();
  const alice = ctx.makeSession();
  const guest = ctx.makeSession();

  await t.test('health reports engine without secrets', async () => {
    const { status, data, headers } = await guest.get('/api/health');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.engine, ctx.engine);
    assert.equal(data.db_reachable, true);
    assert.equal(data.maintenance, false);
    assert.ok(!JSON.stringify(data).includes('postgres://'));
    assert.ok(!JSON.stringify(data).includes('DATABASE_URL'));
    assert.equal(headers.get('x-content-type-options'), 'nosniff');
    assert.equal(headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  });

  await t.test('seeded catalog present', async () => {
    const { status, data } = await guest.get('/api/products');
    assert.equal(status, 200);
    assert.equal(data.products.length, 22);
    const dome = data.products.find((p) => p.slug === 'domeport');
    assert.ok(dome);
    assert.equal(dome.name, 'Dome Port');
    assert.equal(typeof dome.stock, 'number');
    assert.equal(typeof dome.created_at, 'string');
  });

  await t.test('product search is case-insensitive', async () => {
    const lower = await guest.get('/api/products?q=dome');
    const upper = await guest.get('/api/products?q=DOME');
    assert.equal(lower.status, 200);
    assert.ok(lower.data.products.length >= 1);
    assert.deepEqual(
      lower.data.products.map((p) => p.slug).sort(),
      upper.data.products.map((p) => p.slug).sort()
    );
    const none = await guest.get('/api/products?q=zzz-no-such-product');
    assert.deepEqual(none.data.products, []);
    const featured = await guest.get('/api/products?featured=1');
    assert.ok(featured.data.products.every((p) => p.featured === 1));
  });

  await t.test('public category catalog follows admin status and deletion changes', async () => {
    await owner.post('/api/auth/login', { username: 'demo', password: 'demo1234' });
    const category = await owner.post('/api/admin/categories', { name: 'Dynamic Test Category', slug: 'dynamic-test-category' });
    assert.equal(category.status, 201);
    const created = await owner.post('/api/admin/products', {
      name: 'Dynamic Test Product', slug: 'dynamic-test-product', price: 1250,
      category_id: category.data.id, image: PNG_1PX, status: 'active',
    });
    assert.equal(created.status, 201);

    let listing = await guest.get('/api/products?category=dynamic-test-category');
    assert.equal(listing.status, 200);
    assert.equal(listing.data.products.length, 1);
    assert.equal(listing.data.products[0].slug, 'dynamic-test-product');
    assert.equal(listing.data.products[0].category_name, 'Dynamic Test Category');

    const hidden = await owner.put(`/api/admin/products/${created.data.id}`, {
      name: 'Dynamic Test Product', slug: 'dynamic-test-product', price: 1250,
      category_id: category.data.id, status: 'inactive',
    });
    assert.equal(hidden.status, 200);
    listing = await guest.get('/api/products?category=Dynamic Test Category');
    assert.deepEqual(listing.data.products, []);
    assert.equal((await guest.get('/api/products/dynamic-test-product')).status, 404);

    await owner.del(`/api/admin/products/${created.data.id}`);
    await owner.del(`/api/admin/categories/${category.data.id}`);
  });

  await t.test('product detail has related + reviews', async () => {
    const { status, data } = await guest.get('/api/products/domeport');
    assert.equal(status, 200);
    assert.equal(data.product.slug, 'domeport');
    assert.equal(data.related.length, 4);
    assert.deepEqual(data.reviews, []);
    const missing = await guest.get('/api/products/nope-missing');
    assert.equal(missing.status, 404);
  });

  await t.test('register validation + duplicates', async () => {
    let r = await bob.post('/api/auth/register', { username: 'bob', email: 'bob@example.com', password: 'bobpass12' });
    assert.equal(r.status, 200);
    assert.equal(r.data.ok, true);
    state.bobId = (await ctx.db.get('SELECT id FROM users WHERE email = ?', 'bob@example.com')).id;
    r = await alice.post('/api/auth/register', { username: 'alice2', email: 'alice2@example.com', password: 'alicepass12' });
    assert.equal(r.status, 200);
    r = await guest.post('/api/auth/register', { username: 'bob', email: 'other@example.com', password: 'otherpass12' });
    assert.equal(r.status, 409);
    r = await guest.post('/api/auth/register', { username: 'other', email: 'bob@example.com', password: 'otherpass12' });
    assert.equal(r.status, 409);
    r = await guest.post('/api/auth/register', { username: 'short', email: 'short@example.com', password: '123' });
    assert.equal(r.status, 400);
    r = await guest.post('/api/auth/register', { username: 'noemail' });
    assert.equal(r.status, 400);
  });

  await t.test('login, me, logout', async () => {
    let r = await bob.post('/api/auth/login', { username: 'bob', password: 'wrongpass' });
    assert.equal(r.status, 401);
    r = await bob.post('/api/auth/login', { username: 'bob', password: 'bobpass12' });
    assert.equal(r.status, 200);
    r = await bob.get('/api/auth/me');
    assert.equal(r.status, 200);
    assert.equal(r.data.user.username, 'bob');
    assert.equal(r.data.unread_notifications, 1); // welcome notification
    assert.equal(typeof r.data.cart_count, 'number');
    r = await bob.post('/api/auth/logout');
    assert.equal(r.status, 200);
    r = await bob.get('/api/auth/me');
    assert.equal(r.status, 401);
  });

  await t.test('profile update + clash', async () => {
    await bob.post('/api/auth/login', { username: 'bob', password: 'bobpass12' });
    let r = await bob.put('/api/profile', { username: 'bob', phone: '+1 555', email: 'bob@example.com', address: 'Somewhere' });
    assert.equal(r.status, 200);
    r = await bob.get('/api/auth/me');
    assert.equal(r.data.user.phone, '+1 555');
    r = await bob.put('/api/profile', { username: 'alice2', email: 'bob@example.com' });
    assert.equal(r.status, 409);
  });

  await t.test('forgot / verify / reset flow (dev codes, no mail)', async () => {
    let r = await guest.post('/api/auth/forgot-password', { email: 'bob@example.com' });
    assert.equal(r.status, 200);
    assert.match(r.data.dev_code, /^\d{6}$/);
    const code = r.data.dev_code;
    r = await guest.post('/api/auth/verify-code', { email: 'bob@example.com', code: '000000' });
    assert.equal(r.status, 400);
    r = await guest.post('/api/auth/verify-code', { email: 'bob@example.com', code });
    assert.equal(r.status, 200);
    r = await guest.post('/api/auth/reset-password', { email: 'bob@example.com', code, password: '123' });
    assert.equal(r.status, 400);
    r = await guest.post('/api/auth/reset-password', { email: 'bob@example.com', code, password: 'bobnewpass12' });
    assert.equal(r.status, 200);
    // Sessions killed by the reset: bob's cookie is dead, old password is dead.
    r = await bob.get('/api/auth/me');
    assert.equal(r.status, 401);
    r = await bob.post('/api/auth/login', { username: 'bob', password: 'bobpass12' });
    assert.equal(r.status, 401);
    r = await bob.post('/api/auth/login', { username: 'bob', password: 'bobnewpass12' });
    assert.equal(r.status, 200);
    // Unknown emails get the same shape (no enumeration).
    r = await guest.post('/api/auth/forgot-password', { email: 'ghost@example.com' });
    assert.equal(r.status, 200);
    assert.equal(r.data.dev_code, undefined);
    // Rate limit: 3 requests per 15 minutes (bob already used 1 above).
    await guest.post('/api/auth/forgot-password', { email: 'bob@example.com' });
    await guest.post('/api/auth/forgot-password', { email: 'bob@example.com' });
    r = await guest.post('/api/auth/forgot-password', { email: 'bob@example.com' });
    assert.equal(r.status, 429);
  });

  await t.test('password reset locks after repeated incorrect codes', async () => {
    let r = await guest.post('/api/auth/forgot-password', { email: 'alice2@example.com' });
    assert.equal(r.status, 200);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      r = await guest.post('/api/auth/verify-code', { email: 'alice2@example.com', code: '000000' });
    }
    assert.equal(r.status, 429);
    const reset = await ctx.db.get('SELECT attempts, used FROM password_resets WHERE email = ? ORDER BY id DESC LIMIT 1', 'alice2@example.com');
    assert.equal(Number(reset.attempts), 5);
    assert.equal(Number(reset.used), 1);
  });

  await t.test('legacy demo storefront pages redirect to real products', async () => {
    const response = await fetch(ctx.base + '/featured-products.html', { redirect: 'manual' });
    assert.equal(response.status, 301);
    assert.equal(response.headers.get('location'), '/products.html');
    for (const paymentPage of ['checkout-credit-card.html', 'checkout-paypal.html']) {
      const paymentResponse = await fetch(`${ctx.base}/${paymentPage}`, { redirect: 'manual' });
      assert.equal(paymentResponse.status, 301);
      assert.equal(paymentResponse.headers.get('location'), '/checkout-payment.html');
    }
  });

  await t.test('change password', async () => {
    let r = await bob.post('/api/auth/change-password', { current_password: 'nope', new_password: 'x'.repeat(10) });
    assert.equal(r.status, 401);
    r = await bob.post('/api/auth/change-password', { current_password: 'bobnewpass12', new_password: 'bobfinal12' });
    assert.equal(r.status, 200);
    await bob.post('/api/auth/logout');
    r = await bob.post('/api/auth/login', { username: 'bob', password: 'bobfinal12' });
    assert.equal(r.status, 200);
  });

  await t.test('guest cart + merge on login', async () => {
    const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
    let r = await guest.post('/api/cart', { product_id: dome.id, quantity: 2 });
    assert.equal(r.status, 200);
    r = await guest.post('/api/cart/by-slug', { slug: 'fhstick', quantity: 1 });
    assert.equal(r.status, 200);
    r = await guest.post('/api/cart/by-slug', { slug: 'no-such-slug' });
    assert.equal(r.status, 404);
    r = await guest.get('/api/cart');
    assert.equal(r.data.items.length, 2);
    assert.equal(typeof r.data.subtotal, 'number');
    const cartId = r.data.items[0].cart_id;
    r = await guest.put(`/api/cart/${cartId}`, { quantity: 3 });
    assert.equal(r.status, 200);
    // Merge: logging in as bob moves guest items into his account.
    r = await guest.post('/api/auth/login', { username: 'alice2', password: 'alicepass12' });
    assert.equal(r.status, 200);
    r = await guest.get('/api/cart');
    assert.equal(r.data.items.length, 2);
    assert.ok(r.data.items.some((i) => i.quantity === 3));
    // Cleanup for later tests.
    for (const item of r.data.items) {
      const del = await guest.del(`/api/cart/${item.cart_id}`);
      assert.equal(del.status, 200);
    }
    r = await guest.post('/api/auth/logout');
    assert.equal(r.status, 200);
  });

  await t.test('cart ownership + out-of-stock guard', async () => {
    await owner.post('/api/auth/login', { username: 'demo', password: 'demo1234' });
    const created = await owner.post('/api/admin/products', { name: 'Empty Box', slug: 'empty-box', price: 10, stock: 0 });
    assert.equal(created.status, 201);
    const emptyId = created.data.id;
    const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
    let r = await bob.post('/api/cart', { product_id: emptyId, quantity: 1 });
    assert.equal(r.status, 400);
    r = await alice.post('/api/auth/login', { username: 'alice2', password: 'alicepass12' });
    assert.equal(r.status, 200);
    await alice.post('/api/cart', { product_id: dome.id, quantity: 1 });
    const aliceCart = await alice.get('/api/cart');
    r = await bob.put(`/api/cart/${aliceCart.data.items[0].cart_id}`, { quantity: 9 });
    assert.equal(r.status, 404);
    r = await bob.del(`/api/cart/${aliceCart.data.items[0].cart_id}`);
    assert.equal(r.status, 404);
    for (const item of aliceCart.data.items) await alice.del(`/api/cart/${item.cart_id}`);
    r = await owner.del(`/api/admin/products/${emptyId}`);
    assert.equal(r.status, 200);
  });

  await t.test('wishlist toggle', async () => {
    const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
    let r = await bob.post('/api/wishlist', { product_id: dome.id });
    assert.equal(r.data.added, true);
    r = await bob.get('/api/wishlist');
    assert.equal(r.data.items.length, 1);
    r = await bob.post('/api/wishlist', { product_id: dome.id });
    assert.equal(r.data.added, false);
    r = await bob.get('/api/wishlist');
    assert.deepEqual(r.data.items, []);
    r = await guest.post('/api/wishlist', { product_id: dome.id });
    assert.equal(r.data.added, true);
    r = await guest.post('/api/wishlist', { product_id: dome.id });
    assert.equal(r.data.added, false);
  });

  await t.test('chat assistant answers from catalog', async () => {
    const r = await guest.post('/api/chat', { message: 'price of dome port' });
    assert.equal(r.status, 200);
    assert.ok(r.data.reply.includes('Rs.'));
  });

  await t.test('admin: categories CRUD + reassignment', async () => {
    let r = await owner.post('/api/admin/categories', { name: 'Cat A', slug: 'cat-a' });
    assert.equal(r.status, 201);
    const catA = r.data.id;
    r = await owner.post('/api/admin/categories', { name: 'Cat B', slug: 'cat-b' });
    const catB = r.data.id;
    r = await owner.post('/api/admin/categories', { name: 'Cat A', slug: 'cat-a2' });
    assert.equal(r.status, 409);
    r = await owner.put(`/api/admin/categories/${catA}`, { name: 'Cat A Renamed', slug: 'cat-a' });
    assert.equal(r.status, 200);
    // Product in Cat A, then delete Cat A with reassignment to Cat B.
    r = await owner.post('/api/admin/products', { name: 'Cat Prod', slug: 'cat-prod', price: 100, category_id: catA });
    assert.equal(r.status, 201);
    const prodId = r.data.id;
    r = await owner.del(`/api/admin/categories/${catA}`);
    assert.equal(r.status, 409); // refuses without reassignment
    assert.equal(r.data.product_count, 1);
    const delRes = await owner.request('DELETE', `/api/admin/categories/${catA}`, { body: { reassign_to: catB } });
    assert.equal(delRes.status, 200);
    const moved = await owner.get('/api/admin/products?search=cat-prod');
    assert.equal(moved.data.products[0].category_id, catB);
    assert.equal(moved.data.products[0].category, 'Cat B');
    const cats = await owner.get('/api/admin/categories');
    assert.ok(cats.data.categories.every((c) => typeof c.product_count === 'number'));
    await owner.del(`/api/admin/products/${prodId}`);
    await owner.del(`/api/admin/categories/${catB}`);
  });

  await t.test('admin: products CRUD + image library', async () => {
    let r = await owner.post('/api/admin/products', {
      name: 'Test Widget', slug: 'test-widget', price: 2500, old_price: 3000,
      stock: 40, brand: 'Acme', mpn: 'ACME-W-1', gtin: '12345670', sku: 'W-1', status: 'active', featured: true,
    });
    assert.equal(r.status, 201);
    const id = r.data.id;
    r = await owner.post('/api/admin/products', { name: 'Dup', slug: 'test-widget', price: 1 });
    assert.equal(r.status, 409);
    r = await owner.post('/api/admin/products', { name: 'Bad GTIN', slug: 'bad-gtin', price: 1, gtin: '123' });
    assert.equal(r.status, 400);
    r = await owner.put(`/api/admin/products/${id}`, {
      name: 'Test Widget v2', slug: 'test-widget', price: 2600, stock: 41, status: 'active',
      brand: 'Acme', mpn: 'ACME-W-1', gtin: '12345670',
    });
    assert.equal(r.status, 200);
    r = await owner.get('/api/admin/products?search=test-widget');
    assert.equal(r.data.products[0].price, 2600);
    assert.equal(r.data.products[0].mpn, 'ACME-W-1');
    assert.equal(r.data.products[0].gtin, '12345670');
    // Images: 1 legacy row, then upload a real one and exercise the library.
    r = await owner.get(`/api/admin/products/${id}/images`);
    assert.equal(r.data.images.length, 1);
    r = await owner.post(`/api/admin/products/${id}/images`, { data: PNG_1PX, file_name: 'one.png', is_primary: true });
    assert.equal(r.status, 201);
    const img2 = r.data.id;
    r = await guest.get('/api/products/test-widget');
    assert.equal(r.status, 200);
    assert.equal(r.data.product.images.length, 2);
    assert.ok(r.data.product.images.includes(PNG_1PX));
    r = await owner.get(`/api/admin/products/${id}/images`);
    assert.equal(r.data.images.length, 2);
    const primary = r.data.images.find((i) => i.is_primary === 1);
    assert.equal(primary.id, img2);
    r = await owner.put(`/api/admin/products/${id}/images/reorder`, { image_ids: r.data.images.map((i) => i.id).reverse() });
    assert.equal(r.status, 200);
    const firstId = (await owner.get(`/api/admin/products/${id}/images`)).data.images[0].id;
    r = await owner.put(`/api/admin/products/${id}/images/${firstId}/primary`, {});
    assert.equal(r.status, 200);
    r = await owner.del(`/api/admin/products/${id}/images/${firstId}`);
    assert.equal(r.status, 200);
    r = await owner.get(`/api/admin/products/${id}/images`);
    assert.equal(r.data.images.length, 1);
    r = await owner.del(`/api/admin/products/${id}/images/${r.data.images[0].id}`);
    assert.equal(r.status, 409); // must retain one image
    // In-cart guard, then delete.
    await bob.post('/api/cart', { product_id: id, quantity: 1 });
    r = await owner.del(`/api/admin/products/${id}`);
    assert.equal(r.status, 400);
    const cart = await bob.get('/api/cart');
    for (const item of cart.data.items) await bob.del(`/api/cart/${item.cart_id}`);
    r = await owner.del(`/api/admin/products/${id}`);
    assert.equal(r.status, 200);
  });

  await t.test('admin: inventory adjust + movements', async () => {
    const fh = await ctx.db.get("SELECT id FROM products WHERE slug = 'fhstick'");
    let r = await owner.post(`/api/admin/inventory/${fh.id}/adjust`, { change: 5, mode: 'set', reason: 'test setup' });
    assert.equal(r.status, 200);
    r = await owner.post(`/api/admin/inventory/${fh.id}/adjust`, { change: 3, mode: 'adjust', reason: 'restock', note: 'n' });
    assert.equal(r.status, 200);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', fh.id)).stock, 8);
    r = await owner.post(`/api/admin/inventory/${fh.id}/adjust`, { change: -100, mode: 'adjust', reason: 'x' });
    assert.equal(r.status, 400);
    r = await owner.post(`/api/admin/inventory/${fh.id}/adjust`, { change: 1000001, mode: 'set', reason: 'x' });
    assert.equal(r.status, 400);
    r = await owner.post(`/api/admin/inventory/${fh.id}/adjust`, { change: 0, mode: 'adjust', reason: 'x' });
    assert.equal(r.status, 400);
    r = await owner.get('/api/admin/inventory');
    assert.ok(r.data.movements.length >= 2);
    assert.equal(typeof r.data.products[0].last_stock_update, 'string');
  });

  await t.test('admin: coupons CRUD + validation', async () => {
    const mk = (code, extra = {}) => owner.post('/api/admin/coupons', {
      code, discount_type: 'percentage', discount_value: 10, ...extra,
    });
    let r = await mk('PERC10', { minimum_order_amount: 1000 });
    assert.equal(r.status, 201);
    r = await owner.post('/api/admin/coupons', { code: 'FIX500', discount_type: 'fixed', discount_value: 500 });
    assert.equal(r.status, 201);
    r = await owner.post('/api/admin/coupons', { code: 'GONE', discount_type: 'fixed', discount_value: 5, expires_at: '2000-01-01 00:00:00' });
    assert.equal(r.status, 201);
    state.goneId = r.data.id;
    r = await owner.post('/api/admin/coupons', { code: 'perc10', discount_type: 'fixed', discount_value: 1 });
    assert.equal(r.status, 409); // case-insensitive duplicate
    r = await bob.post('/api/coupons/validate', { code: 'PERC10' });
    assert.equal(r.status, 400); // empty cart
    const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
    await bob.post('/api/cart', { product_id: dome.id, quantity: 1 }); // 14000
    r = await bob.post('/api/coupons/validate', { code: 'perc10' });
    assert.equal(r.status, 200);
    assert.equal(r.data.discount_amount, 1400);
    assert.equal(r.data.total, 12600);
    r = await bob.post('/api/coupons/validate', { code: 'GONE' });
    assert.equal(r.status, 400);
    r = await bob.post('/api/coupons/validate', { code: 'NOPE-NOPE' });
    assert.equal(r.status, 400);
    r = await mk('BIGMIN', { minimum_order_amount: 99999999 });
    assert.equal(r.status, 201);
    state.bigminId = r.data.id;
    r = await bob.post('/api/coupons/validate', { code: 'BIGMIN' });
    assert.equal(r.status, 400);
    const cart = await bob.get('/api/cart');
    for (const item of cart.data.items) await bob.del(`/api/cart/${item.cart_id}`);
    r = await owner.del('/api/admin/coupons/' + state.goneId);
    assert.equal(r.status, 200);
  });

  await t.test('checkout happy path with coupon', async () => {
    const dome = await ctx.db.get("SELECT id, stock FROM products WHERE slug = 'domeport'");
    const fh = await ctx.db.get("SELECT id, stock FROM products WHERE slug = 'fhstick'");
    await bob.post('/api/cart', { product_id: dome.id, quantity: 1 });
    await bob.post('/api/cart', { product_id: fh.id, quantity: 2 });
    const subtotal = 14000 + 1200 * 2;
    const r = await bob.post('/api/orders', {
      full_name: 'Bob Buyer', email: 'bob@example.com', phone: '123', address: 'Street 1',
      shipping_method: 'standard', payment_method: 'cash', coupon_code: 'perc10',
    });
    assert.equal(r.status, 200);
    const discount = Math.round(subtotal * 0.1 * 100) / 100;
    assert.equal(r.data.discount_amount, discount);
    assert.equal(r.data.total, subtotal - discount + 500);
    assert.match(r.data.invoice_number, /^PH-INV-\d{4}-\d{5}$/);
    state.orderId = r.data.order_id;
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', dome.id)).stock, dome.stock - 1);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', fh.id)).stock, fh.stock - 2);
    const cart = await bob.get('/api/cart');
    assert.deepEqual(cart.data.items, []);
    const orders = await bob.get('/api/orders');
    const mine = orders.data.orders.find((o) => o.id === state.orderId);
    assert.ok(mine);
    assert.equal(mine.items.length, 2);
    assert.equal(mine.coupon_code, 'PERC10');
    const detail = await owner.get(`/api/admin/orders/${state.orderId}`);
    assert.equal(detail.data.payment.payment_status, 'pending');
    assert.deepEqual(detail.data.history, []);
    const coupon = await ctx.db.get("SELECT usage_count FROM coupons WHERE code = 'PERC10'");
    assert.equal(coupon.usage_count, 1);
  });

  await t.test('order fulfillment, status, history, notifications', async () => {
    let r = await owner.put(`/api/admin/orders/${state.orderId}/fulfillment`, {
      carrier: 'tcs', tracking_number: 'TRK1', shipping_status: 'shipped', shipping_notes: 's', internal_notes: 'i',
    });
    assert.equal(r.status, 200);
    r = await owner.put(`/api/admin/orders/${state.orderId}/fulfillment`, { shipping_status: 'warp' });
    assert.equal(r.status, 400);
    r = await owner.put(`/api/admin/orders/${state.orderId}/status`, { status: 'shipped', note: 'left warehouse' });
    assert.equal(r.status, 200);
    const detail = await owner.get(`/api/admin/orders/${state.orderId}`);
    assert.equal(detail.data.history.length, 1);
    assert.equal(detail.data.history[0].status, 'shipped');
    const notes = await bob.get('/api/notifications');
    assert.ok(notes.data.notifications.some((n) => n.title.includes(`Order #${state.orderId}`)));
    r = await bob.post('/api/notifications/read');
    assert.equal(r.status, 200);
    const me = await bob.get('/api/auth/me');
    assert.equal(me.data.unread_notifications, 0);
  });

  await t.test('invoices: customer PDF + HTML, admin PDF, access control', async () => {
    const pdf = await bob.request('GET', `/api/orders/${state.orderId}/invoice`);
    assert.equal(pdf.status, 200);
    assert.match(pdf.headers.get('content-type'), /application\/pdf/);
    const bytes = Buffer.from(await pdf.arrayBuffer());
    assert.ok(bytes.length > 1000);
    assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
    const html = await bob.request('GET', `/api/orders/${state.orderId}/invoice?format=html`);
    assert.match(html.headers.get('content-type'), /text\/html/);
    const adminPdf = await owner.request('GET', `/api/admin/orders/${state.orderId}/invoice`);
    assert.equal(adminPdf.status, 200);
    const stranger = await alice.get(`/api/orders/${state.orderId}/invoice`);
    assert.equal(stranger.status, 404);
  });

  await t.test('cancel restores stock exactly once', async () => {
    const fh = await ctx.db.get("SELECT id, stock FROM products WHERE slug = 'fhstick'");
    await bob.post('/api/cart', { product_id: fh.id, quantity: 1 });
    const placed = await bob.post('/api/orders', {
      full_name: 'Bob', email: 'bob@example.com', phone: '1', address: 'a',
      shipping_method: 'pickup', payment_method: 'cash',
    });
    assert.equal(placed.status, 200);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', fh.id)).stock, fh.stock - 1);
    let r = await owner.put(`/api/admin/orders/${placed.data.order_id}/status`, { status: 'cancelled' });
    assert.equal(r.status, 200);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', fh.id)).stock, fh.stock);
    r = await owner.put(`/api/admin/orders/${placed.data.order_id}/status`, { status: 'cancelled' });
    assert.equal(r.status, 200);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', fh.id)).stock, fh.stock);
    const detail = await owner.get(`/api/admin/orders/${placed.data.order_id}`);
    assert.equal(detail.data.history.filter((h) => h.status === 'cancelled').length, 2);
    const moves = await owner.get('/api/admin/inventory');
    assert.ok(moves.data.movements.some((m) => m.reason === `Order #${placed.data.order_id} cancelled`));
  });

  await t.test('checkout guards: empty cart, bad methods, no stock, coupon limit', async () => {
    let r = await alice.post('/api/orders', { full_name: 'A', email: 'a@x.com', phone: '1', address: 'a' });
    assert.equal(r.status, 400);
    const dome = await ctx.db.get("SELECT id, stock FROM products WHERE slug = 'domeport'");
    await alice.post('/api/cart', { product_id: dome.id, quantity: 1 });
    r = await alice.post('/api/orders', {
      full_name: 'A', email: 'a@x.com', phone: '1', address: 'a', shipping_method: 'rocket',
    });
    assert.equal(r.status, 400);
    r = await alice.post('/api/orders', {
      full_name: 'A', email: 'a@x.com', phone: '1', address: 'a', payment_method: 'gold',
    });
    assert.equal(r.status, 400);
    r = await alice.post('/api/orders', {
      full_name: 'A', email: 'a@x.com', phone: '1', address: 'a', payment_method: 'credit-card',
    });
    assert.equal(r.status, 400);
    r = await alice.post('/api/orders', {
      full_name: 'A', email: 'a@x.com', phone: '1', address: 'a', payment_method: 'paypal',
    });
    assert.equal(r.status, 400);
    await ctx.db.run("UPDATE store_settings SET payment_methods = '[\"cash\"]' WHERE id = 1");
    r = await alice.post('/api/orders', {
      full_name: 'A', email: 'a@x.com', phone: '1', address: 'a', payment_method: 'bank',
    });
    assert.equal(r.status, 400);
    await ctx.db.run("UPDATE store_settings SET payment_methods = '[\"cash\",\"bank\"]' WHERE id = 1");
    // Single-use coupon: bob consumes it, alice's checkout then fails cleanly.
    r = await owner.post('/api/admin/coupons', { code: 'ONCE1', discount_type: 'fixed', discount_value: 10, usage_limit: 1 });
    assert.equal(r.status, 201);
    await bob.post('/api/cart', { product_id: dome.id, quantity: 1 });
    r = await bob.post('/api/orders', {
      full_name: 'B', email: 'bob@example.com', phone: '1', address: 'a', coupon_code: 'ONCE1',
    });
    assert.equal(r.status, 200);
    r = await alice.post('/api/orders', {
      full_name: 'A', email: 'alice2@example.com', phone: '1', address: 'a', coupon_code: 'ONCE1',
    });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /usage limit/);
    // Loser side-effects: none (cart intact, stock intact, usage still 1).
    const cart = await alice.get('/api/cart');
    assert.equal(cart.data.items.length, 1);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', dome.id)).stock, dome.stock - 1);
    assert.equal((await ctx.db.get("SELECT usage_count FROM coupons WHERE code = 'ONCE1'")).usage_count, 1);
    for (const item of cart.data.items) await alice.del(`/api/cart/${item.cart_id}`);
    await owner.del('/api/admin/coupons/' + (await ctx.db.get("SELECT id FROM coupons WHERE code = 'ONCE1'")).id);
  });

  await t.test('reviews + rating aggregates', async () => {
    const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
    let r = await bob.post('/api/products/domeport/reviews', { rating: 5, comment: 'Great dome!' });
    assert.equal(r.status, 200);
    r = await bob.post('/api/products/domeport/reviews', { rating: 0 });
    assert.equal(r.status, 400);
    r = await bob.post('/api/products/domeport/reviews', { rating: 6 });
    assert.equal(r.status, 400);
    r = await bob.post('/api/products/domeport/reviews', { rating: 4, comment: 'x'.repeat(201) });
    assert.equal(r.status, 400);
    r = await alice.post('/api/products/domeport/reviews', { rating: 3, comment: 'Okay' });
    assert.equal(r.status, 200);
    let prod = await ctx.db.get('SELECT rating, rating_count FROM products WHERE id = ?', dome.id);
    assert.equal(prod.rating_count, 2);
    assert.equal(prod.rating, 4);
    const list = await owner.get('/api/admin/reviews');
    const bobReview = list.data.reviews.find((x) => x.comment === 'Great dome!');
    r = await owner.put(`/api/admin/reviews/${bobReview.id}/visibility`, { is_visible: false });
    assert.equal(r.status, 200);
    prod = await ctx.db.get('SELECT rating, rating_count FROM products WHERE id = ?', dome.id);
    assert.equal(prod.rating_count, 1);
    assert.equal(prod.rating, 3);
    r = await owner.put(`/api/admin/reviews/${bobReview.id}/visibility`, { is_visible: true });
    assert.equal(r.status, 200);
    r = await owner.del(`/api/admin/reviews/${bobReview.id}`);
    assert.equal(r.status, 200);
    prod = await ctx.db.get('SELECT rating, rating_count FROM products WHERE id = ?', dome.id);
    assert.equal(prod.rating_count, 1);
  });

  await t.test('contact messages + read markers', async () => {
    let r = await guest.post('/api/contact', { name: 'G', email: 'g@x.com', message: 'Hello there' });
    assert.equal(r.status, 200);
    r = await owner.get('/api/admin/messages');
    const msg = r.data.messages.find((m) => m.message === 'Hello there');
    assert.ok(msg);
    r = await owner.put(`/api/admin/messages/${msg.id}/read`, {});
    assert.equal(r.status, 200);
    const stats = await owner.get('/api/admin/stats');
    assert.equal(stats.data.unread_messages, 0);
  });

  await t.test('vendor applications', async () => {
    let r = await bob.post('/api/vendor/apply', { account_type: 'individual', store_name: 'Bob Store', location: 'Lahore', mobile: '0300' });
    assert.equal(r.status, 200);
    r = await owner.get('/api/admin/vendors');
    const app = r.data.vendors.find((v) => v.store_name === 'Bob Store');
    assert.ok(app);
    r = await owner.put(`/api/admin/vendors/${app.id}/status`, { status: 'maybe' });
    assert.equal(r.status, 400);
    r = await owner.put(`/api/admin/vendors/${app.id}/status`, { status: 'approved' });
    assert.equal(r.status, 200);
  });

  await t.test('admin notifications read flow', async () => {
    let r = await owner.get('/api/admin/notifications');
    assert.ok(r.data.total >= 5);
    assert.ok(r.data.unread >= 1);
    const first = r.data.notifications[0];
    r = await owner.put(`/api/admin/notifications/${first.id}/read`, {});
    assert.equal(r.status, 200);
    r = await owner.put('/api/admin/notifications/999999/read', {});
    assert.equal(r.status, 404);
    r = await owner.post('/api/admin/notifications/read', {});
    assert.equal(r.status, 200);
    r = await owner.get('/api/admin/notifications');
    assert.equal(r.data.unread, 0);
  });

  await t.test('users, customers, roles', async () => {
    let r = await owner.get('/api/admin/users');
    const bobRow = r.data.users.find((u) => u.username === 'bob');
    assert.ok(bobRow);
    assert.equal(typeof bobRow.order_count, 'number');
    assert.equal(typeof bobRow.total_spent, 'number');
    assert.ok(bobRow.order_count >= 2);
    r = await owner.get('/api/admin/users?search=alice2');
    assert.equal(r.data.users.length, 1);
    r = await owner.get('/api/admin/customers');
    assert.ok(r.data.customers.some((u) => u.username === 'bob'));
    r = await owner.get(`/api/admin/customers/${state.bobId}`);
    assert.equal(r.data.customer.username, 'bob');
    assert.ok(r.data.summary.total_orders >= 2);
    assert.ok(r.data.orders[0].item_count >= 1);
    r = await owner.put(`/api/admin/users/${state.bobId}/role`, { role: 'support' });
    assert.equal(r.status, 200);
    r = await owner.put(`/api/admin/users/${state.bobId}/role`, { role: 'customer' });
    assert.equal(r.status, 200);
    const demoId = (await ctx.db.get("SELECT id FROM users WHERE username = 'demo'")).id;
    r = await owner.put(`/api/admin/users/${demoId}/role`, { role: 'customer' });
    assert.equal(r.status, 400); // own role + last owner
  });

  await t.test('admin-users CRUD + least privilege', async () => {
    let r = await owner.post('/api/admin/admin-users', {
      username: 'mgr1', email: 'mgr1@example.com', password: 'mgrpass12', role: 'order_manager',
    });
    assert.equal(r.status, 201);
    const mgrId = r.data.id;
    r = await owner.post('/api/admin/admin-users', {
      username: 'mgr1', email: 'other@example.com', password: 'mgrpass12', role: 'admin',
    });
    assert.equal(r.status, 409);
    r = await owner.post('/api/admin/admin-users', {
      username: 'weak', email: 'weak@example.com', password: 'short', role: 'admin',
    });
    assert.equal(r.status, 400);
    const mgr = ctx.makeSession();
    r = await mgr.post('/api/auth/login', { username: 'mgr1', password: 'mgrpass12' });
    assert.equal(r.status, 200);
    r = await mgr.get('/api/admin/orders');
    assert.equal(r.status, 200);
    r = await mgr.get('/api/admin/users');
    assert.equal(r.status, 403); // order managers cannot manage users
    r = await owner.put(`/api/admin/admin-users/${mgrId}/enabled`, { is_active: false });
    assert.equal(r.status, 200);
    const mgr2 = ctx.makeSession();
    r = await mgr2.post('/api/auth/login', { username: 'mgr1', password: 'mgrpass12' });
    assert.equal(r.status, 403);
    r = await owner.put(`/api/admin/admin-users/${mgrId}/enabled`, { is_active: true });
    assert.equal(r.status, 200);
    const demoId = (await ctx.db.get("SELECT id FROM users WHERE username = 'demo'")).id;
    r = await owner.put(`/api/admin/admin-users/${demoId}/enabled`, { is_active: false });
    assert.equal(r.status, 400); // cannot disable self
  });

  await t.test('store settings round-trip', async () => {
    let r = await owner.get('/api/admin/settings');
    assert.equal(r.data.settings.currency, 'LKR');
    const payload = {
      store_name: 'PixelHouse', currency: 'USD', store_email: 'shop@example.com',
      store_phone: '123', store_open: true, cash_enabled: true, bank_enabled: false,
      shipping_fee: 300, standard_delivery_enabled: true,
      express_delivery_enabled: false, order_notifications: true,
      low_stock_notifications: false, vendor_notifications: true,
    };
    r = await owner.put('/api/admin/settings', payload);
    assert.equal(r.status, 200);
    assert.equal(r.data.settings.currency, 'USD');
    assert.equal(r.data.settings.shipping_fee, 300);
    r = await owner.put('/api/admin/settings', { ...payload, bogus: 1 });
    assert.equal(r.status, 400);
    r = await owner.put('/api/admin/settings', { store_name: 'x' });
    assert.equal(r.status, 400);
    await owner.put('/api/admin/settings', { ...payload, currency: 'LKR' });
  });

  await t.test('promotional banners', async () => {
    const now = Date.now();
    const iso = (ms) => new Date(ms).toISOString();
    let r = await owner.post('/api/admin/promotional-banners', {
      image: 'img/bg-img/1.jpg', title: 'Live Sale', display_order: 1,
      starts_at: iso(now - 3600000), ends_at: iso(now + 3600000),
    });
    assert.equal(r.status, 201);
    const liveId = r.data.id;
    r = await owner.post('/api/admin/promotional-banners', {
      image: 'img/bg-img/2.jpg', title: 'Hidden', is_active: false,
    });
    const hiddenId = r.data.id;
    r = await guest.get('/api/promotional-banners');
    assert.ok(r.data.banners.some((b) => b.title === 'Live Sale'));
    assert.ok(!r.data.banners.some((b) => b.title === 'Hidden'));
    r = await owner.put(`/api/admin/promotional-banners/${liveId}`, {
      image: 'img/bg-img/1.jpg', title: 'Live Sale v2',
    });
    assert.equal(r.status, 200);
    await owner.del(`/api/admin/promotional-banners/${liveId}`);
    await owner.del(`/api/admin/promotional-banners/${hiddenId}`);
  });

  await t.test('bulk operations + CSV export/import', async () => {
    const mk = (slug) => owner.post('/api/admin/products', { name: slug, slug, price: 100, stock: 10 });
    const a = (await mk('bulk-a')).data.id;
    const b = (await mk('bulk-b')).data.id;
    let r = await owner.post('/api/admin/products/bulk', { ids: [a, b], action: 'status', status: 'draft' });
    assert.equal(r.status, 200);
    r = await owner.post('/api/admin/products/bulk', { ids: [a, b], action: 'mark_featured' });
    assert.equal(r.status, 200);
    r = await owner.post('/api/admin/products/bulk', { ids: [a, b], action: 'adjust_stock', change: 5, reason: 'bulk test' });
    assert.equal(r.status, 200);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', a)).stock, 15);
    r = await owner.post('/api/admin/products/bulk', { ids: [a, b], action: 'adjust_stock', change: -1000, reason: 'x' });
    assert.equal(r.status, 400);
    r = await owner.post('/api/admin/products/bulk', { ids: [a], action: 'delete' });
    assert.equal(r.status, 400); // confirm required
    // CSV round-trip with an explicit high id (also exercises sequence repair).
    const csv = 'name,slug,price,stock,image,id\nCSV Widget,csv-widget,1234,7,img/product/1.webp,91001\n';
    const imp = await owner.request('POST', '/api/admin/products/import', { rawBody: csv, contentType: 'text/csv' });
    assert.equal(imp.status, 201);
    assert.equal(await imp.json().then((d) => d.count), 1);
    const imp2 = await owner.request('POST', '/api/admin/products/import', { rawBody: csv, contentType: 'text/csv' });
    assert.equal(imp2.status, 409);
    const exp = await owner.request('GET', '/api/admin/products/export');
    assert.equal(exp.status, 200);
    assert.match(exp.headers.get('content-type'), /text\/csv/);
    assert.ok((await exp.text()).includes('csv-widget'));
    r = await owner.post('/api/admin/products', { name: 'After Import', slug: 'after-import', price: 5 });
    assert.equal(r.status, 201);
    if (ctx.realTransactions) assert.ok(r.data.id > 91001, `expected id past import, got ${r.data.id}`);
    r = await owner.post('/api/admin/products/bulk', { ids: [a, b, 91001, r.data.id], action: 'delete', confirm: true });
    assert.equal(r.status, 200);
  });

  await t.test('analytics + stats shapes', async () => {
    const r = await owner.get('/api/admin/analytics');
    assert.equal(r.status, 200);
    for (const key of ['total_revenue', 'total_orders', 'range_revenue', 'range_orders', 'average_order_value']) {
      assert.equal(typeof r.data.summary[key], 'number');
    }
    assert.ok(Array.isArray(r.data.sales_by_day));
    assert.ok(r.data.sales_by_day.length >= 1);
    assert.match(r.data.sales_by_day[0].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(r.data.sales_by_month[0].month, /^\d{4}-\d{2}$/);
    assert.ok(r.data.top_products.length >= 1);
    assert.ok(r.data.top_categories.length >= 1);
    const bad = await owner.get('/api/admin/analytics?range=custom&start_date=2026-02-01&end_date=2026-01-01');
    assert.equal(bad.status, 400);
    const stats = await owner.get('/api/admin/stats');
    assert.equal(typeof stats.data.users, 'number');
    assert.ok(Array.isArray(stats.data.revenue7));
  });

  await t.test('admin orders filters + pagination', async () => {
    let r = await owner.get('/api/admin/orders?search=Bob');
    assert.ok(r.data.orders.length >= 1);
    assert.equal(typeof r.data.total, 'number');
    r = await owner.get('/api/admin/orders?status=shipped');
    assert.ok(r.data.orders.every((o) => o.status === 'shipped'));
    r = await owner.get('/api/admin/orders?payment_status=pending');
    assert.ok(r.data.orders.length >= 1);
    const today = new Date().toISOString().slice(0, 10);
    r = await owner.get(`/api/admin/orders?date=${today}`);
    assert.ok(r.data.orders.length >= 1);
    r = await owner.get('/api/admin/orders?payment_method=cash&page=1');
    assert.ok(r.data.orders.length >= 1);
    r = await owner.get('/api/admin/orders?page=9999');
    assert.deepEqual(r.data.orders, []);
  });

  await t.test('audit logs recorded + filterable', async () => {
    const r = await owner.get('/api/admin/audit-logs');
    assert.ok(r.data.total >= 10);
    assert.ok(r.data.logs[0].actor_name);
    const filtered = await owner.get('/api/admin/audit-logs?action=created');
    assert.ok(filtered.data.logs.every((l) => l.action === 'created'));
  });

  await t.test('maintenance mode blocks writes only', async () => {
    process.env.MAINTENANCE_MODE = 'true';
    try {
      const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
      let r = await bob.post('/api/cart', { product_id: dome.id, quantity: 1 });
      assert.equal(r.status, 503);
      assert.equal(r.data.maintenance, true);
      r = await bob.get('/api/products');
      assert.equal(r.status, 200);
      r = await bob.get('/api/health');
      assert.equal(r.status, 200);
      assert.equal(r.data.maintenance, true);
    } finally {
      delete process.env.MAINTENANCE_MODE;
    }
    const dome = await ctx.db.get("SELECT id FROM products WHERE slug = 'domeport'");
    const r = await bob.post('/api/cart', { product_id: dome.id, quantity: 1 });
    assert.equal(r.status, 200);
    const cart = await bob.get('/api/cart');
    for (const item of cart.data.items) await bob.del(`/api/cart/${item.cart_id}`);
  });

  await t.test('last-unit race: exactly one checkout wins, stock never negative',
    { skip: !ctx.realTransactions ? 'needs real transaction rollback (pg-mem cannot roll back)' : false },
    async () => {
      const created = await owner.post('/api/admin/products', { name: 'Race Product', slug: 'race-product', price: 999, stock: 50 });
      const id = created.data.id;
      await owner.post(`/api/admin/inventory/${id}/adjust`, { change: 1, mode: 'set', reason: 'race setup' });
      const bob2 = ctx.makeSession();
      const alice2 = ctx.makeSession();
      await bob2.post('/api/auth/login', { username: 'bob', password: 'bobfinal12' });
      await alice2.post('/api/auth/login', { username: 'alice2', password: 'alicepass12' });
      await bob2.post('/api/cart', { product_id: id, quantity: 1 });
      await alice2.post('/api/cart', { product_id: id, quantity: 1 });
      const body = { full_name: 'Racer', email: 'race@example.com', phone: '1', address: 'a' };
      const [r1, r2] = await Promise.all([
        bob2.post('/api/orders', body),
        alice2.post('/api/orders', body),
      ]);
      const statuses = [r1.status, r2.status].sort();
      assert.deepEqual(statuses, [200, 400]);
      assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', id)).stock, 0);
      const winner = r1.status === 200 ? r1 : r2;
      const loserSession = r1.status === 200 ? alice2 : bob2;
      const loserCart = await loserSession.get('/api/cart');
      assert.equal(loserCart.data.items.length, 1); // loser's cart untouched
      await owner.put(`/api/admin/orders/${winner.data.order_id}/status`, { status: 'cancelled' });
      assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?', id)).stock, 1);
      for (const item of loserCart.data.items) await loserSession.del(`/api/cart/${item.cart_id}`);
      await owner.del(`/api/admin/products/${id}`);
    });

  await t.test('direct transaction rollback', { skip: !ctx.realTransactions ? 'needs real transactions' : false }, async () => {
    try {
      await ctx.db.transaction(async (tx) => {
        await tx.run("INSERT INTO categories (name, slug) VALUES ('tx-temp', 'tx-temp')");
        throw new Error('boom');
      });
      assert.fail('transaction should have thrown');
    } catch (error) {
      assert.equal(error.message, 'boom');
    }
    const row = await ctx.db.get("SELECT id FROM categories WHERE slug = 'tx-temp'");
    assert.equal(row, undefined);
    await ctx.db.transaction(async (tx) => {
      await tx.run("INSERT INTO categories (name, slug) VALUES ('tx-keep', 'tx-keep')");
    });
    const kept = await ctx.db.get("SELECT id FROM categories WHERE slug = 'tx-keep'");
    assert.ok(kept);
    await ctx.db.run("DELETE FROM categories WHERE slug = 'tx-keep'");
  });
}

module.exports = { defineSuite };
