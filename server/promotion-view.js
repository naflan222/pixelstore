'use strict';
const { BUNDLE_SKU } = require('./promotions');
const esc = value => String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
function renderBundle(html, product) {
  if (!product || (product.sku !== BUNDLE_SKU && product.url_slug !== 'gopro-hero13-bundle')) return html;
  let result = html.replace(/(<div class="p-title-price">\s*)[\s\S]*?(<\/div>)/, (_match, opening) => opening + '<h5 class="mb-1">' + esc(product.name) + '</h5><p class="sale-price mb-0 lh-1">Rs. ' + Number(product.price).toLocaleString('en-US') + (product.old_price ? '<span>Rs. ' + Number(product.old_price).toLocaleString('en-US') + '</span>' : '') + '</p></div>');
  result = result.replace(/<div class="product-slides owl-carousel">[\s\S]*?<\/div>\s*<\/div>/, () => '<div class="product-slides owl-carousel"><div class="single-product-slide dynamic-product-slide"><img class="dynamic-product-image" src="' + esc(product.image) + '" alt="' + esc(product.name) + '"></div></div>');
  const start = result.indexOf('<!-- Product Specification-->'), end = result.indexOf('<!-- Related Products Slides', start);
  if (start >= 0 && end > start) result = result.slice(0, start) + '<div class="p-specification bg-white mb-3 py-3"><div class="container"><h6>Bundle details</h6><p class="bundle-description">' + esc(product.description) + '</p><p>See our <a href="/shipping-policy">shipping information</a> and <a href="/return-policy">returns policy</a>.</p></div></div>' + result.slice(end);
  return result;
}
module.exports = { renderBundle };

function renderPromotionList(html, rows) {
  const cards = rows.length ? rows.map(p => '<div class="col-6 col-md-4"><div class="card product-card catalog-product-card"><div class="card-body"><a class="product-thumbnail d-block" href="' + esc(p.url_path) + '"><img class="mb-2" src="' + esc(p.image) + '" alt="' + esc(p.name) + '"></a><a class="product-title" href="' + esc(p.url_path) + '">' + esc(p.name) + '</a><p class="sale-price">Rs. ' + Number(p.price).toLocaleString('en-US') + (p.old_price ? '<span>Rs. ' + Number(p.old_price).toLocaleString('en-US') + '</span>' : '') + '</p><button class="btn ' + (p.stock > 0 ? 'btn-success' : 'btn-secondary') + ' btn-sm product-cart-button" type="button" ' + (p.stock > 0 ? 'data-cart-id="' + p.product_id + '"' : 'disabled') + '>' + (p.stock > 0 ? 'Add to Cart' : 'Out of Stock') + '</button></div></div></div>').join('') : '<p class="col-12">No promotions are available right now. <a href="/products">Browse products</a>.</p>';
  return html.replace(/(<div class="row g-2" id="promotionsGrid">)[\s\S]*?(<\/div>)/, () => '<div class="row g-2" id="promotionsGrid">' + cards + '</div>');
}
module.exports.renderPromotionList = renderPromotionList;
