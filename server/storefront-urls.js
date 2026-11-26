'use strict';
const { FILE_PATHS, ROUTE_FILES, cleanHref } = require('../js/storefront-routes');
const cleanStorefrontHref = value => cleanHref(value);
function cleanStorefrontRedirect(req, res, next) {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const original = req.originalUrl || req.url;
  if (FILE_PATHS[req.path.slice(1)]) return res.redirect(301, cleanHref(original));
  if (req.path.endsWith('/') && req.path !== '/' && ROUTE_FILES[req.path.slice(0, -1)]) {
    return res.redirect(301, req.path.slice(0, -1) + original.slice(req.path.length));
  }
  if (/^\/product\/[a-z0-9-]+\/$/.test(req.path)) return res.redirect(301, req.path.slice(0, -1) + original.slice(req.path.length));
  // A product URL with a legacy .html suffix (/product/dome-port.html) has
  // no route and 404s. It is the same product as the clean URL, so redirect
  // it in one hop instead of serving a 404.
  const productHtml = req.path.match(/^\/product\/([a-z0-9][a-z0-9-]*)\.html$/);
  if (productHtml) return res.redirect(301, '/product/' + productHtml[1] + original.slice(req.path.length));
  return next();
}
module.exports = { FILE_PATHS, ROUTE_FILES, cleanStorefrontHref, cleanStorefrontRedirect };
