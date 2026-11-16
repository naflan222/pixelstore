'use strict';
const assert=require('node:assert/strict');
module.exports=async function(ctx){
 const {db,makeSession}=ctx,owner=makeSession(),buyer=makeSession();await owner.post('/api/auth/login',{username:'demo',password:'demo1234'});
 const camera=await db.get("SELECT * FROM products WHERE slug='hero13'");
 assert.equal((await owner.get('/api/admin/invoices/catalog')).data.products.find(p=>p.id===camera.id).serial_eligible,true);
 await buyer.post('/api/cart',{product_id:camera.id,quantity:2});
 const order=await buyer.post('/api/orders',{full_name:'Serial Test Buyer',email:'serial@example.test',phone:'0770000000',address:'Test address',payment_method:'cash'});assert.equal(order.status,200,JSON.stringify(order.data));
 const id=order.data.order_id;const stock=await db.get('SELECT stock FROM products WHERE id=?',camera.id);const count=await db.get('SELECT COUNT(*) AS n FROM orders');
 const before=await(await owner.request('GET','/api/admin/orders/'+id+'/invoice?format=html')).text();
 const data=(await owner.get('/api/admin/orders/'+id+'/serial-invoice')).data;const item=data.items[0];
 assert.equal((await buyer.get('/api/admin/orders/'+id+'/serial-invoice')).status,401);
 const payload={items:[{order_item_id:item.id,serial_numbers:['000ABC-01','SN<02>']}]};
 assert.equal((await owner.put('/api/admin/orders/'+id+'/serial-invoice',payload)).status,200);
 const copy=await(await owner.request('GET','/api/admin/orders/'+id+'/serial-invoice?document=1&format=html')).text();assert.match(copy,/000ABC-01/);assert.match(copy,/SN&lt;02&gt;/);assert.match(copy,/Serial-number copy/);
 const after=await(await owner.request('GET','/api/admin/orders/'+id+'/invoice?format=html')).text();assert.equal(after,before,'Original website invoice must not change');
 assert.deepEqual(await db.get('SELECT stock FROM products WHERE id=?',camera.id),stock);assert.deepEqual(await db.get('SELECT COUNT(*) AS n FROM orders'),count);
 assert.equal((await owner.put('/api/admin/orders/'+id+'/serial-invoice',{items:[{order_item_id:999999,serial_numbers:['invalid']}]})).status,400);
 assert.equal((await owner.put('/api/admin/orders/'+id+'/serial-invoice',{items:[{order_item_id:item.id,serial_numbers:['a','b','c']}]})).status,400);
 const originalFetch=global.fetch;const oldKey=process.env.BREVO_API_KEY,oldFrom=process.env.MAIL_FROM;let emailBody;
 process.env.BREVO_API_KEY='unit-test-only';process.env.MAIL_FROM='invoices@example.test';
 global.fetch=async(input,options)=>{if(String(input).startsWith('https://api.brevo.com/')){emailBody=JSON.parse(options.body);return new Response(JSON.stringify({messageId:'test-serial-copy'}),{status:201,headers:{'Content-Type':'application/json'}});}return originalFetch(input,options);};
 try {const sent=await owner.post('/api/admin/orders/'+id+'/serial-invoice/email',{});assert.equal(sent.status,200,JSON.stringify(sent.data));assert.match(emailBody.subject,/serial-number invoice copy/);assert.match(emailBody.attachment[0].name,/-Serials\.pdf$/);}
 finally {global.fetch=originalFetch;if(oldKey===undefined)delete process.env.BREVO_API_KEY;else process.env.BREVO_API_KEY=oldKey;if(oldFrom===undefined)delete process.env.MAIL_FROM;else process.env.MAIL_FROM=oldFrom;}
 const pdf=await owner.request('GET','/api/admin/orders/'+id+'/serial-invoice?document=1');assert.match(pdf.headers.get('content-type'),/pdf/);const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'%PDF');
 const offline=await owner.post('/api/admin/invoices/offline',{full_name:'Offline Serial Buyer',email:'offline@example.test',payment_method:'cash',items:[{product_id:camera.id,name:camera.name,price:90000,quantity:2,serial_numbers:['00111','00222']}]});assert.equal(offline.status,201,JSON.stringify(offline.data));
 const offlineHtml=await(await owner.request('GET',offline.data.invoice_url+'?format=html')).text();assert.match(offlineHtml,/00111/);assert.match(offlineHtml,/00222/);assert.match(offlineHtml,/Agreed selling price:/);assert.match(offlineHtml,/92,000/);assert.match(offlineHtml,/180,000/);
 const savedSnapshot=await db.get('SELECT s.catalog_price FROM invoice_price_snapshots s JOIN order_items i ON i.id=s.order_item_id WHERE i.order_id=?',offline.data.order_id);assert.equal(savedSnapshot.catalog_price,92000);
 await db.run('UPDATE products SET price=93000 WHERE id=?',camera.id);assert.equal(await(await owner.request('GET',offline.data.invoice_url+'?format=html')).text(),offlineHtml);await db.run('UPDATE products SET price=92000 WHERE id=?',camera.id);assert.deepEqual(await db.get('SELECT stock FROM products WHERE id=?',camera.id),stock);
 const independent=await owner.post('/api/admin/invoices/offline',{full_name:'Manual Amount Buyer',email:'manual@example.test',payment_method:'cash',items:[{product_id:camera.id,name:camera.name,unit_price:92000,price:92000,line_amount:180000,quantity:2,warranty_text:'12-month supplier warranty <confirmed>',serial_numbers:['000CAM-1','000CAM-2']}]});assert.equal(independent.status,201,JSON.stringify(independent.data));
 const independentHtml=await(await owner.request('GET',independent.data.invoice_url+'?format=html')).text();assert.match(independentHtml,/92,000/);assert.match(independentHtml,/180,000/);assert.match(independentHtml,/Warranty: 12-month supplier warranty &lt;confirmed&gt;/);assert.match(independentHtml,/SALES, WARRANTY &amp; SERVICE CONDITIONS/);assert.match(independentHtml,/Consumer Rights:/);assert.doesNotMatch(independentHtml,/Undamaged accessories can be returned/);
 const independentOrder=await db.get('SELECT subtotal,total FROM orders WHERE id=?',independent.data.order_id);assert.equal(independentOrder.subtotal,180000);
 const details=await db.get('SELECT d.* FROM invoice_line_details d JOIN order_items i ON i.id=d.order_item_id WHERE i.order_id=?',independent.data.order_id);assert.equal(details.unit_price,92000);assert.equal(details.line_amount,180000);
 for(const bad of [-1,NaN,180000.001]){const rejected=await owner.post('/api/admin/invoices/offline',{full_name:'Bad amount',email:'bad@example.test',items:[{name:'Camera',unit_price:92000,quantity:2,line_amount:Number.isNaN(bad)?'bad':bad}]});assert.equal(rejected.status,400);}
 const independentPdf=await owner.request('GET',independent.data.invoice_url);assert.equal(independentPdf.status,200);assert.match(independentPdf.headers.get('content-type'),/pdf/);assert.equal(Buffer.from(await independentPdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 const huge=Array.from({length:40},(_,i)=>({unit_index:i,order_item_id:item.id,serial_number:'CAM-'+String(i).padStart(4,'0')+'-'+ 'X'.repeat(100)}));
 const {buildInvoiceModel,renderPdf}=require('../server/invoice');const orderRow=await db.get('SELECT * FROM orders WHERE id=?',id);const largeModel=await buildInvoiceModel(orderRow,[{...item,quantity:40}],{serialCopy:true,serialRows:huge});const largePdf=await renderPdf(largeModel);assert.ok(largePdf.length>3000);
 const settingsBefore=await db.get('SELECT store_name, contact, shipping_fee FROM store_settings WHERE id=1');
 assert.equal(await require('../server/invoice-serials').pauseBankTransfer(db),true);assert.deepEqual((await buyer.get('/api/checkout-settings')).data.payment_methods,['cash']);
 const blocked=await buyer.post('/api/orders',{full_name:'Bank Buyer',email:'bank@example.test',phone:'1',address:'Test',payment_method:'bank'});assert.equal(blocked.status,400);
 assert.deepEqual(await db.get('SELECT store_name, contact, shipping_fee FROM store_settings WHERE id=1'),settingsBefore);
 await db.run('UPDATE store_settings SET payment_methods=? WHERE id=1',JSON.stringify(['cash','bank']));assert.equal(await require('../server/invoice-serials').pauseBankTransfer(db),false);assert.ok((await buyer.get('/api/checkout-settings')).data.payment_methods.includes('bank'));
};
