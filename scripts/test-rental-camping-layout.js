// Layout and category navigation regression on disposable local data.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { freshSqlitePath } = require('../tests/helpers');
Object.assign(process.env, { DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(), NODE_ENV: 'test', SEED_DEMO_DATA: 'true' });
delete process.env.DATABASE_URL;
const db = require('../server/database'); const { start } = require('../server');
(async () => {
  const { server, port } = await start(0), base = `http://127.0.0.1:${port}`;
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const output = process.env.LAYOUT_SCREENSHOTS || '/workspace/shared/rental-camping'; fs.mkdirSync(output, { recursive: true });
  const errors = [];
  const labels = ['Action Cameras','Insta360 Camera','Camping Accessories','GoPro Accessories','Insta360 Accessories','Osmo Accessories','Rental Services','Camera Trade'];
  try {
    const setup = await browser.newContext();
    await setup.request.post(base + '/api/auth/login', { data: { username: 'demo', password: 'demo1234' } });
    assert.equal((await setup.request.post(base + '/api/admin/catalog-batches/camping-20261109/apply', { data: { confirm: true } })).status(), 200);
    // Category tiles also exist in the first response, before scripts run.
    const noJs = await browser.newContext({ javaScriptEnabled: false });
    const fallback = await noJs.newPage(); await fallback.goto(base + '/products?category=Camping%20Accessories');
    assert.equal(await fallback.locator('#campingCategoryNavigation').isVisible(), true);
    assert.equal(await fallback.locator('#campingCategoryBanner').isVisible(), true);
    assert.equal(await fallback.locator('#allProductsSearch').isVisible(), false);
    assert.equal(await fallback.locator('#allProductsCategories').isVisible(), false);
    assert.equal(await fallback.locator('#campingCategoryNavigation .catagory-card').count(), 8);
    await noJs.close(); await setup.close();
    for (const theme of (process.env.LAYOUT_THEMES || 'light,dark').split(',')) for (const width of (process.env.LAYOUT_WIDTHS || '360,390,768,980,1440,1920').split(',').map(Number)) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
      await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      for (const route of ['/rental-services','/products?category=Camping%20Accessories']) {
        await page.goto(base + route); await page.evaluate(() => document.fonts.ready);
        if (route.startsWith('/products')) await page.waitForFunction(() => document.querySelector('#allProductsGrid .product-cart-button'));
        const cards = page.locator('.product-catagories-wrapper .catagory-card');
        assert.deepEqual(await cards.locator('span').allTextContents(), labels);
        const sizes = await cards.evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
        assert.ok(Math.max(...sizes.map(s => s.height)) - Math.min(...sizes.map(s => s.height)) < 1, 'Equal category tile heights');
        assert.ok(Math.max(...sizes.map(s => s.width)) - Math.min(...sizes.map(s => s.width)) < 1, 'Equal category tile widths');
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        const contentWidth = await page.locator('.page-content-wrapper .container').first().evaluate(node => node.getBoundingClientRect().width);
        if (width >= 768) assert.ok(contentWidth >= Math.min(width - 34, 1118));
        if (route === '/rental-services') {
          if (width >= 768) assert.ok(await page.locator('.catagory-single-img').evaluate(node => node.getBoundingClientRect().height >= 180));
          assert.equal(await page.locator('.btn-rental-book').count(), 5);
          for (const href of await page.locator('.btn-rental-book').evaluateAll(nodes => nodes.map(node => node.href))) assert.ok(href.startsWith('https://wa.me/94777466675?text='));
          assert.equal(await page.locator('.sale-price').filter({ hasText: 'Rs. 2,000' }).count(), 1);
        } else {
          assert.equal(await page.locator('#allProductsCategories').isVisible(), false);
          assert.equal(await page.locator('.page-heading h6').innerText(), 'Camping Accessories');
          const next = page.locator('#allProductsPagination button[aria-label="Next page"]');
          await next.click(); await page.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2');
          assert.equal(await page.locator('#allProductsGrid .product-card').count(), 1);
          assert.equal(await page.locator('#campingCategoryNavigation').isVisible(), true);
          assert.equal(await page.locator('#allProductsSearch').isVisible(), false);
          assert.equal(await page.locator('#campingCategoryBanner').isVisible(), true);
          await page.goto(base + '/products?category=Camping%20Accessories&q=Tent');
          await page.waitForFunction(() => document.querySelector('#allProductsGrid .product-cart-button'));
          assert.equal(new URL(page.url()).searchParams.get('category'), 'Camping Accessories');
          assert.equal(await page.locator('#campingCategoryNavigation').isVisible(), true);
          await page.locator('#campingCategoryNavigation a[href="/gopro-accessories"]').click();
          await page.waitForURL('**/gopro-accessories');
        }
        if (theme === 'dark' && [390,980].includes(width)) {
          await page.goto(base + route); await page.evaluate(() => document.fonts.ready);
          await page.waitForFunction(() => [...document.querySelectorAll('.product-thumbnail img')].filter(img => img.getBoundingClientRect().top < innerHeight).every(img => img.complete && img.naturalWidth > 0));
          await page.waitForTimeout(350);
          await page.screenshot({ path: path.join(output, `${route.startsWith('/rental') ? 'rental' : 'camping'}-${width}.png`), fullPage: false, style: '.pwa-install-alert{visibility:hidden!important}' });
        }
      }
      await page.goto(base + '/products'); await page.locator('#allProductsCategories button[data-category="Camping Accessories"]').waitFor();
      assert.equal(await page.locator('#campingCategoryNavigation').isVisible(), false);
      assert.equal(await page.locator('#allProductsCategories').isVisible(), true);
      assert.equal(await page.locator('#allProductsSearch').isVisible(), true);
      assert.equal(await page.locator('#campingCategoryBanner').isVisible(), false);
      await page.locator('#allProductsCategories button[data-category="Camping Accessories"]').click();
      assert.equal(await page.locator('#campingCategoryNavigation').isVisible(), true);
      assert.equal(await page.locator('#campingCategoryBanner').isVisible(), true);
      assert.equal(await page.locator('#allProductsSearch').isVisible(), false);
      assert.equal(await page.locator('#allProductsCategories').isVisible(), false);
      await page.getByRole('link', { name: 'View all products', exact: true }).click();
      await page.waitForURL(base + '/products');
      assert.equal(await page.locator('#campingCategoryNavigation').isVisible(), false);
      await context.close();
    }
    assert.deepEqual(errors, []); console.log('PASS: rental desktop width, equal category tiles, 5 booking links/prices, Camping SSR/navigation/search/pagination and All Products restoration at 360/390/768/980/1440/1920px in light/dark.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
