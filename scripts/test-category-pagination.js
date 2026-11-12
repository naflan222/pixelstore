// Pagination comparison uses only a disposable local catalog.
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { freshSqlitePath } = require('../tests/helpers');
Object.assign(process.env, { DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(), NODE_ENV: 'test', SEED_DEMO_DATA: 'true' });
delete process.env.DATABASE_URL;
const db = require('../server/database');
const { start } = require('../server');
(async () => {
  const { server, port } = await start(0), base = `http://127.0.0.1:${port}`;
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
  const output = process.env.LAYOUT_SCREENSHOTS || '/workspace/shared/pagination'; fs.mkdirSync(output, { recursive: true });
  const errors = [];
  try {
    const setup = await browser.newContext();
    await setup.request.post(base + '/api/auth/login', { data: { username: 'demo', password: 'demo1234' } });
    for (const batch of ['accessories', 'camping']) assert.equal((await setup.request.post(base + `/api/admin/catalog-batches/${batch}-20261109/apply`, { data: { confirm: true } })).status(), 200);
    await setup.close();
    const appearance = node => {
      const style = getComputedStyle(node);
      return { color: style.color, background: style.backgroundColor, fontSize: style.fontSize, padding: style.padding, border: style.borderColor };
    };
    for (const theme of ['light', 'dark']) for (const width of [390, 980, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 950 }, serviceWorkers: 'block' });
      await context.addInitScript(theme => localStorage.setItem('theme', theme), theme);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
      await page.goto(base + '/products?category=Camping%20Accessories');
      await page.locator('#allProductsPagination button[aria-label="Page 2"]').waitFor(); await page.evaluate(() => document.fonts.ready);
      const camping = await page.locator('#allProductsPagination .page-item:not(.active):not(.disabled) .page-link').filter({ hasText: '2' }).evaluate(appearance);
      const campingActive = await page.locator('#allProductsPagination .active .page-link').evaluate(appearance);
      await page.goto(base + '/gopro-accessories');
      const nav = page.locator('[data-catalog-category] nav[aria-label="Page navigation"]');
      await nav.getByRole('link', { name: 'Next page', exact: true }).waitFor();
      assert.deepEqual(await nav.getByRole('link', { name: 'Page 2', exact: true }).evaluate(appearance), camping);
      assert.deepEqual(await nav.getByRole('link', { name: 'Page 1', exact: true }).evaluate(appearance), campingActive);
      assert.equal(await nav.locator('[aria-label="Previous page"]').getAttribute('aria-disabled'), 'true');
      const numbers = await nav.locator('a[aria-label^="Page "]').allTextContents(); assert.ok(numbers.length >= 3); assert.deepEqual(numbers, numbers.map((_, index) => String(index + 1)));
      if (theme === 'dark' && [390, 1440].includes(width)) await nav.screenshot({ path: path.join(output, `gopro-${theme}-${width}.png`) });
      await nav.getByRole('link', { name: 'Next page', exact: true }).click();
      await page.waitForURL('**/gopro-accessories?page=2');
      await nav.getByRole('link', { name: 'Page 2', exact: true }).waitFor();
      assert.equal(await nav.getByRole('link', { name: 'Page 2', exact: true }).getAttribute('aria-current'), 'page');
      await nav.getByRole('link', { name: 'Page ' + numbers.length, exact: true }).click();
      await page.waitForURL('**/gopro-accessories?page=' + numbers.length);
      await nav.locator('[aria-label="Next page"][aria-disabled="true"]').waitFor();
      await nav.getByRole('link', { name: 'Previous page', exact: true }).click();
      await page.waitForURL('**/gopro-accessories?page=' + (numbers.length - 1));
      await page.goto(base + '/gopro-accessories?camera_brand=gopro&x=kept');
      await nav.getByRole('link', { name: 'Next page', exact: true }).waitFor();
      const href = await nav.getByRole('link', { name: 'Next page', exact: true }).getAttribute('href');
      const target = new URL(href, base); assert.equal(target.searchParams.get('camera_brand'), 'gopro'); assert.equal(target.searchParams.get('x'), 'kept'); assert.equal(target.searchParams.get('page'), '2');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: GoPro pagination matches Camping styles at 390/980/1440px in light/dark; visible numbers, previous/next bounds, clean links and filters preserved.');
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); await db.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
