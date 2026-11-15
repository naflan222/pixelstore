'use strict';
const images = { ...require('../catalog/product-image-enhancements.json').images, ...require('../catalog/loading-image-sources.json') };
const aliases = new Map();
for (const list of Object.values(images)) for (const image of list) aliases.set(image.src, list);
const CARD_SIZES = '(max-width: 767px) 45vw, (max-width: 1199px) 30vw, 360px';
function responsiveImage(source, sizes = CARD_SIZES) {
  const list = images[source] || aliases.get(source);
  if (!list) return null;
  if (source.includes('core-img/') && !source.includes('footer-logo')) sizes = '48px';
  if (source.includes('footer-logo')) sizes = '150px';
  return { src: list[0].src, srcset: list.map(image => image.src + ' ' + image.width + 'w').join(', '), sizes };
}
module.exports = { responsiveImage, CARD_SIZES };
