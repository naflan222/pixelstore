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
  return next();
}
module.exports = { FILE_PATHS, ROUTE_FILES, cleanStorefrontHref, cleanStorefrontRedirect };
