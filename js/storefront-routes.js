/* Shared URL registry; template names remain internal page identities. */
(function(root,factory){
  const routes=factory();
  if(typeof module==='object'&&module.exports)module.exports=routes;
  else {
    root.PixelHouseRoutes=routes;
    const data=JSON.parse(root.document.getElementById('storefront-route-data')?.textContent||'{}');
    routes.data=data;
    routes.href=value=>routes.cleanHref(value,data.productPaths,root.location.origin,root.location.pathname+root.location.search);
    routes.productSlug=value=>{try{const path=new URL(value,root.document.baseURI).pathname;return data.productSlugs?.[path]||'';}catch(_){return '';}};
    const normalize=node=>{
      if(!node||!node.querySelectorAll)return;
      const links=[...(node.matches?.('[href],[action]')?[node]:[]),...node.querySelectorAll('[href],[action]')];
      for(const el of links)for(const attr of ['href','action']){
        if(!el.hasAttribute(attr)||el.matches('base,link'))continue;
        const value=el.getAttribute(attr),clean=routes.href(value);
        if(clean!==value){if(attr==='href'&&!el.hasAttribute('data-legacy-href'))el.setAttribute('data-legacy-href',value);el.setAttribute(attr,clean);}
      }
    };
    const start=()=>{normalize(root.document);new MutationObserver(records=>{for(const record of records){if(record.type==='attributes')normalize(record.target);else record.addedNodes.forEach(normalize);}}).observe(root.document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href','action']});};
    if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',start);else start();
  }
})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const FILE_PATHS={
  "360accesories.html": "/insta360-accessories",
  "about-us.html": "/about-us",
  "actioncamera.html": "/actioncamera",
  "become-vendor.html": "/become-vendor",
  "blog-details.html": "/",
  "blog-grid.html": "/",
  "blog-list.html": "/blog-list",
  "camera-trade.html": "/camera-trade",
  "cart.html": "/cart",
  "catagory.html": "/gopro-accessories",
  "change-password.html": "/change-password",
  "checkout-bank.html": "/checkout-bank",
  "checkout-cash.html": "/checkout-cash",
  "checkout-payment.html": "/checkout-payment",
  "checkout.html": "/checkout",
  "contact.html": "/contact",
  "dji-osmo-camera.html": "/dji-osmo-camera",
  "edit-profile.html": "/edit-profile",
  "featured-products.html": "/products",
  "flash-sale.html": "/products",
  "forget-password-success.html": "/forget-password-success",
  "forget-password.html": "/forget-password",
  "gpproducts2.html": "/gopro-accessories?page=2",
  "home.html": "/",
  "index.html": "/",
  "insta360-camera.html": "/insta360-camera",
  "intro.html": "/intro",
  "language.html": "/language",
  "login.html": "/login",
  "message.html": "/message",
  "my-order.html": "/my-order",
  "notification-details.html": "/notification-details",
  "notifications.html": "/notifications",
  "offline.html": "/offline",
  "osmocat.html": "/osmo-accessories",
  "otp-confirm.html": "/otp-confirm",
  "otp.html": "/otp",
  "payment-success.html": "/payment-success",
  "privacy-policy.html": "/privacy-policy",
  "products.html": "/products",
  "profile.html": "/profile",
  "register.html": "/register",
  "rental-services.html": "/rental-services",
  "return-policy.html": "/return-policy",
  "shipping-policy.html": "/shipping-policy",
  "shop-grid.html": "/products",
  "shop-list.html": "/products",
  "sub-catagory.html": "/categories",
  "support.html": "/support",
  "terms.html": "/terms",
  "vendor-shop.html": "/products",
  "vendors.html": "/vendors",
  "wishlist-grid.html": "/wishlist-grid",
  "wishlist-list.html": "/wishlist-list",
  "admin/index.html": "/admin/",
  "admin/camping-preview.html": "/admin/camping-preview",
  "admin/accessories-preview.html": "/admin/accessories-preview"
};
  const ROUTE_FILES={};for(const [file,url]of Object.entries(FILE_PATHS)){if(!url.includes('?')&&(!ROUTE_FILES[url]||['home.html','products.html'].includes(file)))ROUTE_FILES[url]=file;}
  function cleanHref(value,productPaths={},origin='https://pixelhouse.lk',current='/'){
    if(typeof value!=='string'||!value)return value;
    if(value.startsWith('#'))return current+value;
    let url;try{url=new URL(value,origin+'/');}catch(_){return value;}
    if(!['http:','https:'].includes(url.protocol)||url.origin!==origin)return value;
    const file=url.pathname.slice(1),mapped=(file==='single-product.html'&&url.searchParams.get('product')?productPaths[url.searchParams.get('product')+'.html']:null)||FILE_PATHS[file]||productPaths[file];
    if(!mapped)return url.pathname+url.search+url.hash;
    const target=new URL(mapped,origin);
    for(const key of new Set(url.searchParams.keys())){
      if(key==='product'&&productPaths[file==='single-product.html'?url.searchParams.get('product')+'.html':file])continue;
      target.searchParams.delete(key);for(const item of url.searchParams.getAll(key))target.searchParams.append(key,item);
    }
    if(target.searchParams.get('page')==='1')target.searchParams.delete('page');
    target.hash=url.hash;return target.pathname+target.search+target.hash;
  }
  return {FILE_PATHS,ROUTE_FILES,cleanHref};
});
