const assert=require('node:assert/strict');const {freshSqlitePath}=require('../tests/helpers');
Object.assign(process.env,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'});delete process.env.DATABASE_URL;
const {start}=require('../server');const db=require('../server/database');
(async()=>{const {server,port}=await start(0),base=`http://127.0.0.1:${port}`;const{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});try{
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:3,serviceWorkers:'block'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await context.request.post(base+'/api/auth/login',{data:{username:'demo',password:'demo1234'}});
 await context.request.post(base+'/api/admin/catalog-batches/accessories-20261109/apply',{data:{confirm:true}});
 await context.request.post(base+'/api/admin/catalog-batches/camping-20261109/apply',{data:{confirm:true}});
 await page.goto(base+'/products.html');await page.locator('#allProductsGrid .product-card').first().waitFor();
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('#allProductsGrid img')).some(img=>img.complete&&/(?:-600|-large|-1024)\.webp$/.test(img.currentSrc)));
 const image=page.locator('#allProductsGrid img').first(),before=await image.boundingBox();assert.ok(before.width>80&&before.width<200);
 assert.ok((await image.getAttribute('srcset')).includes('1024w'));
 await page.goto(base+'/single-product.html?product=adjustable-chest-strap-mount');await page.locator('.p-title-price h5').filter({hasText:'Adjustable Chest Strap'}).waitFor();
 const description=await page.locator('.p-specification .container p').first().innerText();assert.ok(!/illustration|reference-based|confirmed when stock arrives|Generic accessory/i.test(description));
 assert.equal(await page.locator('.cart-form button[type="submit"]').innerText(),'Out of Stock');assert.ok((await page.locator('.dynamic-product-image').first().getAttribute('src')).endsWith('-large.webp'));
 await page.goto(base+'/');const search=page.locator('.search-form input[type="search"]').first();await search.fill('headlamp');await page.locator('.search-suggestions a').filter({hasText:'Headlamp'}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.search-suggestions img')?.srcset.includes('1024w'));
 // Original card dimensions stay the same with the responsive loader disabled.
 const baseline=await context.newPage();await baseline.route('**/js/product-images.js*',r=>r.fulfill({contentType:'application/javascript',body:''}));await baseline.goto(base+'/products.html');await baseline.locator('#allProductsGrid img').first().waitFor();const after=await baseline.locator('#allProductsGrid img').first().boundingBox();assert.equal(Math.round(after.width),Math.round(before.width));assert.equal(Math.round(after.height),Math.round(before.height));await baseline.close();
 assert.deepEqual(errors,[]);console.log('PASS: 3x mobile high-resolution sources, clean product copy, original card geometry, large detail image, out-of-stock behavior and responsive search images.');
}finally{await browser.close();await new Promise(r=>server.close(r));await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
