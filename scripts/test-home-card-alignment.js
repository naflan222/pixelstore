// Desktop + mobile layout regression, using only disposable local catalog data.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const{freshSqlitePath}=require('../tests/helpers');Object.assign(process.env,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'});delete process.env.DATABASE_URL;
const{start}=require('../server');const db=require('../server/database');
(async()=>{const{server,port}=await start(0),base=`http://127.0.0.1:${port}`;const{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const screenshots=process.env.LAYOUT_SCREENSHOTS||'/workspace/shared/desktop-layout';fs.mkdirSync(screenshots,{recursive:true});try{
 const setup=await browser.newContext();await setup.request.post(base+'/api/auth/login',{data:{username:'demo',password:'demo1234'}});for(const batch of ['accessories','camping'])assert.equal((await setup.request.post(base+`/api/admin/catalog-batches/${batch}-20261109/apply`,{data:{confirm:true}})).status(),200);

 await db.run("UPDATE products SET rating=5, rating_count=1 WHERE slug='fhstick'");
 const catalog=(await (await setup.request.get(base+'/api/products')).json()).products;const rated=catalog.find(p=>p.slug==='fhstick');const products=[...catalog.filter(p=>p.slug!=='fhstick').slice(0,3),{...rated,rating:5,rating_count:1},...catalog.filter(p=>p.slug!=='fhstick').slice(3,5)];
 await setup.close();const errors=[];
 for(const theme of ['light','dark'])for(const width of [360,390,430,980,1440]){
 const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});await context.addInitScript(t=>localStorage.setItem('theme',t),theme);await context.route('**/api/homepage-sections',r=>r.fulfill({json:{sections:{top_products:products},configured_sections:['top_products']}}));const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/');await page.waitForFunction(()=>document.querySelectorAll('[data-home-products="top_products"] .product-cart-button').length===6);await page.evaluate(()=>document.fonts.ready);
 const cards=await page.locator('[data-home-products="top_products"] .product-card').evaluateAll(nodes=>nodes.map(n=>({y:n.getBoundingClientRect().top,h:n.getBoundingClientRect().height,button:n.querySelector('.product-cart-button').getBoundingClientRect().bottom})));
 for(const card of cards)for(const sibling of cards.filter(other=>Math.abs(other.y-card.y)<1)){assert.ok(Math.abs(card.h-sibling.h)<1);assert.ok(Math.abs(card.button-sibling.button)<1);}
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.equal(await page.locator('[data-home-products="top_products"] .product-rating:not([hidden])').count(),1);
 if(theme==='light'&&[390,1440].includes(width))await page.locator('.top-products-area').screenshot({path:path.join(screenshots,`aligned-home-cards-${width}.png`),style:'.header-area,.footer-nav-area,.pwa-install-alert { visibility: hidden !important; }'});await context.close();
 }assert.deepEqual(errors,[]);console.log('PASS: equal homepage card heights and cart button alignment at 360/390/430/980/1440px in light/dark; rated card retained; no overflow or browser errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
