'use strict';

const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://pixelhouse.lk';
const DEFAULT_IMAGE = `${SITE_URL}/img/icons/icon-512x512.png`;

const PAGE_META = {
  'home.html': {
    title: 'Pixel House Sri Lanka | GoPro, DJI & Insta360 Gear',
    description: 'Shop GoPro, DJI Osmo and Insta360 cameras, mounts, batteries, cases and action-camera accessories from Pixel House in Sri Lanka.',
    heading: 'Action Cameras and Accessories in Sri Lanka',
  },
  'products.html': {
    title: 'Camera & Action Camera Accessories | Pixel House',
    description: 'Browse action cameras, mounts, batteries, protective cases, selfie sticks and camera accessories available from Pixel House Sri Lanka.',
    heading: 'All Camera and Action Camera Products',
  },
  'featured-products.html': {
    title: 'Featured Camera Accessories | Pixel House Sri Lanka',
    description: 'Explore featured GoPro, DJI Osmo and Insta360 cameras and accessories selected by Pixel House Sri Lanka.',
    heading: 'Featured Camera Accessories',
  },
  'flash-sale.html': {
    title: 'Popular Camera Accessories | Pixel House Sri Lanka',
    description: 'Browse popular action-camera accessories and current product prices at Pixel House Sri Lanka.',
    heading: 'Popular Camera Accessories',
  },
  'catagory.html': {
    title: 'GoPro Accessories in Sri Lanka | Pixel House',
    description: 'Shop GoPro mounts, cases, batteries, chargers, selfie sticks and underwater accessories from Pixel House Sri Lanka.',
    heading: 'GoPro Accessories',
  },
  'gpproducts2.html': {
    title: 'More GoPro Accessories | Pixel House Sri Lanka',
    description: 'Discover more GoPro accessories, mounts and protective equipment available from Pixel House Sri Lanka.',
    heading: 'More GoPro Accessories',
  },
  'actioncamera.html': {
    title: 'Action Cameras in Sri Lanka | Pixel House',
    description: 'Browse GoPro and other action cameras available from Pixel House with delivery and support in Sri Lanka.',
    heading: 'Action Cameras in Sri Lanka',
  },
  'insta360-camera.html': {
    title: 'Insta360 Cameras in Sri Lanka | Pixel House',
    description: 'Explore Insta360 cameras and compatible gear available from Pixel House Sri Lanka.',
    heading: 'Insta360 Cameras',
  },
  'dji-osmo-camera.html': {
    title: 'DJI Osmo Cameras in Sri Lanka | Pixel House',
    description: 'Browse DJI Osmo action cameras and compatible accessories available from Pixel House Sri Lanka.',
    heading: 'DJI Osmo Cameras',
  },
  '360accesories.html': {
    title: 'Insta360 Accessories in Sri Lanka | Pixel House',
    description: 'Shop protective cases, mounts and accessories for Insta360 cameras from Pixel House Sri Lanka.',
    heading: 'Insta360 Accessories',
  },
  'osmocat.html': {
    title: 'DJI Osmo Accessories in Sri Lanka | Pixel House',
    description: 'Shop cases, caps, mounts and accessories for DJI Osmo cameras from Pixel House Sri Lanka.',
    heading: 'DJI Osmo Accessories',
  },
  'rental-services.html': {
    title: 'GoPro Camera Rental in Dikwella | Pixel House',
    description: 'Rent GoPro Hero 9, 10, 11, 12 or 13 cameras from Pixel House in Dikwella. Daily rentals include essential equipment.',
    heading: 'GoPro Camera Rental in Dikwella',
  },
  'camera-trade.html': {
    title: 'Camera Trade Services | Pixel House Sri Lanka',
    description: 'Contact Pixel House about camera and action-camera trade services in Sri Lanka.',
    heading: 'Camera Trade Services',
  },
  'about-us.html': {
    title: 'About Pixel House | Camera Store in Dikwella',
    description: 'Learn about Pixel House, a Dikwella camera store offering action cameras, accessories, rentals and customer support across Sri Lanka.',
    heading: 'About Pixel House',
  },
  'contact.html': {
    title: 'Contact Pixel House Dikwella | WhatsApp Support',
    description: 'Contact Pixel House in Dikwella for product compatibility, camera orders, rentals, returns and warranty support.',
    heading: 'Contact Pixel House',
  },
  'support.html': {
    title: 'Pixel House Customer Support | Orders & Rentals',
    description: 'Get help with Pixel House product orders, camera rentals, returns, damaged items and account questions.',
    heading: 'Pixel House Customer Support',
  },
  'privacy-policy.html': {
    title: 'Privacy Policy | Pixel House Sri Lanka',
    description: 'Read how Pixel House collects, uses and protects customer information when you use pixelhouse.lk.',
    heading: 'Pixel House Privacy Policy',
  },
  'terms.html': {
    title: 'Terms & Conditions | Pixel House Sri Lanka',
    description: 'Read the terms that apply when using pixelhouse.lk or purchasing products and services from Pixel House.',
    heading: 'Pixel House Terms and Conditions',
  },
  'return-policy.html': {
    title: 'Return & Refund Policy | Pixel House Sri Lanka',
    description: 'Read the Pixel House return, replacement, cancellation and refund policy for purchases made through pixelhouse.lk.',
    heading: 'Pixel House Return and Refund Policy',
  },
};

