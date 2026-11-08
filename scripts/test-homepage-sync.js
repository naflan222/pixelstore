// Optional browser regression: PLAYWRIGHT_PATH=/path/to/playwright node scripts/test-homepage-sync.js
// Uses a disposable database and synthetic customer/catalog data only.
const assert = require('node:assert/strict');
const { freshSqlitePath, makeSession } = require('../tests/helpers');
Object.assign(process.env, { DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(), NODE_ENV: 'test', SEED_DEMO_DATA: 'true' });
delete process.env.DATABASE_URL;
const { start } = require('../server');
const db = require('../server/database');
(async () => {
  const { server, port } = await start(0);
  const browser = await require(process.env.PLAYWRIGHT_PATH || 'playwright').chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    const base = `http://127.0.0.1:${port}`;
    const owner = makeSession(base);
    assert.equal((await owner.post('/api/auth/login', { username: 'demo', password: 'demo1234' })).status, 200);
    const products = (await owner.get('/api/products')).data.products;
    const ids = products.slice(0, 3).map(p => p.id);
    for(const key of ['featured_gear','top_products','weekly_best_sellers','featured_products']) assert.equal((await owner.put(`/api/admin/homepage-sections/${key}`, {product_ids: ids})).status, 200);
    const page = await browser.newPage({ viewport: {width:390,height:844}, serviceWorkers:'block' });
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    await page.goto(base + '/', {waitUntil:'networkidle'});
    await page.waitForFunction(id => document.querySelector('[data-home-products="top_products"] [data-cart-id]')?.dataset.cartId === String(id), ids[0]);
    assert.equal(await page.locator('[data-home-products="top_products"] .product-card').count(), 3);
    assert.equal(await page.locator('[data-home-products="weekly_best_sellers"] .horizontal-product-card').count(),3);
    assert.equal(await page.locator('[data-home-products="featured_products"] .featured-product-card').count(),3);
    assert.equal(await page.locator('[data-home-products="featured_gear"] .progress-bar').count() >= 3, true);
    assert.equal(await page.locator('[data-home-products="featured_gear"]').innerText().then(v=>/\d+\s*In Stock/i.test(v)), false);
    await page.evaluate(()=> { window.__unchangedCard = document.querySelector('[data-home-products="top_products"] .product-card'); });
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(()=>window.__unchangedCard === document.querySelector('[data-home-products="top_products"] .product-card')), true);
    await page.evaluate(() => { const el = document.querySelector('[data-home-products="featured_gear"]'); if(window.jQuery(el).data('owl.carousel')) window.jQuery(el).trigger('to.owl.carousel', [1,0]); });
    const reversed = [...ids].reverse();
    await owner.put('/api/admin/homepage-sections/featured_gear', {product_ids:reversed});
    assert.equal((await owner.put('/api/admin/homepage-sections/top_products', {product_ids:reversed})).status, 200);
    // Exercise the actual 30-second timer, without reloading the page.
    await page.waitForFunction(id=>document.querySelector('[data-home-products="top_products"] [data-cart-id]')?.dataset.cartId===String(id), reversed[0], {timeout:35000});
    assert.equal(await page.evaluate(() => { const owl = window.jQuery(document.querySelector('[data-home-products="featured_gear"]')).data('owl.carousel'); return owl ? owl.relative(owl.current()) : 1; }),1);
    let cartWrites=0;
    await page.route('**/api/cart', async route=> { if(route.request().method()==='POST') {cartWrites++; await route.fulfill({json:{product:products[2]}});} else await route.continue(); });
    await page.locator('[data-home-products="top_products"] [data-cart-id]').first().click();
    await page.waitForTimeout(500);
    assert.equal(cartWrites,1,'one tap must add once');
    await page.route('**/api/homepage-sections', route=>route.fulfill({status:503,json:{error:'Test outage'}}));
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(500);
    assert.equal(await page.locator('[data-home-products="top_products"] .product-card').count(),3);
    await page.unroute('**/api/homepage-sections');
    // A configured section containing only an inactive product must not resurrect fallback cards.
    await owner.put('/api/admin/homepage-sections/top_products',{product_ids:[ids[0]]});
    await db.run("UPDATE products SET status = 'inactive' WHERE id = ?",ids[0]);
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await page.getByText('No products available in this section right now.').waitFor();
    assert.equal(await page.locator('[data-home-products="top_products"] .product-card').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: root homepage, ordered save/readback, 30s polling, unchanged nodes, stock bars, single cart action, outage retention, configured-empty state.');
  } finally { await browser.close(); await new Promise(r=>server.close(r)); await db.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
