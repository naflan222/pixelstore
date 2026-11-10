// Desktop + mobile layout regression, using only disposable local catalog data.
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const{freshSqlitePath}=require('../tests/helpers');Object.assign(process.env,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'});delete process.env.DATABASE_URL;
const{start}=require('../server');const db=require('../server/database');
(async()=>{const{server,port}=await start(0),base=`http://127.0.0.1:${port}`;const{chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const screenshots=process.env.LAYOUT_SCREENSHOTS||'/workspace/shared/desktop-layout';fs.mkdirSync(screenshots,{recursive:true});try{
 const setup=await browser.newContext();await setup.request.post(base+'/api/auth/login',{data:{username:'demo',password:'demo1234'}});for(const batch of ['accessories','camping'])assert.equal((await setup.request.post(base+`/api/admin/catalog-batches/${batch}-20261109/apply`,{data:{confirm:true}})).status(),200);
 await setup.close();
 const errors=[];
 for(const theme of ['light','dark'])for(const width of [390,980,1440]){
  const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});await context.addInitScript(t=>localStorage.setItem('theme',t),theme);
  for(const route of ['catagory.html','gpproducts2.html','catagory.html?page=3','osmocat.html']){
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base+'/'+route);await page.waitForFunction(()=>document.querySelector('[data-catalog-category] .product-card'));await page.evaluate(()=>document.fonts.ready);
   const result=await page.evaluate(()=>{const guide=document.querySelector('[data-category-guide]'),catalog=document.querySelector('[data-catalog-category]'),nav=catalog.querySelector('nav');return{guide:guide.getBoundingClientRect().top,catalog:catalog.getBoundingClientRect().bottom,nav:nav.getBoundingClientRect().bottom,body:document.documentElement.scrollWidth,h1:document.querySelectorAll('h1').length,text:guide.innerText,cards:catalog.querySelectorAll('.product-card').length};});
   assert.equal(result.h1,1);assert.ok(result.cards>0);assert.ok(result.guide>=result.catalog-1);assert.ok(result.guide>=result.nav);assert.ok(result.body<=width+1);assert.ok(!result.text.includes('More GoPro'));assert.ok(!result.text.includes('camera instead'));
   if(theme==='light'&&[390,1440].includes(width)&&['gpproducts2.html','osmocat.html'].includes(route))await page.screenshot({path:path.join(screenshots,`category-copy-${route.replace('.html','')}-${width}.png`),fullPage:true});await page.close();
  } await context.close();
 }
 assert.deepEqual(errors,[]);console.log('PASS: 24 category/theme/viewport combinations, GoPro pages 1–3, guide below products/pagination, one heading, no overflow or browser errors.');
}finally{await browser.close();await new Promise(r=>server.close(r));await db.close();}})().catch(e=>{console.error(e);process.exitCode=1});
