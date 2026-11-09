# Product description cleanup and image clarity

## What deployment changes

The next server startup removes only the approved boilerplate from the known
35 accessory/camping SKUs. This includes the generic accessory / reference-based
illustration sentence and the stock-arrival confirmation sentences. The importer
manifests are cleaned too, so future imports use the same concise descriptions.
Product facts, compatibility information and relevant usage instructions remain.
No statement claiming that an illustration is an actual inventory photograph is
added. Owner review/reference documentation remains available privately/in the repo.

Existing descriptions are updated with a compare-and-swap check; a concurrent
owner edit is never overwritten. Records outside the known SKU allowlist are
untouched. Prices, stock, names, URLs, images, reviews and batch states are not
updated by the cleanup. It is transactional and idempotent, logs only an updated
count, and a cleanup failure does not prevent the storefront from starting.
No re-import, new APK or additional owner action is required.

## Same pictures, higher-resolution loading

The 57 current primary catalog images keep their original stored paths. There
are 300/600/1024-width sources for the browser to choose according to display size
and pixel density. The 35 newer products use their existing 1024px master images.
The 22 older product photos are deterministically upscaled from the exact existing
pictures using Lanczos resampling. No product is redrawn, no new detail is invented,
and source pictures are not overwritten. Upscaling creates larger files but cannot
recover fine detail that was absent from an original 300px picture. Existing legacy
gallery backgrounds are already 1920px wide and are retained.

The storefront loader adds `srcset` and measured `sizes` to matching product images,
including static related cards, dynamically rendered grids, homepage sections and
search suggestions. It preserves CSS, card sizes, image positioning and layout.
Unknown/custom owner uploads are not replaced. The observer listens only for new
nodes and image `src` changes; it does not watch carousel layout/style animation.
Public product list/detail/homepage JSON gains optional `image_sources`; detail
responses can use the largest matching image as `zoom_image`. Existing `image`
values remain intact for older clients. Static scripts and the service worker are
versioned so refreshed pages receive the new loader.

The exact original-to-variant mapping is `catalog/product-image-variants.json`.
Regenerate assets and the client map with `node scripts/build-product-image-variants.js`
(requires ImageMagick). No image-generation model is used for these resizes.

## Verification and rollout

- Node suites cover approved phrase removal, owner formatting, SKU restrictions,
  compare-and-swap behavior, idempotence, preservation of product data and image
  source coverage on SQLite, pg-mem and disposable real PostgreSQL.
- The optional Chromium test `PLAYWRIGHT_PATH=/path/to/playwright node
  scripts/test-product-presentation-browser.js` checks a 3x mobile display, actual
  high-resolution image selection, cleaned copy, large detail images, search,
  out-of-stock behavior and unchanged image/card geometry.
- Existing checkout, API, review, admin, camping and accessory suites also run.

Merge/deploy the PR, then reload the product pages. The description cleanup runs
on the live database on startup; automated tests do not use live records. Rollback
can restore the previous code/assets because original pictures and schemas are
unchanged. Removed boilerplate is not automatically restored on a code rollback.
