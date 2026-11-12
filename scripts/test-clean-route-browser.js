// Whole-site URL migration regression on disposable local data only.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { freshSqlitePath } = require('../tests/helpers');
Object.assign(process.env, { DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(), NODE_ENV: 'test', SEED_DEMO_DATA: 'true' });
delete process.env.DATABASE_URL;
const db = require('../server/database');
const { start } = require('../server');

(async () => {
  const { server, port } = await start(0);
  const base = `http://127.0.0.1:${port}`;
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const screenshots = process.env.LAYOUT_SCREENSHOTS || '/workspace/shared/clean-routes';
  fs.mkdirSync(screenshots, { recursive: true });
  const errors = [], assetFailures = [];
  function watch(page) {
    page.on('pageerror', error => (errors.push(error.message), console.error('Browser error:', error.message)));
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin === base && response.status() >= 400 && /\.(?:js|css|png|jpg|webp|woff2?)(?:$|\?)/.test(url.pathname)) assetFailures.push(response.status() + ' ' + url.pathname);
    });
  }
  try {
    assert.equal(fs.readFileSync(path.join(__dirname, '../style.css'), 'utf8'), execFileSync('git', ['show', 'origin/main:style.css'], { encoding: 'utf8' }), 'Design stylesheet is unchanged');
    const setup = await browser.newContext();
    await setup.request.post(base + '/api/auth/login', { data: { username: 'demo', password: 'demo1234' } });
    for (const batch of ['accessories', 'camping']) assert.equal((await setup.request.post(base + `/api/admin/catalog-batches/${batch}-20261109/apply`, { data: { confirm: true } })).status(), 200);
    const products = (await (await setup.request.get(base + '/api/products')).json()).products;
    const floating = products.find(product => product.slug === 'fhstick');
    const accessory = products.find(product => product.slug === 'backpack-strap-camera-clip');
    await setup.close();

    for (const theme of ['light', 'dark']) for (const width of (process.env.CLEAN_ROUTE_FLOW_ONLY ? [] : [390, 980, 1440])) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
      await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      const page = await context.newPage(); watch(page);
      for (const route of ['/', '/gopro-accessories?page=2', '/products', '/osmo-accessories', '/about-us', accessory.url_path]) {
        const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
        assert.equal(response.status(), 200, route);
        await page.waitForFunction(() => document.querySelector('.site-footer'));
        await page.evaluate(() => document.fonts.ready);
        if (route === '/products') await page.waitForFunction(() => document.querySelector('#allProductsGrid .product-cart-button'));
        if (route === accessory.url_path) {
          await page.waitForFunction(() => document.querySelector('.dynamic-product-image')?.complete && !document.documentElement.classList.contains('dynamic-product-loading'));
          assert.equal(await page.locator('.p-title-price h5').innerText(), accessory.name);
          assert.ok(new URL(await page.locator('.dynamic-product-image').getAttribute('src'), await page.evaluate(() => document.baseURI)).pathname.startsWith('/img/'));
          assert.equal(await page.evaluate(src => window.PixelHouseProductImages.sources(src).length, accessory.image), 3, 'Responsive variants resolve from the document base under nested URLs');
          assert.ok(await page.locator('.dynamic-product-image').first().evaluate(img => img.naturalWidth >= 600), 'Product gallery retains its high-resolution source');
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), route + ' overflow');
        assert.equal(new URL(page.url()).pathname, route.split('?')[0]);
        const oldLinks = await page.locator('a[href]').evaluateAll(nodes => nodes.map(node => new URL(node.href)).filter(url => url.origin === location.origin && url.pathname.endsWith('.html')).map(url => url.pathname));
        assert.deepEqual(oldLinks, [], route + ' advertises only clean internal links');
        if (theme === 'light' && width === 390 && route === accessory.url_path) await page.screenshot({ path: path.join(screenshots, 'product-mobile.png'), fullPage: false });
        if (theme === 'light' && width === 1440 && route === '/gopro-accessories?page=2') await page.screenshot({ path: path.join(screenshots, 'gopro-desktop.png'), fullPage: false });
      }
      await page.goto(base + '/gpproducts2.html');
      assert.equal(new URL(page.url()).pathname, '/gopro-accessories');
      assert.equal(new URL(page.url()).searchParams.get('page'), '2');
      await page.waitForFunction(() => document.querySelector('nav[aria-label="Page navigation"] a[href*="page=3"]'));
      await page.locator('nav[aria-label="Page navigation"] a[href*="page=3"]').click();
      await page.waitForURL('**/gopro-accessories?page=3');
      await page.goto(base + '/gopro-accessories?camera_brand=gopro');
      await page.waitForFunction(() => document.querySelector('[data-camera-apply]'));
      assert.ok(await page.locator('[data-camera-filter="brand"][value="gopro"]').isChecked());
      console.log(`PASS browsing ${theme} ${width}px`);
      await context.close();
    }

    // One real customer flow: guest cart -> signup/login -> checkout -> invoice.
    const context = await browser.newContext({ viewport: { width: 390, height: 950 }, serviceWorkers: 'block' });
    const page = await context.newPage(); watch(page);
    await page.goto(base + '/products?q=Floating');
    const add = page.locator('.product-cart-button[data-cart-bound="1"]').first();
    await add.waitFor();
    const added = page.waitForResponse(response => response.url().endsWith('/api/cart') && response.request().method() === 'POST');
    await add.click(); assert.equal((await added).status(), 200);
    await page.goto(base + '/register');
    await page.waitForFunction(() => !document.querySelector('form').hasAttribute('action'));
    await page.locator('#username').fill('routecustomer');
    await page.locator('#email').fill('routecustomer@example.test');
    await page.locator('#registerPassword').fill('Browser-test-password-42');
    await page.locator('form button[type="submit"]').click();
    await page.getByRole('link', { name: 'Go to Login' }).click();
    await page.waitForURL('**/login');
    await page.waitForFunction(() => !document.querySelector('form').hasAttribute('action'));
    await page.locator('#username').fill('routecustomer');
    await page.locator('#password').fill('Browser-test-password-42');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL(base + '/');
    await page.goto(base + '/cart');
    await page.waitForFunction(() => document.querySelector('.cart-table .product-title, table .product-title'));
    assert.equal(await page.locator('table .product-title').first().getAttribute('href'), floating.url_path);
    await page.goto(base + '/checkout');
    await page.locator('#billName').fill('Route Test Customer');
    await page.locator('#billEmail').fill('routecustomer@example.test');
    await page.locator('#billPhone').fill('0771234567');
    await page.locator('#billAddress').fill('Disposable browser test address, Colombo');
    await page.waitForFunction(() => document.querySelector('input[name="selector"]')?.value === 'standard');
    await page.getByRole('link', { name: 'Confirm & Pay' }).click();
    await page.waitForURL('**/checkout-payment');
    await page.locator('a.cash').click();
    await page.waitForURL('**/checkout-cash');
    const ordered = page.waitForResponse(response => response.url().endsWith('/api/orders') && response.request().method() === 'POST');
    await page.getByRole('link', { name: 'Order Now' }).click();
    const orderResponse = await ordered; assert.equal(orderResponse.status(), 200);
    await page.waitForURL('**/payment-success');
    const order = await page.evaluate(() => JSON.parse(sessionStorage.getItem('last_order')));
    assert.equal((await context.request.get(base + '/api/orders/' + order.order_id + '/invoice')).status(), 200);
    await page.goto(base + '/my-order');
    assert.equal(await page.locator('.page-heading h6').innerText(), 'Order Status');
    const savedOrders = await (await context.request.get(base + '/api/orders')).json();
    assert.ok(savedOrders.orders.some(saved => saved.id === order.order_id));
    await page.goto(base + '/profile');
    await page.waitForFunction(() => document.querySelector('#profileUsername')?.textContent === 'routecustomer');

    // Full password-reset navigation with the development-only local reset code.
    const loggedOut = page.waitForResponse(response => response.url().endsWith('/api/auth/logout') && response.request().method() === 'POST');
    await page.locator('a[href="/intro"]').filter({ hasText: /Sign Out/ }).first().evaluate(link => link.click());
    assert.equal((await loggedOut).status(), 200);
    await page.waitForURL(base + '/');
    await page.goto(base + '/forget-password');
    await page.waitForFunction(() => !document.querySelector('form').hasAttribute('action'));
    await page.locator('input[type="email"]').fill('routecustomer@example.test');
    const resetResponse = page.waitForResponse(response => response.url().endsWith('/api/auth/forgot-password'));
    await page.locator('form button[type="submit"]').click();
    const reset = await (await resetResponse).json();
    assert.match(reset.dev_code, /^\d{6}$/);
    await page.waitForURL('**/otp-confirm');
    await page.waitForFunction(() => !document.querySelector('form').hasAttribute('action'));
    const digits = page.locator('.single-otp-input');
    for (let index = 0; index < 6; index++) await digits.nth(index).fill(reset.dev_code[index]);
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL('**/change-password');
    await page.waitForFunction(() => !document.querySelector('form').hasAttribute('action'));
    await page.locator('input[type="password"]').nth(1).fill('Changed-browser-password-43');
    await page.locator('input[type="password"]').nth(2).fill('Changed-browser-password-43');
    await page.locator('form button[type="submit"]').click();
    await page.waitForURL('**/forget-password-success');
    assert.equal((await context.request.post(base + '/api/auth/login', { data: { username: 'routecustomer', password: 'Changed-browser-password-43' } })).status(), 200);
    await context.close();

    // Owner UI remains available at its existing clean address.
    const owner = await browser.newContext();
    await owner.request.post(base + '/api/auth/login', { data: { username: 'demo', password: 'demo1234' } });
    const admin = await owner.newPage(); watch(admin); await admin.goto(base + '/admin/');
    assert.equal((await owner.request.get(base + '/api/admin/stats')).status(), 200);
    await admin.goto(base + '/admin/camping-preview.html');
    assert.equal(new URL(admin.url()).pathname, '/admin/camping-preview');
    await owner.close();
    const installed = await browser.newContext();
    const installedPage = await installed.newPage(); watch(installedPage);
    await installedPage.goto(base + accessory.url_path);
    const registration = await installedPage.evaluate(async () => { const r = await navigator.serviceWorker.ready; return { scope: r.scope, script: r.active.scriptURL }; });
    assert.equal(registration.scope, base + '/');
    assert.equal(registration.script, base + '/service-worker.js');
    await installedPage.reload();
    await installedPage.waitForFunction(() => navigator.serviceWorker.controller);
    await installed.setOffline(true);
    await installedPage.goto(base + '/products');
    assert.match(await installedPage.locator('body').innerText(), /No Internet|offline/i);
    await installed.close();
    assert.deepEqual(errors, []); assert.deepEqual(assetFailures, []);
    console.log('PASS clean-route customer signup/login, guest cart merge, checkout, invoice, orders, profile, password reset and admin access; no asset failures or browser errors.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
