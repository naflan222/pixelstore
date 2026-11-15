'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withServer,freshSqlitePath}=require('./helpers');
const {launch,BUNDLE_SKU}=require('../server/promotions');
test('product promotions and bundle launch work end to end without overwriting owner edits',async t=>{
 await withServer(t,{DB_ENGINE:'sqlite',SQLITE_DB_PATH:freshSqlitePath(),NODE_ENV:'test',SEED_DEMO_DATA:'true'},async({base,db,makeSession})=>{
  const owner=makeSession(),guest=makeSession();await owner.post('/api/auth/login',{username:'demo',password:'demo1234'});
  assert.equal(await launch(db),true);
  const hero=await db.get("SELECT * FROM products WHERE slug='hero13'");assert.equal(hero.price,92000);assert.equal(hero.old_price,120000);
  const bundle=await db.get('SELECT * FROM products WHERE sku=?',BUNDLE_SKU);assert.equal(bundle.price,105000);assert.equal(bundle.stock,20);
  let list=await guest.get('/api/promotions');assert.equal(list.data.promotions.length,1);const promo=list.data.promotions[0];assert.equal(promo.product_id,bundle.id);assert.equal(promo.url_path,'/product/gopro-hero13-bundle');
  assert.equal((await guest.post('/api/admin/promotions',{product_id:hero.id})).status,401);
  assert.equal((await owner.post('/api/admin/promotions',{product_id:bundle.id})).status,409);
  assert.equal((await owner.put('/api/admin/promotions/'+promo.id,{...promo,is_active:false})).status,200);
  assert.equal((await guest.get('/api/promotions')).data.promotions.length,0);
  await owner.put('/api/admin/promotions/'+promo.id,{...promo,show_popup:false});
  assert.equal((await guest.get('/api/promotions')).data.promotions[0].show_popup,0);
  await owner.put('/api/admin/promotions/'+promo.id,{...promo,starts_at:'2099-01-01'});assert.equal((await guest.get('/api/promotions')).data.promotions.length,0);
  await owner.put('/api/admin/promotions/'+promo.id,promo);
  const page=await(await fetch(base+'/product/gopro-hero13-bundle')).text();assert.match(page,/GoPro HERO13 Bundle/);assert.match(page,/Bundle details/);assert.doesNotMatch(page,/Accessory Kit Video|This complete action camera accessory kit/);assert.match(page,/1536w/);
  const excess = makeSession();
  await excess.post('/api/cart',{product_id:bundle.id,quantity:21});
  const rejected = await excess.post('/api/orders', { full_name: 'Excess Buyer', email: 'excess@example.test', phone: '0770000000', address: 'Test address', shipping_method: 'standard', payment_method: 'cash' });
  assert.equal(rejected.status,400);assert.equal((await db.get('SELECT stock FROM products WHERE id=?',bundle.id)).stock,20);

  await db.run('UPDATE products SET stock=0 WHERE id=?',bundle.id);
  assert.equal((await guest.post('/api/cart',{product_id:bundle.id,quantity:1})).status,400);
  await db.run('UPDATE products SET stock=2 WHERE id=?',bundle.id);
  assert.equal((await guest.post('/api/cart',{product_id:bundle.id,quantity:1})).status,200);
  const order = await guest.post('/api/orders', { full_name: 'Bundle Buyer', email: 'bundle@example.test', phone: '0770000000', address: 'Test address', shipping_method: 'standard', payment_method: 'cash' });
  assert.equal(order.status,200);assert.equal(order.data.subtotal,105000);assert.equal((await db.get('SELECT stock FROM products WHERE id=?',bundle.id)).stock,1);
  assert.equal((await db.get('SELECT stock FROM products WHERE id=?',hero.id)).stock,hero.stock, 'Bundle has independent stock, not hidden component deductions.');
  const promotionsPage=await(await fetch(base+'/promotions')).text();assert.match(promotionsPage,/GoPro HERO13 Bundle/);assert.match(promotionsPage,/data-cart-id=/);

  const created=await owner.post('/api/admin/promotions',{product_id:hero.id,is_active:true,show_popup:false});assert.equal(created.status,201);
  assert.equal((await guest.get('/api/promotions')).data.promotions.length,2);
  await owner.del('/api/admin/promotions/'+created.data.id);assert.ok(await db.get('SELECT id FROM products WHERE id=?',hero.id));
  await db.run('UPDATE products SET price=106000,stock=3 WHERE id=?',bundle.id);await db.run('UPDATE products SET old_price=121000 WHERE id=?',hero.id);
  assert.equal(await launch(db),false);const changed=await db.get('SELECT * FROM products WHERE id=?',bundle.id);assert.equal(changed.stock,3);assert.equal(changed.price,106000);assert.equal((await db.get('SELECT old_price FROM products WHERE id=?',hero.id)).old_price,121000);
 });
});
