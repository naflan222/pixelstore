'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.join(__dirname,'..');
function manifest(){return require('../catalog/product-image-enhancements.json');}
test('image-only enhancements cover every catalog primary and preserve original source bytes',()=>{
 const data=manifest(),old=require('../catalog/product-image-variants.json');
 assert.equal(data.catalog_primary_count,57);
 for(const primary of Object.keys(old))assert.ok(data.images[primary],primary);
 for(const group of data.groups){
  const original=fs.readFileSync(path.join(root,group.source));assert.equal(crypto.createHash('sha256').update(original).digest('hex'),group.sha256);
  assert.deepEqual(group.variants.map(p=>p.width),[300,600,1024,1536,2048,3840]);
  for(const variant of group.variants){assert.ok(fs.statSync(path.join(root,variant.src)).size>0);assert.ok(variant.src.startsWith('img/product/enhanced-20261115/'));}
 }
 for(const list of Object.values(data.images))assert.equal(list.at(-1).width,3840);
});
test('loader recognizes primary, old zoom and enhanced paths without touching unrelated uploads',()=>{
 const window={location:{origin:'https://pixelhouse.lk',href:'https://pixelhouse.lk/'},document:{baseURI:'https://pixelhouse.lk/',readyState:'loading',addEventListener(){}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'js/product-images.js'),'utf8'),{window,URL});
 const sources=window.PixelHouseProductImages.sources;
 const original='img/product/3mstick.png';assert.equal(sources(original).at(-1).width,3840);
 assert.equal(sources('img/product/clear-20261110/3mstick-1024.webp').at(-1).width,3840);
 assert.equal(sources(sources(original).at(-1).src).at(-1).width,3840);
 assert.equal(sources('data:image/png;base64,owner-upload').length,0);
 assert.equal(sources('https://elsewhere.example/img/product/3mstick.png').length,0);
 assert.equal(sources('/img/core-img/pixelhouse-header-wordmark.png').length,0);
});
