const assert=require('node:assert/strict');
const {cleanStoredDescriptions}=require('../server/product-presentation');
async function presentationSuite(t,ctx){
 await t.test('copy cleanup removes only approved boilerplate and preserves existing product data',async()=>{
  const camera=await ctx.db.get('SELECT * FROM products WHERE sku = ?','PH-ACC-20261109-01');
  const camp=await ctx.db.get('SELECT * FROM products WHERE sku = ?','PH-CAMP-20261109-01');
  const other=await ctx.db.get('SELECT * FROM products WHERE slug = ?','hero13');
  const suffix='Generic accessory. Reference-based product illustration; final supplied finish and model-specific version will be confirmed when stock arrives.';
  await ctx.db.run('UPDATE products SET description = ? WHERE id = ?','Custom owner detail. '+suffix,camera.id);
  await ctx.db.run('UPDATE products SET description = ? WHERE id = ?','A rechargeable headlamp. Generic, unbranded product. Image is an illustration; final supplied details and colour will be confirmed when stock arrives.',camp.id);
  await ctx.db.run('UPDATE products SET description = ? WHERE id = ?',suffix,other.id);
  assert.equal(await cleanStoredDescriptions(ctx.db),2);
  assert.equal((await ctx.db.get('SELECT description FROM products WHERE id = ?',camera.id)).description,'Custom owner detail.');
  assert.equal((await ctx.db.get('SELECT description FROM products WHERE id = ?',camp.id)).description,'A rechargeable headlamp.');
  assert.equal((await ctx.db.get('SELECT description FROM products WHERE id = ?',other.id)).description,suffix);
  for(const old of [camera,camp]){const now=await ctx.db.get('SELECT * FROM products WHERE id = ?',old.id);delete now.description;delete old.description;assert.deepEqual(now,old);}
  assert.equal(await cleanStoredDescriptions(ctx.db),0);
  await ctx.db.run('UPDATE products SET description = ? WHERE id = ?',other.description,other.id);
 });
 await t.test('description cleanup does not overwrite a concurrent owner edit',async()=>{
  const row=await ctx.db.get('SELECT id FROM products WHERE sku = ?','PH-ACC-20261109-01');
  await ctx.db.run('UPDATE products SET description = ? WHERE id = ?','Useful detail. Generic accessory. Reference-based product illustration; final supplied finish and model-specific version will be confirmed when stock arrives.',row.id);
  let changed=false;
  const wrapped={transaction:task=>ctx.db.transaction(tx=>task({...tx,run:async(sql,...args)=>{
    if(sql.startsWith('UPDATE products SET description')&&!changed){changed=true;await tx.run('UPDATE products SET description = ? WHERE id = ?','New owner-written description.',row.id);}
    return tx.run(sql,...args);
  }}))};
  assert.equal(await cleanStoredDescriptions(wrapped),0);
  assert.equal((await ctx.db.get('SELECT description FROM products WHERE id = ?',row.id)).description,'New owner-written description.');
 });
}
module.exports={presentationSuite};
