const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const products=require('../catalog/camping-20261109.json');
function dimensions(b){assert.equal(b.toString('ascii',0,4),'RIFF');assert.equal(b.toString('ascii',8,12),'WEBP');for(let o=12;o+8<b.length;){const type=b.toString('ascii',o,o+4),size=b.readUInt32LE(o+4),p=o+8;if(type==='VP8 ')return[b.readUInt16LE(p+6)&0x3fff,b.readUInt16LE(p+8)&0x3fff];if(type==='VP8L'){const n=b.readUInt32LE(p+1);return[(n&0x3fff)+1,((n>>>14)&0x3fff)+1];}if(type==='VP8X')return[b.readUIntLE(p+4,3)+1,b.readUIntLE(p+7,3)+1];o=p+size+(size%2);}throw Error('No image dimensions');}
test('camping assets match 13 unique zero-stock generic products and exact card/zoom sizes',()=>{
 assert.equal(products.length,13);assert.deepEqual(products.map(p=>p.number),[1,2,3,4,5,6,7,8,9,10,11,12,17]);assert.equal(new Set(products.map(p=>p.sku)).size,13);assert.equal(new Set(products.map(p=>p.slug)).size,13);
 for(const p of products){assert.equal(p.brand,'');assert.equal(p.stock,0);assert.equal(p.old_price,null);assert.equal(p.flash_sale,0);assert.ok(!/naturehike|telesin/i.test(p.name+p.description));for(const[file,size]of[[p.image,300],[p.zoom_image,1024]]){const b=fs.readFileSync(path.join(__dirname,'..',file));assert.deepEqual(dimensions(b),[size,size]);assert.ok(b.length<200000);}}
});
test('camping navigation preserves existing card styling and opens the regular filtered catalog',()=>{
 const root=path.join(__dirname,'..');for(const file of ['home.html','catagory.html','osmocat.html']){const html=fs.readFileSync(path.join(root,file),'utf8');assert.equal((html.match(/<span>Camping Accessories<\/span>/g)||[]).length,1);assert.match(html,/href="products\.html\?category=Camping%20Accessories"/);assert.match(html,/href="osmocat\.html"/);assert.match(html,/href="catagory\.html"/);}
 const review=fs.readFileSync(path.join(root,'admin/camping-preview.html'),'utf8');assert.match(review,/data-catalog-batch="camping-20261109"/);assert.match(review,/Add 13 out-of-stock camping products/);
});
