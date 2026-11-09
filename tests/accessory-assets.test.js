const test=require('node:test');const assert=require('node:assert/strict');const fs=require('fs');const path=require('path');
const products=require('../catalog/accessories-20261109.json');
function dimensions(buffer){
 assert.equal(buffer.toString('ascii',0,4),'RIFF');assert.equal(buffer.toString('ascii',8,12),'WEBP');
 for(let offset=12;offset+8<buffer.length;){const type=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),p=offset+8;
  if(type==='VP8 ')return[buffer.readUInt16LE(p+6)&0x3fff,buffer.readUInt16LE(p+8)&0x3fff];
  if(type==='VP8L'){const bits=buffer.readUInt32LE(p+1);return[(bits&0x3fff)+1,((bits>>>14)&0x3fff)+1];}
  if(type==='VP8X')return[buffer.readUIntLE(p+4,3)+1,buffer.readUIntLE(p+7,3)+1];
  offset=p+size+(size%2);
 }throw Error('Missing WebP image dimensions');
}
test('accessory images have exact card and zoom sizes, with no missing products or duplicate URLs',()=>{
 assert.equal(products.length,22);assert.equal(new Set(products.map(p=>p.slug)).size,22);
 assert.equal(new Set(products.map(p=>p.sku)).size,22);assert.ok(!products.some(p=>[19,24].includes(p.number)));
 for(const p of products){assert.equal(p.stock,0);assert.equal(p.brand,'');assert.equal(p.old_price,null);assert.equal(p.flash_sale,0);
  for(const [file,size]of[[p.image,300],[p.zoom_image,1024]]){const b=fs.readFileSync(path.join(__dirname,'..',file));assert.deepEqual(dimensions(b),[size,size]);assert.ok(b.length<200000,'optimized product asset');}
 }
});
test('all legacy countdown markup uses the shared monthly cycle without changing timer containers',()=>{
 const root=path.join(__dirname,'..');let affected=0;
 for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){const html=fs.readFileSync(path.join(root,file),'utf8');assert.ok(!html.includes('data-countdown='),file+' still has an expired timer');if(html.includes('data-monthly-countdown=')){affected++;assert.match(html,/js\/monthly-cycle\.js/);}}
 assert.ok(affected>=31);
});
