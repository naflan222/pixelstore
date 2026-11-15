# Faster loading with enhanced product pictures retained

The previous image enhancement release could download original product images
before JavaScript added the enhanced responsive sources. This release supplies
those sources in the first HTML response and in dynamically built cards/galleries.
Fallbacks still support older cached image loaders and unknown owner uploads.

All 816 enhanced product assets, including 3840px versions, are unchanged. Card
images continue to select a display-appropriate resolution. The global stylesheet,
product content, stock, prices, reviews, URLs and checkout behavior are unchanged.
Small category icons and the footer logo gain lossless WebP thumbnail files at
appropriate display sizes. A decorative PNG is converted losslessly at its native
size. None of the source images are overwritten.

The two public storefront scripts use cached gzip representations with ETags and
Accept-Encoding negotiation. Private/API responses are not compressed by this
handler. Source-hashed enhanced picture paths have long-lived immutable HTTP
caching; script and service-worker versions are refreshed. No dependencies or
schema migrations are introduced.

## Measurement

Same local cold-browser fixture, 390px viewport at 3x density, no service worker,
22 seeded products, external requests blocked, 1.8-second settling period after
page load. These are downloaded image bytes, not Lighthouse scores or a measured
production speed improvement; live content/devices/networks will vary.

| Page | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Homepage | 2460 KiB | 1163 KiB | 53% |
| Products | 1615 KiB | 522 KiB | 68% |
| HERO13 details | 1048 KiB | 566 KiB | 46% |

At the time of verification the image loader shrank from approximately 154KB raw
to 11KB gzip and the storefront client from approximately 98KB to 25KB gzip.
The original enhancement processing and source-hash audits remain unchanged.

Validation includes the full Node suite; source coverage/hash checks; responsive
HTML, gzip/identity and ETag tests; mobile 3x/desktop 2x image/geometry regressions;
and light/dark cart/product-card checks. Only disposable local data is used.

Deploy after merging. A normal reload receives the versioned scripts; no product
re-import is required. Rollback is a normal code/assets revert with no database work.
