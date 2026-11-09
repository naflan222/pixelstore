// Optional Chromium regression. All writes use a disposable local database.
const assert=require('node:assert/strict');
const {freshSqlitePath}=require('../tests/helpers');
Object.assign(process.env,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'});delete process.env.DATABASE_URL;
const {start}=require('../server');const db=require('../server/database');const batch=require('../server/accessory-batch');
(async()=>{
 const {server,port}=await start(0);const base=`http://127.0.0.1:${port}`;
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  assert.equal((await context.request.post(base+'/api/auth/login',{data:{username:'demo',password:'demo1234'}})).status(),200);
  await page.goto(base+'/admin/accessories-preview.html');await page.locator('.product').nth(21).waitFor();
  assert.equal(await page.locator('.product').count(),22);assert.equal(await page.locator('#apply').isDisabled(),true);
  assert.equal((await db.all("SELECT id FROM products WHERE sku LIKE 'PH-ACC-20261109-%'")).length,0);
  await page.locator('#confirmed').check();await page.locator('#apply').click();await page.getByText('Added. The products are available', {exact:false}).waitFor();
  assert.equal(await page.locator('#apply').isVisible(),false);
  const product=batch.products.find(p=>p.number===9);
  await page.goto(base+'/');const search=page.locator('.search-form input[type="search"]').first();await search.fill('windshield');await page.locator('.search-suggestions a').filter({hasText:'Windshield'}).waitFor();
  await page.locator('.search-suggestions a').filter({hasText:'Windshield'}).click();await page.locator('.p-title-price h5').filter({hasText:product.name}).waitFor();
  assert.match(await page.locator('.p-title-price .sale-price').innerText(),/6,299/);
  assert.equal(await page.locator('.cart-form button[type="submit"]').innerText(),'Out of Stock');
  assert.equal(await page.locator('.flash-sale-panel').isVisible(),false);
  assert.ok((await page.locator('.dynamic-product-image').first().getAttribute('src')).endsWith('-large.webp'));
  await page.goto(base+'/products.html?q=Chest');await page.locator('#allProductsGrid .product-card').first().waitFor();assert.ok((await page.locator('#allProductsGrid').innerText()).includes('Chest'));
  await page.goto(base+'/osmocat.html');await page.waitForFunction(()=>Array.from(document.querySelectorAll('a.product-title')).some(a=>a.textContent.includes('Silicone Body Case')));
  // Start one second before the common monthly boundary and cross it while the page stays open.
  await page.clock.install({time:new Date('2026-12-07T23:59:58Z')});
  await page.clock.pauseAt(new Date('2026-12-07T23:59:59Z'));
  await page.goto(base+'/fhstick.html');await page.waitForFunction(()=>document.querySelector('[data-monthly-countdown] .seconds')?.textContent==='01');
  const count=await page.locator('[data-monthly-countdown]').count();assert.ok(count>=2);
  await page.clock.fastForward(2000);
  assert.equal(await page.locator('[data-countdown]').count(),0);
  for(const timer of await page.locator('[data-monthly-countdown]').all())assert.ok(Number(await timer.locator('.days').innerText())>=28);
  assert.deepEqual(errors,[]);
  console.log('PASS: owner preview/approval, 22 zero-stock catalog entries, homepage search suggestions, product price and zoom, checkout disabled, category/all-products visibility, product and related timers renewing at expiry.');
 }finally{await browser.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
