'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { freshSqlitePath } = require('../tests/helpers');
Object.assign(process.env, { DB_ENGINE: 'sqlite', SQLITE_DB_PATH: freshSqlitePath(), NODE_ENV: 'test', SEED_DEMO_DATA: 'true' });
delete process.env.DATABASE_URL;
const db = require('../server/database');
const { start } = require('../server');
const guides = require('../server/guide-pages.json');
(async () => {
 const {server,port} = await start(0), base = 'http://127.0.0.1:' + port;
 const {chromium} = require(process.env.PLAYWRIGHT_PATH || 'playwright');
 const browser = await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const output = '/workspace/shared/seo-preview';fs.mkdirSync(output,{recursive:true});
 const errors=[];
 try {
  for(const width of [390,1440]) for(const theme of ['light','dark']) {
   const context=await browser.newContext({viewport:{width,height:950},serviceWorkers:'block'});
   await context.addInitScript(t=>localStorage.setItem('theme',t),theme);
   await context.route('https://www.googletagmanager.com/**',route=>route.abort());
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   for(const guide of Object.values(guides)) {
    await page.goto(base+guide.route);await page.locator('.site-footer').waitFor();await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('h1').count(),1);
    assert.equal(await page.locator('h1').innerText(),guide.heading);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),guide.route+' width '+width);
    assert.equal(await page.locator('.site-footer a[href="/guides"]').count(),1);
    if(theme==='dark' && guide.route.endsWith('selfie-stick-comparison')) assert.equal(await page.locator('.buying-guide td').first().evaluate(el=>getComputedStyle(el).color),'rgb(222, 221, 234)');
   }
   await page.goto(base+'/guides/selfie-stick-comparison');
   await page.screenshot({path:path.join(output,`guide-${width}-${theme}.png`),fullPage:true});
   await page.goto(base+'/product/gopro-hero-13-black');await page.locator('[data-buying-copy="hero13"]').waitFor();
   assert.equal(await page.locator('[data-catalog-description]').innerText(),(await (await context.request.get(base+'/api/products/hero13')).json()).product.description);
   await page.screenshot({path:path.join(output,`product-${width}-${theme}.png`),fullPage:true});
   await page.goto(base+'/rental-services');assert.equal(await page.locator('.btn-rental-book').count(),5);
   assert.equal(await page.locator('section[aria-label="Rental guidance"]').count(),1);
   await page.screenshot({path:path.join(output,`rental-${width}-${theme}.png`),fullPage:true});
   await context.close();
  }
  const nojs=await browser.newContext({javaScriptEnabled:false});const page=await nojs.newPage();
  await page.goto(base+'/guides/selfie-stick-comparison');assert.match(await page.locator('body').innerText(),/Choose for the shot/);await nojs.close();
  assert.deepEqual(errors,[]);console.log('PASS: six guides, mobile/desktop light/dark, no-JS content, product advice/admin text, rental links and screenshot previews.');
 } finally {await browser.close();await new Promise(r=>server.close(r));await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
