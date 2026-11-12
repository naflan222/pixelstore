# PixelHouse clean storefront URLs

The visible addresses are independent of the existing templates and product identifiers. The shared route registry covers every root HTML page and the admin HTML entry/preview aliases. The admin panel stays at `/admin/`; API and mobile APK endpoints keep their existing addresses.

| Previous address | Visible destination |
| --- | --- |
| `/home.html`, `/index.html` | `/` |
| `/catagory.html` | `/gopro-accessories` |
| `/gpproducts2.html` | `/gopro-accessories?page=2` |
| `/osmocat.html` | `/osmo-accessories` |
| `/360accesories.html` | `/insta360-accessories` |
| `/products.html` | `/products` |
| `/fhstick.html` | `/product/floating-handle-stick-gopro` |
| `/single-product.html?product=backpack-strap-camera-clip` | `/product/backpack-strap-camera-clip` |
| `/cart.html`, `/checkout.html`, `/profile.html` | `/cart`, `/checkout`, `/profile` |

Other working non-product pages use their existing basename without `.html`. Previously retired demo pages keep redirecting to the appropriate live page. Old addresses return HTTP301 directly to the clean destination; explicit page numbers override the old page-two filename default. Query values and fragment navigation are preserved. Clean-route trailing slashes redirect to the canonical spelling, except `/admin/`.

## Product identity and compatibility

An additive, nullable `products.url_slug` column and unique index support a stable readable address. Startup backfills missing values in ID order. New products created individually, through CSV, or through approved catalog batches receive a URL during their existing creation transaction. Duplicate names receive an ID suffix; existing names that already include that suffix cannot overwrite another product URL. Existing URLs are retained when product names change.

The existing product `slug`, IDs, SKU, price, stock, orders, reviews and sessions are preserved. Public product responses add `url_path`; cart and recent-review responses also provide their product link paths. Existing API identifiers and authentication/checkout response fields remain compatible with the Android app.

Templates keep their internal page identities. Root asset resolution and link normalization allow nested product URLs to load the same images and scripts. Existing link selectors retain their original identities while the browser receives clean destinations. The design stylesheet is byte-for-byte unchanged. Account/checkout HTML remains private and uncacheable. Canonicals and the sitemap advertise the clean public URLs; account/admin pages remain excluded from indexing.

SQLite-to-PostgreSQL migration and verification preserve the new URL column. Backups made before this column existed remain readable and receive URL backfill when the server starts.

## Validation

- Full Node suite: 193 passed, 4 skipped, zero failures, including both database engines, migration round-trip, checkout and invoice coverage.
- Route tests check every registered old HTML address, clean destinations, HEAD redirects, pagination/filter preservation, stable names, duplicate names, private caching, inactive/missing products and sitemap uniqueness.
- Browser browsing checks: 390/980/1440px, light/dark; category pagination and filters, root and nested links, high-resolution product imagery, unchanged stylesheet, no overflow, missing assets or JavaScript errors.
- Real browser customer flow: guest cart, registration, login/cart merge, checkout, purchase confirmation, invoice PDF, profile, logout and password reset. The order page keeps its existing template and its order API retains the new order.
- Owner admin access and clean preview aliases work. A service worker registered from a nested product page still controls the root scope, and navigation falls back to the cached offline page when disconnected.

Run `npm test`. With Playwright and Chromium installed, run `node scripts/test-clean-route-browser.js`; `PLAYWRIGHT_PATH` can identify an existing Playwright module. `CLEAN_ROUTE_FLOW_ONLY=1` runs the account/checkout/PWA portion separately. All fixtures use disposable local data.

[Mobile product preview](previews/clean-routes/product-mobile.png) · [Desktop GoPro preview](previews/clean-routes/gopro-desktop.png)

## Deployment

Deploy the server and frontend together with the existing persistent database. Startup applies the additive URL migration automatically; no catalog re-import, manual URL edits or APK update is needed. Keep the deployment's normal database backup. Reload the site after deployment; the service-worker version and shared script URLs refresh the cached frontend.

Verify an old GoPro URL redirects to `/gopro-accessories?page=2`, a product opens at `/product/...`, and a checkout/account page loads. The sitemap stays at `/sitemap.xml`, so the existing Search Console property and sitemap submission remain usable. Search results and browser history suggestions may take time to adopt the new addresses.

If rolling back a UI or unrelated application change, retain the clean-route compatibility adapter and URL column so browsers with cached permanent redirects can still open their destinations. Do not drop or regenerate the stored product URLs.
