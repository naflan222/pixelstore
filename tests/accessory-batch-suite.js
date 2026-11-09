const assert = require('node:assert/strict');
const batch = require('../server/accessory-batch');
const approved = {1:1300,2:800,3:600,4:500,5:900,6:700,7:4499,8:800,9:6299,10:1499,11:1899,12:3990,13:1990,14:2490,15:5800,16:2500,17:8500,18:1000,20:2490,21:4500,22:1200,23:1800};
async function accessorySuite(t, ctx, owner, guest) {
  const endpoint = '/api/admin/catalog-batches/accessories-20261109';
  const original = await ctx.db.all('SELECT * FROM products ORDER BY id');
  await t.test('accessory preview enforces owner access and approved manifest without publishing', async () => {
    assert.equal((await guest.get(endpoint)).status, 401);
    const customer = ctx.makeSession();
    await customer.post('/api/auth/register', {username:'accessory-customer',email:'accessory@example.test',password:'Testpass123'});
    await customer.post('/api/auth/login', {username:'accessory-customer',password:'Testpass123'});
    assert.equal((await customer.get(endpoint)).status, 403);
    assert.equal((await customer.post(endpoint+'/apply', {confirm:true})).status, 403);
    assert.equal((await owner.post(endpoint+'/apply', {})).status, 400);
    const preview = await owner.get(endpoint);
    assert.equal(preview.status, 200);
    assert.equal(preview.data.state, 'not_applied');
    assert.equal(preview.data.products.length, 22);
    assert.deepEqual(Object.fromEntries(preview.data.products.map(p => [p.number,p.price])), approved);
    assert.ok(preview.data.products.every(p => p.stock === 0 && p.brand === '' && !/telesin/i.test(p.name+p.description)));
    assert.equal((await ctx.db.all('SELECT * FROM products')).length, original.length);
    const legacy = original.find(p => p.status === 'active' && !p.image.endsWith('.webp'));
    if (legacy) { const detail=(await guest.get('/api/products/'+legacy.slug)).data.product; assert.equal(detail.image,legacy.image); assert.ok(detail.zoom_image.endsWith('-1024.webp')); }
  });
  await t.test('accessory import refuses collisions without partial writes', async () => {
    const last = batch.products.at(-1);
    const collision = await ctx.db.insert('INSERT INTO products (name, slug, price, image, stock) VALUES (?, ?, 1, ?, 1)', 'Collision fixture', last.slug, 'img/product/1.webp');
    try {
      const response = await owner.post(endpoint+'/apply', {confirm:true});
      assert.equal(response.status, 409);
      assert.equal((await ctx.db.all("SELECT * FROM products WHERE sku LIKE 'PH-ACC-20261109-%'")).length, 0);
    } finally { await ctx.db.run('DELETE FROM products WHERE id = ?', collision.id); }
  });
  await t.test('accessory import rolls back a mid-batch database failure', {skip: !ctx.realTransactions ? 'pg-mem does not implement rollback; covered on SQLite and real PostgreSQL' : false}, async () => {
    let count=0;
    const failing = {forUpdate: ctx.db.forUpdate, transaction: task => ctx.db.transaction(tx => task({...tx, insert: async (...args) => { if(args[0].startsWith('INSERT INTO products') && ++count === 4) throw new Error('simulated insert failure'); return tx.insert(...args); }}))};
    await assert.rejects(() => batch.apply(failing, null), /simulated insert failure/);
    assert.equal((await ctx.db.all("SELECT * FROM products WHERE sku LIKE 'PH-ACC-20261109-%'")).length, 0);
    assert.equal(await batch.state(ctx.db), undefined);
  });
  let created;
  await t.test('approved accessories become complete searchable zero-stock catalog products', async () => {
    const response = await owner.post(endpoint+'/apply', {confirm:true});
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.created.length, 22); created=response.data.created;
    for(const product of batch.products) {
      const result = await guest.get('/api/products/'+product.slug);
      assert.equal(result.status,200);
      assert.equal(Number(result.data.product.price),approved[product.number]);
      assert.equal(result.data.product.stock,0);
      assert.equal(result.data.product.rating_count,0);
      assert.equal(result.data.product.brand,'');
      assert.equal(result.data.product.zoom_image,product.zoom_image);
      assert.equal((await guest.post('/api/cart',{product_id:result.data.product.id,quantity:1})).status,400);
    }
    const search = await guest.get('/api/products?q=windshield');
    assert.ok(search.data.products.some(p=>p.slug===batch.products.find(p=>p.number===9).slug));
    const dji = await guest.get('/api/products?category=Osmo%20Accessories');
    assert.equal(dji.data.products.filter(p=>p.sku?.startsWith('PH-ACC-20261109-')).length,4);
    const normal = await owner.get('/api/admin/products?search=Tripod%20Mount%20Adapter');
    assert.ok(normal.data.products.some(p=>p.sku===batch.products[0].sku));
    assert.equal((await guest.get('/'+batch.products[0].image)).status,200);
  });
  await t.test('replaying an accessory import preserves later stock and price edits', async () => {
    const first=created[0];
    await ctx.db.run('UPDATE products SET stock = 7, price = 1450 WHERE id = ?',first.id);
    const response=await owner.post(endpoint+'/apply',{confirm:true});
    assert.equal(response.status,200);assert.equal(response.data.already_applied,true);
    const row=await ctx.db.get('SELECT stock,price FROM products WHERE id = ?',first.id);
    assert.equal(row.stock,7);assert.equal(Number(row.price),1450);
    assert.equal((await ctx.db.all("SELECT id FROM products WHERE sku LIKE 'PH-ACC-20261109-%'")).length,22);
  });
  await t.test('accessory rollback hides only recorded products without resetting or deleting data', async () => {
    const response=await owner.post(endpoint+'/rollback',{confirm:true});
    assert.equal(response.status,200);assert.equal(response.data.changed,22);
    assert.equal((await guest.get('/api/products/'+batch.products[0].slug)).status,404);
    assert.equal((await ctx.db.get('SELECT stock FROM products WHERE id = ?',created[0].id)).stock,7);
    assert.deepEqual(await ctx.db.all('SELECT * FROM products WHERE id <= ? ORDER BY id',original.at(-1).id),original);
    assert.equal((await owner.post(endpoint+'/apply',{confirm:true})).status,409);
    assert.equal((await owner.post(endpoint+'/rollback',{confirm:true})).data.changed,0);
  });
}
module.exports = {accessorySuite};
