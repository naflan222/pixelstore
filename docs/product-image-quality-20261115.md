# Product-picture enhancement only

Existing originals, product text, prices, stock, URLs and CSS remain unchanged.
The responsive picture loader selects new image files; no catalog migration runs.
The older SEO guides branch is excluded from this branch.

`scripts/enhance-product-images.py` requires Pillow 12.3.0. It inventories the 57
known primary pictures, their existing source/zoom aliases and product pictures
referenced by storefront templates, including detail galleries and rental photos.
Newer pictures use their existing 1024px masters. Older 300px pictures are enlarged
from their exact originals rather than repeatedly enlarging prior resizes.

Conservative unsharp masking and Lanczos resampling create 300, 600, 1024, 1536,
2048 and 3840-width WebP files at quality 95. Aspect ratio, framing, lettering and
product identity are preserved. There is no AI reconstruction or invented detail.
Upscaling cannot recover detail absent from an original. These are enhanced 4K-width
copies, not newly photographed native-4K originals.

`catalog/product-image-enhancements.json` records original SHA-256 hashes,
dimensions, variant paths and alias coverage. Original files are never overwritten.
Custom future owner uploads remain untouched. Image selection follows display width
and pixel density, so small cards need not download the largest image. Background
slide selection is responsive too; the existing cover/contain styles do not change.

The image loader URL and service-worker cache version are refreshed. No metadata,
content, structured data, checkout, inventory, admin or database changes are included.
Rollback is a code/assets revert; no database restoration is needed.

Validation: source-hash/coverage tests; actual dimensions and aspect-ratio checks;
mobile/desktop browser image selection and card-geometry comparison with the new
loader disabled; API/cart/product regression tests; before/after picture previews.
