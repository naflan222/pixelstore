'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
// Only these public storefront scripts are compressed; APIs/private responses are not.
function publicScriptCache(rootDir) {
  const scripts = new Map();
  return (req, res, next) => {
    res.vary('Accept-Encoding');
    if (!req.get('Accept-Encoding') || req.acceptsEncodings('gzip', 'identity') !== 'gzip') return next();
    const name = path.basename(req.path);
    if (!['product-images.js', 'api-client.js'].includes(name)) return next();
    let asset = scripts.get(name);
    if (!asset) {
      const bytes = gzipSync(fs.readFileSync(path.join(rootDir, 'js', name)), { level: 9 });
      asset = { bytes, etag: '"' + createHash('sha256').update(bytes).digest('hex') + '"' };
      scripts.set(name, asset);
    }
    res.set({ 'Content-Type': 'application/javascript; charset=utf-8', 'Content-Encoding': 'gzip',
      'Cache-Control': 'public, max-age=0, must-revalidate', ETag: asset.etag });
    const matches = (req.get('If-None-Match') || '').split(',').some(tag => tag.trim() === '*' || tag.trim().replace(/^W\//, '') === asset.etag);
    if (matches) return res.status(304).end();
    return res.send(asset.bytes);
  };
}
module.exports = { publicScriptCache };
