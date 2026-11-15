'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),express=require('express');
const {responsiveImage}=require('../server/image-loading');
const {enhanceHtml}=require('../server/seo');
const root=path.join(__dirname,'..');
test('first HTML response has responsive product sources instead of downloading the original first',()=>{
 const result=enhanceHtml(fs.readFileSync(path.join(root,'home.html'),'utf8'),'home.html');
 assert.match(result,/<img[^>]+src="img\/product\/enhanced-20261115\/[^>]+sizes=/);
 assert.doesNotMatch(result,/<img[^>]+src="img\/product\/18.png"/);
 assert.match(result,/3840w/);
 assert.match(result,/product-images.js\?v=20261115.4/);
 assert.equal(responsiveImage('data:image/png;base64,owner-upload'),null);
 const icon=responsiveImage('img/core-img/grocery.png');assert.equal(icon.sizes,'48px');assert.ok(icon.src.endsWith('-96.webp'));
});
test('public script compression preserves code, supports conditional requests and refuses gzip q=0',async()=>{
 const app=express();app.get(['/js/product-images.js','/js/api-client.js'],require('../server/public-script-cache').publicScriptCache(root));app.use('/js',express.static(path.join(root,'js')));
 const server=app.listen(0);await new Promise(r=>server.on('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  const response=await fetch(base+'/js/product-images.js',{headers:{'Accept-Encoding':'gzip'}});assert.equal(response.headers.get('content-encoding'),'gzip');assert.match(response.headers.get('vary'),/Accept-Encoding/);
  assert.equal(await response.text(),fs.readFileSync(path.join(root,'js/product-images.js'),'utf8'));
  const cached=await fetch(base+'/js/product-images.js',{headers:{'Accept-Encoding':'gzip','If-None-Match':response.headers.get('etag')}});assert.equal(cached.status,304);
  const plain=await fetch(base+'/js/product-images.js',{headers:{'Accept-Encoding':'gzip;q=0, identity'}});assert.equal(plain.headers.get('content-encoding'),null);
 }finally{await new Promise(r=>server.close(r));}
});
