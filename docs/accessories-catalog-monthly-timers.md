# Approved accessory catalog and product-page countdowns

## Owner review and publishing

1. Merge/deploy this update. No products are inserted at startup and no existing
   prices, quantities, reviews or homepage selections are changed by deployment.
2. Sign in with the owner account at `https://pixelhouse.lk/admin/`.
3. Open `https://pixelhouse.lk/admin/accessories-preview.html`. Review all 22
   generated illustrations, the owner-supplied prices, model compatibility and
   the reference links. Check the approval box and click **Add 22 out-of-stock
   products** only when the images are acceptable.
4. The products then appear in normal search, category pages, product detail
   pages and the existing Android admin app. All start at stock **0**. Increase
   quantities when importing stock; update model-specific details to match the
   actual supplied version. A new APK is not needed.

The batch excludes items **19 and 24**. It has no manufacturer brands, old prices,
invented discounts, sale countdowns or fake reviews. GoPro/DJI names describe
compatibility only. Model-specific products follow their individual reference
listings, including Hero 9–12 for the aluminum GoPro cage and Action 6 for the DJI
silicone case. The existing Telesin battery listing is left untouched.

Images are generated from the reference shapes, with cameras/people/vehicles and
branding removed. They are illustrations pending actual stock, not photographs
of the owner's inventory. Review them before publishing. Optimized WebP files
are exactly **300×300** for cards and **1024×1024** for product zoom. The approved
prices and previews are also listed in `catalog/README.md`.

## Data safety and interfaces

The owner-only API `/api/admin/catalog-batches/accessories-20261109` returns the
manifest and current status. `POST .../apply` and `POST .../rollback` require
`{"confirm":true}`. Existing authentication/role guards apply; customer and
non-owner sessions cannot import this batch.

Applying locks the store-settings singleton and inserts all 22 products plus
large product-gallery images in one transaction. Existing active categories are
reused; an absent standard category is created, but an intentionally disabled or
conflicting category is not overwritten. Any product SKU/URL collision stops the
whole batch. Audit logs record only the IDs/SKUs created by this batch. Repeating
a successful import returns its original result without resetting later admin
edits, quantities or prices. A failed readback does not cause automatic retries.

Rollback is the secondary **Hide only products added by this batch** action. It
soft-deactivates only recorded product IDs that still have their original batch
SKUs. It retains products, edits, quantities, reviews and order history. It does
not delete existing catalog data or reactivate products on the next deployment.
An already rolled-back batch cannot be automatically reapplied; manage those
records through the existing admin tools. Empty standard categories may remain.

The public product-detail response optionally includes `zoom_image` when a
matching large gallery asset exists. List/card responses continue to use the
small image. Existing products and the native app remain compatible.

## Timer behavior

Expired fixed October dates in legacy HTML now use the same repeating calendar-
month anchor as the homepage (`2026-11-08T00:00:00Z`). Product timers and Related
Products timers load the existing singleton monthly-cycle script, render on page
load and advance automatically at expiry. The old jQuery countdown no longer
binds to these elements. Card containers, colors and layout are unchanged.
Normal new accessories have `flash_sale=0`, so their dynamic detail page hides the
static template's sale panel rather than advertising an invented offer.

## Verification

The Node suite checks exact image dimensions, approved prices/exclusions, owner
access, duplicate/collision guards, transactional failure rollback, catalog and
category visibility, zero-stock purchase blocking, later-edit preservation and
safe rollback on SQLite, pg-mem and disposable real PostgreSQL. pg-mem cannot
prove transactions, so that check skips there and runs on the two real engines.

Optional mobile Chromium test:
`PLAYWRIGHT_PATH=/path/to/playwright node scripts/test-accessories-browser.js`.
It uses a disposable local database and fixture owner: review/approve, homepage
search suggestions, full product detail/price/large image, disabled purchase,
category/all-products visibility, and product/related countdown renewal across
an exact monthly boundary. No live order, payment or inventory write is used.
