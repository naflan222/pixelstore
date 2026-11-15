# Product promotions and HERO13 bundle

## What goes live

- Standalone HERO13: Rs. 92,000 current price; Rs. 120,000 crossed-out price.
- GoPro HERO13 Bundle: Rs. 105,000. Includes camera, battery, USB-C cable,
  50-in-1 accessory kit, 10 ft selfie stick and waterproof case.
- Bundle image is an items-only edit of the owner's supplied second picture.
- Homepage Promotions link, `/promotions` page and one small dismissible popup.
- The bundle is a normal catalog product, searchable and available through its
  product page, cart, checkout, customer reviews and product-aware WhatsApp link.

The owner confirmed **20 bundles** as initial stock. The customer-facing site does
not display this count; the quantity is shown and editable in admin controls.
The bundle has its own stock; it does not silently deduct separately sold component
products. Subsequent restarts preserve later owner quantity changes.

## Manage promotions

Web admin: Marketing → Product promotions. Add Promotion selects an existing
product. Use Active to show/hide the promotion, and Popup to control its popup.
Display order chooses which popup offer is shown first. The page lists all active,
currently scheduled promotions whose products are active. Date fields are UTC.

For an included-items popup list, write `Included items:` followed by one item
per line and then a blank line in the product description.

Use Edit product to manage the name, price, crossed-out price, image, included-item
description and stock. Create new products through Products first, then promote
them. Removing an advertisement does not delete its product. To hide the product
from the entire shop, set its product status inactive in Products.

Android 1.2.0: Promotions → Add new/Edit provides the same active/popup controls
and a product-name picker. Edit product details opens the normal product editor.
Products and product-image management continue working as before.

The popup appears once per browsing session on shopping pages, never checkout,
cart, login or private account/admin pages. Close button, Escape and backdrop
click dismiss it. Popup failure cannot block shopping. Revisit in a fresh session
to see it again. Promotion listing changes refresh on load/focus and every 30
seconds while the promotions page is open; disabled open popups close on refresh.
The PWA-install alert is temporarily hidden only while this popup is open.

## Deployment and data safety

Merge/deploy the server before installing the APK. SQLite and PostgreSQL get a
new additive promotions table. No existing product/user/order table is dropped.
A one-time launch transaction locks store settings, corrects the standalone price,
adds the bundle and its promotion, and records an audit marker. Subsequent restarts
preserve owner price, stock, image and promotion edits. The automatic launch is
skipped in automated tests; promotion tests explicitly exercise it on disposable DBs.

The Firebase-enabled 1.2.0 APK has versionCode 3 and is signed with the same
certificate as the previously delivered 1.1.0 APK. Firebase configuration and the
private signing material are not committed. Notifications/authentication are unchanged.

The existing stylesheet and shopping layout are preserved. New CSS is scoped to
the requested popup/bundle description. Existing high-resolution image loading,
script compression and cache behavior are retained with updated script versions.

If rolling back, first disable the promotion and mark the new bundle inactive.
Do not drop the promotions table or delete order history. A code rollback does not
reverse catalog prices or other owner-controlled data automatically.

## Checks

Node suite plus dedicated SQLite/PostgreSQL promotion, schedule, public visibility,
owner-edit preservation and bundle checkout tests. Chromium tests cover mobile/
desktop light/dark popup dismissal, six included items, product/cart/WhatsApp,
web-admin switches, new future promotions and product editing. Android build,
unit tests, lint, Firebase flag and update-signature verification are also checked.
