'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {withServer}=require('./helpers');
test('promotion launch and date/product visibility are portable to PostgreSQL',async t=>{
 delete process.env.DATABASE_URL;delete process.env.SQLITE_DB_PATH;
 await withServer(t,{DB_ENGINE:'postgres',PG_MEM_TEST:'1',NODE_ENV:'test',SEED_DEMO_DATA:'true'},async({db,makeSession})=>{
  const {launch,listPromotions}=require('../server/promotions');assert.equal(await launch(db),true);assert.equal(await launch(db),false);
  const rows=await listPromotions(db,true);assert.equal(rows.length,1);assert.equal(rows[0].price,105000);
  await db.run("UPDATE products SET status='inactive' WHERE id=?",rows[0].product_id);assert.equal((await listPromotions(db,true)).length,0);
  await db.run("UPDATE products SET status='active' WHERE id=?",rows[0].product_id);
  const owner=makeSession();await owner.post('/api/auth/login',{username:'demo',password:'demo1234'});
  assert.equal((await owner.put('/api/admin/promotions/'+rows[0].id,{...rows[0],show_popup:false})).status,200);
  assert.equal((await listPromotions(db,true))[0].show_popup,0);
 });
});