const PRODUCT_PAGES = [
  '12in1kit.html', '19kit.html', '27mstick.html', '3mstick.html',
  '3slotcharger.html', '3waystick.html', 'antifog.html', 'btrychrger13.html',
  'cover.html', 'domeport.html', 'fhstick.html', 'gbattery.html', 'goggles.html',
  'gptemp.html', 'helmetstrap.html', 'hero13.html', 'lensfilter.html',
  'osmobag.html', 'osmocap.html', 'wpdcase.html', 'x4case1.html',
];

const INDEXABLE_PAGES = [
  'home.html', 'products.html', 'featured-products.html', 'flash-sale.html',
  'catagory.html', 'gpproducts2.html', 'actioncamera.html', 'insta360-camera.html',
  'dji-osmo-camera.html', '360accesories.html', 'osmocat.html',
  'rental-services.html', 'camera-trade.html', 'about-us.html', 'contact.html',
  'support.html', 'privacy-policy.html', 'terms.html', 'return-policy.html',
  ...PRODUCT_PAGES,
];

const INDEXABLE_SET = new Set(INDEXABLE_PAGES);

const IMAGE_ALT = {
  'img/core-img/logo-small.png': 'Pixel House',
  'img/core-img/camera-trade.png': 'Camera gear and accessories',
  'img/core-img/rental-services.png': 'GoPro camera rental services',
  'img/product/1.png': '50 in 1 GoPro accessories kit',
  'img/product/2.png': '3 metre action-camera selfie stick',
  'img/product/3.png': 'Action-camera dome port',
  'img/product/4(2).png': 'Three-slot action-camera battery charger',
  'img/product/5(2).png': 'Three-way action-camera selfie stick',
  'img/product/11.png': 'GoPro helmet chin strap mount',
  'img/product/5.png': '2.7 metre GoPro selfie stick',
  'img/product/6.png': 'Adjustable three-way GoPro selfie stick',
  'img/product/9.png': 'Floating handle for GoPro cameras',
  'img/product/8.png': 'Waterproof diving case for GoPro cameras',
  'img/product/4.png': 'Underwater lens filter for GoPro cameras',
  'img/product/18.png': '50 in 1 action-camera accessories kit',
  'img/product/7.png': 'Three metre carbon-fibre selfie stick',
  'img/product/12.png': 'Tempered-glass protector for GoPro cameras',
  'img/product/17.png': 'GoPro helmet chin mount',
  'img/product/14.png': '19 in 1 GoPro accessories kit',
  'img/product/15.png': 'Silicone protective case for action cameras',
  'img/product/16.png': '12 in 1 GoPro accessories kit',
  'img/product/21.png': 'Action-camera goggles with mount',
  'img/product/20.png': 'Telesin replacement battery for GoPro cameras',
  'img/product/19.png': 'Protective case for Insta360 X4',
};

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textOnly(value) {
  return String(value || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(value) {
  if (!value) return DEFAULT_IMAGE;
  if (/^https?:\/\//i.test(value)) return value;
  return `${SITE_URL}/${String(value).replace(/^\//, '')}`;
}

function extractProduct(html) {
  const blockMatch = html.match(/<div\s+class=["'][^"']*p-title-price[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
  if (!blockMatch) return null;

  const nameMatch = blockMatch[1].match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const priceMatch = blockMatch[1].match(/class=["'][^"']*sale-price[^"']*["'][^>]*>\s*Rs\.?\s*([\d,]+)/i);
  if (!nameMatch || !priceMatch) return null;

  const imageMatch = html.match(/single-product-slide[^>]*background-image:\s*url\(["']?([^"')]+)["']?\)/i);
  return {
    name: textOnly(nameMatch[1]),
    price: priceMatch[1].replace(/,/g, ''),
    image: absoluteUrl(imageMatch && imageMatch[1]),
  };
}

function canonicalFor(filename) {
  return filename === 'home.html' ? `${SITE_URL}/` : `${SITE_URL}/${filename}`;
}

function metaFor(filename, html) {
  if (PAGE_META[filename]) return { ...PAGE_META[filename] };

  const product = extractProduct(html);
  if (product) {
    return {
      title: `${product.name} in Sri Lanka | Pixel House`,
      description: `Buy ${product.name} from Pixel House Sri Lanka. View the current price, product details and compatible camera accessories.`,
      heading: product.name,
      product,
    };
  }

  const existingTitle = textOnly((html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  return {
    title: existingTitle && existingTitle !== 'PixelHouse' ? existingTitle : 'Pixel House Sri Lanka',
    description: 'Explore cameras, action cameras, accessories and rental services from Pixel House Sri Lanka.',
    heading: existingTitle || 'Pixel House Sri Lanka',
  };
}

function buildSchema(meta, canonical, filename) {
  const graph = [
    {
      '@type': 'ElectronicsStore',
      '@id': `${SITE_URL}/#store`,
      name: 'Pixel House',
      url: `${SITE_URL}/`,
      logo: DEFAULT_IMAGE,
      image: DEFAULT_IMAGE,
      telephone: '+94 77 746 6675',
      priceRange: 'LKR',
      address: {
        '@type': 'PostalAddress',
        addressLocality: 'Dikwella',
        addressRegion: 'Southern Province',
        addressCountry: 'LK',
      },
      areaServed: {
        '@type': 'Country',
        name: 'Sri Lanka',
      },
    },
    {
      '@type': 'WebSite',
      '@id': `${SITE_URL}/#website`,
      url: `${SITE_URL}/`,
      name: 'Pixel House',
      publisher: { '@id': `${SITE_URL}/#store` },
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/products.html?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  if (meta.product) {
    graph.push({
      '@type': 'Product',
      '@id': `${canonical}#product`,
      name: meta.product.name,
      image: [meta.product.image],
      description: meta.description,
      url: canonical,
      sku: path.basename(filename, '.html').toUpperCase(),
      offers: {
        '@type': 'Offer',
        url: canonical,
        priceCurrency: 'LKR',
        price: meta.product.price,
        itemCondition: 'https://schema.org/NewCondition',
      },
    });
  }

  return JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })
    .replace(/</g, '\\u003c');
}

function improveImages(html) {
  let seen = 0;
  return html.replace(/<img\b([^>]*)>/gi, (tag, attrs) => {
    seen += 1;
    const srcMatch = attrs.match(/\bsrc=["']([^"']+)["']/i);
    const src = srcMatch && srcMatch[1];
    let updated = tag;

    if (src && IMAGE_ALT[src] && /\balt=["']\s*["']/i.test(updated)) {
      updated = updated.replace(/\balt=["']\s*["']/i, `alt="${escapeHtml(IMAGE_ALT[src])}"`);
    }

    const isPriorityImage = seen <= 3 || (src && /logo-small|icon-\d+x\d+/.test(src));
    if (!isPriorityImage && !/\bloading=/i.test(updated)) {
      updated = updated.replace(/>$/, ' loading="lazy">');
    }
    if (!isPriorityImage && !/\bdecoding=/i.test(updated)) {
      updated = updated.replace(/>$/, ' decoding="async">');
    }
    return updated;
  });
}

function enhanceHtml(html, filename) {
  const meta = metaFor(filename, html);
  const canonical = canonicalFor(filename);
  const isIndexable = INDEXABLE_SET.has(filename);
  const image = meta.product ? meta.product.image : DEFAULT_IMAGE;
  const robots = isIndexable
    ? 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1'
    : 'noindex,nofollow';

  let output = html
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(meta.title)}</title>`)
    .replace(/<meta\b[^>]*\bname=["']description["'][^>]*>\s*/gi, '')
    .replace(/<link\b[^>]*\brel=["']canonical["'][^>]*>\s*/gi, '')
    .replace(/<meta\b[^>]*(?:property|name)=["'](?:og:[^"']+|twitter:[^"']+|robots)["'][^>]*>\s*/gi, '')
    .replace(/<script\b[^>]*data-seo-managed=["']true["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');

  const seoTags = [
    `    <meta name="description" content="${escapeHtml(meta.description)}">`,
    `    <meta name="robots" content="${robots}">`,
    `    <link rel="canonical" href="${canonical}">`,
    `    <meta property="og:type" content="${meta.product ? 'product' : 'website'}">`,
    `    <meta property="og:site_name" content="Pixel House">`,
    `    <meta property="og:title" content="${escapeHtml(meta.title)}">`,
    `    <meta property="og:description" content="${escapeHtml(meta.description)}">`,
    `    <meta property="og:url" content="${canonical}">`,
    `    <meta property="og:image" content="${image}">`,
    '    <meta name="twitter:card" content="summary_large_image">',
    `    <meta name="twitter:title" content="${escapeHtml(meta.title)}">`,
    `    <meta name="twitter:description" content="${escapeHtml(meta.description)}">`,
    `    <meta name="twitter:image" content="${image}">`,
    `    <script type="application/ld+json" data-seo-managed="true">${buildSchema(meta, canonical, filename)}</script>`,
  ].join('\n');

  output = output.replace(/<\/head>/i, `${seoTags}\n  </head>`);

  if (!/<h1\b/i.test(output)) {
    output = output.replace(
      /<body([^>]*)>/i,
      `<body$1>\n    <h1 class="visually-hidden">${escapeHtml(meta.heading)}</h1>`
    );
  }

  return improveImages(output);
}

function createHtmlHandler({ rootDir }) {
  return function serveSeoHtml(req, res, next) {
    const filename = req.path === '/' ? 'home.html' : path.basename(req.path);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.html$/.test(filename)) return next();

    const filePath = path.join(rootDir, filename);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return next();

    try {
      const html = fs.readFileSync(filePath, 'utf8');
      res.set('Cache-Control', 'public, max-age=0, must-revalidate');
      res.type('html').send(enhanceHtml(html, filename));
    } catch (error) {
      next(error);
    }
  };
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function createSitemapHandler({ rootDir }) {
  return function serveSitemap(req, res) {
    const urls = INDEXABLE_PAGES
      .filter((filename) => fs.existsSync(path.join(rootDir, filename)))
      .map((filename) => {
        const stat = fs.statSync(path.join(rootDir, filename));
        const lastmod = stat.mtime.toISOString().slice(0, 10);
        return `  <url>\n    <loc>${xmlEscape(canonicalFor(filename))}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
      });

    res.type('application/xml').send(
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      `${urls.join('\n')}\n` +
      `</urlset>\n`
    );
  };
}

module.exports = {
  INDEXABLE_PAGES,
  enhanceHtml,
  extractProduct,
  createHtmlHandler,
  createSitemapHandler,
};
