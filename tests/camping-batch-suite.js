const assert=require('node:assert/strict');
const batch=require('../server/camping-batch');
const approved={1:4500,2:3500,3:1800,4:3400,5:2800,6:3800,7:1300,8:2200,9:6800,10:1700,11:4500,12:5800,17:11800};
async function campingSuite(t,ctx,owner,guest){
 const endpoint='/api/admin/catalog-batches/camping-20261109';
 const original=await ctx.db.all('SELECT * FROM products ORDER BY id');
 const accessoryState=await require('../server/accessory-batch').state(ctx.db);
 await t.test('camping preview contains only the 13 approved generic products without publishing',async()=>{
  assert.equal((await guest.get(endpoint)).status,401);
  assert.equal((await owner.post(endpoint+'/apply',{})).status,400);
  const customer=ctx.makeSession();await customer.post('/api/auth/login',{username:'accessory-customer',password:'Testpass123'});
  assert.equal((await customer.post(endpoint+'/apply',{confirm:true})).status,403);
  const preview=await owner.get(endpoint);assert.equal(preview.status,200);assert.equal(preview.data.state,'not_applied');
  assert.deepEqual(Object.fromEntries(preview.data.products.map(p=>[p.number,p.price])),approved);
  assert.ok(preview.data.products.every(p=>p.brand===''&&p.stock===0&&p.category==='Camping Accessories'&&!/naturehike|telesin/i.test(p.name+p.description)));
  assert.equal((await ctx.db.all('SELECT * FROM products')).length,original.length);
 });
 await t.test('camping import refuses collisions and does not change the accessory batch',async()=>{
  const collision=await ctx.db.insert("INSERT INTO products (name,slug,price,image,stock) VALUES (?, ?, 1, ?, 1)",'Camping collision fixture',batch.products.at(-1).slug,'img/product/1.webp');
  try{assert.equal((await owner.post(endpoint+'/apply',{confirm:true})).status,409);assert.equal((await ctx.db.all("SELECT id FROM products WHERE sku LIKE 'PH-CAMP-20261109-%'")).length,0);}
  finally{await ctx.db.run('DELETE FROM products WHERE id = ?',collision.id);}
  assert.deepEqual(await require('../server/accessory-batch').state(ctx.db),accessoryState);
 });
 await t.test('camping import rolls back a mid-batch failure',{skip:!ctx.realTransactions?'pg-mem cannot roll back; checked on SQLite and real PostgreSQL':false},async()=>{
  let count=0;const failing={forUpdate:ctx.db.forUpdate,transaction:task=>ctx.db.transaction(tx=>task({...tx,insert:async(...args)=>{if(args[0].startsWith('INSERT INTO products')&&++count===4)throw Error('simulated camping failure');return tx.insert(...args);}}))};
  await assert.rejects(()=>batch.apply(failing,null),/simulated camping failure/);
  assert.equal((await ctx.db.all("SELECT id FROM products WHERE sku LIKE 'PH-CAMP-20261109-%'")).length,0);assert.equal(await batch.state(ctx.db),undefined);
 });
 let created;
 await t.test('camping products appear in normal catalog, category, search and admin while stock is zero',async()=>{
  const response=await owner.post(endpoint+'/apply',{confirm:true});assert.equal(response.status,200,JSON.stringify(response.data));created=response.data.created;assert.equal(created.length,13);
  for(const p of batch.products){const detail=await guest.get('/api/products/'+p.slug);assert.equal(detail.status,200);const product=detail.data.product;assert.equal(Number(product.price),approved[p.number]);assert.equal(product.stock,0);assert.equal(product.brand,'');assert.equal(product.zoom_image,p.zoom_image);assert.equal(product.flash_sale,0);assert.equal(product.rating_count,0);assert.equal(product.old_price,null);assert.equal((await guest.post('/api/cart',{product_id:product.id,quantity:1})).status,400);}
  const category=await guest.get('/api/products?category=Camping%20Accessories');assert.equal(category.data.products.length,13);
  assert.ok((await guest.get('/api/products?q=headlamp')).data.products.some(p=>p.sku===batch.products[0].sku));
  assert.ok((await owner.get('/api/admin/products?search=Headlamp')).data.products.some(p=>p.sku===batch.products[0].sku));
  const categories=await owner.get('/api/admin/categories');assert.ok(categories.data.categories.some(c=>c.name==='Camping Accessories'));
 });
 await t.test('camping replay does not reset later quantities and prices',async()=>{
  await ctx.db.run('UPDATE products SET stock = 5, price = 4700 WHERE id = ?',created[0].id);
  const response=await owner.post(endpoint+'/apply',{confirm:true});assert.equal(response.data.already_applied,true);
  const p=await ctx.db.get('SELECT stock,price FROM products WHERE id = ?',created[0].id);assert.equal(p.stock,5);assert.equal(Number(p.price),4700);
  assert.equal((await ctx.db.all("SELECT id FROM products WHERE sku LIKE 'PH-CAMP-20261109-%'")).length,13);
 });
 await t.test('camping rollback hides only this batch and preserves the camera catalog',async()=>{
  const response=await owner.post(endpoint+'/rollback',{confirm:true});assert.equal(response.status,200);assert.equal(response.data.changed,13);
  assert.equal((await guest.get('/api/products/'+batch.products[0].slug)).status,404);
  assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?',created[0].id)).stock,5);
  assert.deepEqual(await ctx.db.all('SELECT * FROM products WHERE id <= ? ORDER BY id',original.at(-1).id),original);
  assert.deepEqual(await require('../server/accessory-batch').state(ctx.db),accessoryState);
  assert.equal((await owner.post(endpoint+'/apply',{confirm:true})).status,409);
 });
}
module.exports={campingSuite};
