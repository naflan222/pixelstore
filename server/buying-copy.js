'use strict';
const copy = require('./product-buying-copy.json');
function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
// Match catalog identity, never a generic template belonging to another item.
function applyBuyingCopy(html, filename, product) {
  const key = product ? String(product.slug || '') : filename.replace(/\.html$/, '');
  const text = copy[key] || (product && product.url_slug === 'adjustable-chest-strap-camera-mount' ? copy['adjustable-chest-strap-camera-mount'] : null);
  if (!text) return html;
  const marker = '<!-- Product Specification-->';
  const start = html.indexOf(marker), end = html.indexOf('<!-- Product Video', start);
  if (start < 0 || end < 0) return html;
  const policies = html.slice(start, end).match(/<ul class="mb-3 ps-3">[\s\S]*?<\/ul>/)?.[0] || '';
  const liveDescription = product ? '<p data-catalog-description>' + escapeHtml(product.description) + '</p>' : '';
  return html.slice(0, start) + marker + '<div class="p-specification bg-white mb-3 py-3"><div class="container">' + liveDescription + '<div data-buying-copy="' + escapeHtml(key) + '">' + text + '</div>' + policies + '<p class="mb-0">Read our <a href="/shipping-policy">shipping information</a> and <a href="/return-policy">returns policy</a>.</p></div></div>\n' + html.slice(end);
}
module.exports = { applyBuyingCopy };
