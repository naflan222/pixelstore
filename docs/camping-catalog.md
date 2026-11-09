# Generic camping accessories: 13 approved products

## Review and publish

1. Merge/deploy this update. Deployment does not insert products or change existing
   prices, quantities, reviews or homepage product selections.
2. Sign in with the owner account at `https://pixelhouse.lk/admin/` and open
   `https://pixelhouse.lk/admin/camping-preview.html`.
3. Review all 13 generated illustrations, supplied prices and product descriptions.
   Check the approval box, then choose **Add 13 out-of-stock camping products**.
4. The products appear in the Camping Accessories category, website search,
   product details and the existing Android admin app. Stock is **0** initially;
   update quantities and actual specifications when inventory arrives. No new APK
   is required. The normal homepage product selectors remain under owner control.

Only approved items **1–12 and 17** are included. Manufacturer brands are blank,
with no Naturehike or other brand names/logos in customer names, descriptions or
illustrations. Prices come exclusively from the owner. No old prices, discounts,
ratings, sale timers or unverified temperature, weather, load, battery-capacity
or other performance ratings are invented.

Reference images guide the generic product type; generated illustrations are not
photographs of the owner's inventory. Review them before publishing. The stove
illustration excludes fuel, and the trekking-pole reference shows one folding pole,
not a confirmed pair. Confirm actual package contents before adding stock.

Card assets are exactly **300×300** WebP, with **1024×1024** versions for zoom.
`catalog/camping-20261109.md` lists the images and approved prices for PR review.

## Integration and data safety

The existing accessory importer is extracted into a shared catalog-batch helper.
Camera accessories retain their endpoint, identifiers, manifest and behavior.
Camping uses a separate `camping-20261109` batch and `PH-CAMP-20261109-xx` SKUs.
Both batches use the same owner-only preview/apply/rollback controls. There are no
startup catalog writes and no schema migration or new environment variables.

`GET /api/admin/catalog-batches/camping-20261109` returns the manifest and status.
`POST .../apply` and `POST .../rollback` require `{"confirm":true}` and owner access.
Applying creates normal active product records at zero stock and reuses or creates
the Camping Accessories category. A disabled/conflicting category or a product
SKU/URL collision rejects the whole transaction. A successful repeat does not
reset edits or recreate deleted products.

Audit logs keep the created IDs/SKUs separately for this batch. Rollback uses
**Hide only products added by this batch**, soft-deactivating only recorded IDs
whose SKUs still match; prices, quantities, order history and reviews are retained.
The existing camera catalog and its batch state are unchanged. Rolled-back records
must be managed individually instead of automatically reimported.

Camping navigation uses the existing category-card markup and the existing
`products.html?category=Camping%20Accessories` catalog filter. Other category links,
store styling, checkout and homepage selections are unchanged. Before publication,
the category link can show the existing empty-catalog state.

## Verification

The API suites run the same camera and camping scenarios on SQLite, pg-mem and
disposable real PostgreSQL: approved prices/items, owner-only import, no writes
from preview/deployment, collision guards, mid-batch rollback, search/category/admin
visibility, zero-stock purchase rejection, later-edit preservation, and isolated
rollback. Transaction checks skip on pg-mem and run on both real engines.

Image tests verify exact dimensions and the navigation/category links. The optional
mobile Chromium flow is `PLAYWRIGHT_PATH=/path/to/playwright node
scripts/test-camping-browser.js`: owner review/approval, 13 camping products,
category navigation/filter/pagination, homepage search suggestions, price, large
product image, out-of-stock controls and the normal admin listing. All writes are
on disposable local databases; no live customer data, payment or inventory is used.
