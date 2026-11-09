const test=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),path=require('path');
const {cleanDescription,withImageSources}=require('../server/product-presentation');
const sources=require('../catalog/product-image-variants.json');
test('product copy omits only the approved boilerplate and keeps facts and owner formatting',()=>{
 assert.equal(cleanDescription('Owner note.  Keep spaces.\n\nSecond paragraph.'),'Owner note.  Keep spaces.\n\nSecond paragraph.');
 assert.equal(cleanDescription('Camera mount. Generic accessory. Reference-based product illustration; final supplied finish and model-specific version will be confirmed when stock arrives.'),'Camera mount.');
 for(const p of [...require('../catalog/accessories-20261109.json'),...require('../catalog/camping-20261109.json')])assert.ok(!/illustration|reference-based|confirmed when stock arrives|generic accessory/i.test(p.description));
});
test('responsive sources cover all current catalog photos without replacing originals or owner uploads',()=>{
 assert.equal(Object.keys(sources).length,57);
 for(const [image,list]of Object.entries(sources)){assert.equal(list[0].src,image);assert.deepEqual(list.map(p=>p.width),[300,600,1024]);for(const p of list)assert.ok(fs.existsSync(path.join(__dirname,'..',p.src)));const product={image};withImageSources(product);assert.equal(product.image,image);assert.equal(product.image_sources.length,3);}
 const upload={image:'data:image/png;base64,owner-photo'};assert.equal(withImageSources(upload),upload);assert.equal(upload.image_sources,undefined);
});
test('responsive loader never observes layout-changing style attributes and is included on storefront templates',()=>{
 const root=path.join(__dirname,'..'),runtime=fs.readFileSync(path.join(root,'js/product-images.js'),'utf8');assert.match(runtime,/attributeFilter:\['src'\]/);
 for(const file of fs.readdirSync(root).filter(p=>p.endsWith('.html'))){const html=fs.readFileSync(path.join(root,file),'utf8');if(html.includes('js/api-client.js'))assert.match(html,/js\/product-images\.js/);}
});
