'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const {freshSqlitePath}=require('../tests/helpers');
Object.assign(process.env,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'});delete process.env.DATABASE_URL;
const db=require('../server/database'),{start}=require('../server');
(async()=>{
 const {server,port}=await start(0),base='http://127.0.0.1:'+port;
 const {chromium}=require(process.env.PLAYWRIGHT_PATH||'playwright');
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const output=process.env.IMAGE_SCREENSHOTS||'/workspace/shared/product-image-quality';fs.mkdirSync(output,{recursive:true});
 const oldLoader=execFileSync('git',['show','origin/main:js/product-images.js'],{encoding:'utf8'});const errors=[];
 try{
  const setup=await browser.newContext();await setup.request.post(base+'/api/auth/login',{data:{username:'demo',password:'demo1234'}});
  for(const batch of ['accessories','camping'])assert.equal((await setup.request.post(base+'/api/admin/catalog-batches/'+batch+'-20261109/apply',{data:{confirm:true}})).status(),200);
  const catalog=await(await setup.request.get(base+'/api/products')).json();assert.equal(catalog.products.length,57);
  for(const product of catalog.products)assert.ok(require('../catalog/product-image-enhancements.json').images[product.image]);
  await setup.close();
  for(const profile of [{width:390,dpr:3},{width:1440,dpr:2}]){
   let baseline;
   for(const enhanced of [false,true]){
    const context=await browser.newContext({viewport:{width:profile.width,height:950},deviceScaleFactor:profile.dpr,serviceWorkers:'block'});
    await context.route('https://www.googletagmanager.com/**',r=>r.abort());
    if(!enhanced)await context.route('**/js/product-images.js*',r=>r.fulfill({contentType:'application/javascript',body:oldLoader}));
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base+'/products');await page.locator('#allProductsGrid .product-card').first().waitFor();await page.evaluate(()=>document.fonts.ready);
    await page.waitForFunction(()=>[...document.querySelectorAll('#allProductsGrid img')].filter(i=>i.getBoundingClientRect().top<innerHeight).every(i=>i.complete&&i.naturalWidth>0));
    const geometry=await page.locator('#allProductsGrid .product-card').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return[Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)];}));
    if(!enhanced)baseline=geometry;else{
     assert.deepEqual(geometry,baseline,'Same grid/card geometry');
     assert.ok((await page.locator('#allProductsGrid img').first().evaluate(n=>n.currentSrc)).includes('/enhanced-20261115/'));
     assert.ok((await page.locator('#allProductsGrid img').first().getAttribute('srcset')).includes('3840w'));
    }
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(output,`catalog-${profile.width}-${enhanced?'after':'before'}.png`),fullPage:false});
    if(enhanced){
     for(const route of ['/','/gopro-accessories','/rental-services','/product/gopro-hero-13-black','/product/manual-camping-tent-3-4-people']){
      await page.goto(base+route);await page.locator('.site-footer').waitFor();
      if(route.startsWith('/product/')){
       await page.waitForFunction(()=>{const image=document.querySelector('.dynamic-product-image');if(image)return image.complete&&image.currentSrc.includes('/enhanced-20261115/');return[...document.querySelectorAll('.single-product-slide')].some(n=>n.style.backgroundImage.includes('/enhanced-20261115/'));});
       await page.screenshot({path:path.join(output,`detail-${profile.width}-${route.includes('camping')?'camping':'gopro'}.png`),fullPage:false});
      }
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),route);
     }
     await page.goto(base+'/');await page.locator('.search-form input[type="search"]').first().fill('headlamp');await page.locator('.search-suggestions img').first().waitFor();
     assert.ok((await page.locator('.search-suggestions img').first().getAttribute('srcset')).includes('3840w'));
    }
    await context.close();
   }
  }
  assert.deepEqual(errors,[]);console.log('PASS: all 57 primary images mapped, desktop/mobile high-DPR enhanced sources, identical card geometry, galleries, homepage, rental and search.');
 }finally{await browser.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
