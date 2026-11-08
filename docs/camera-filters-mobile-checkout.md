# Camera filters and mobile shopping

Category filter drawers now use GoPro, DJI, Insta360, camera-family compatibility,
accessory type and optional rupee price bounds. No filter is selected by default.
Selections within one group are alternatives; different groups are combined.
Selections survive reload and pagination, and Clear filters restores the catalog.
The two GoPro category pages reuse the header's reserved right-hand space for an
accessible button opening the existing drawer.

Matching uses the existing product brand, name, description and category, without
changing database records or claiming a model fits where it isn't documented.
Camera-family matching does not guarantee every model fits; shoppers should still
check the product details. Future catalog entries need descriptive names/details
for these filters to classify them accurately.

Normal category browsing retains its existing API pagination. Applying filters
loads that category's complete catalog once and paginates matching items locally;
saved filtered URLs do the same. A failed filtered fetch leaves the previous
products intact and shows a retry message in the open drawer.

Viewport restrictions are removed from HTML pages so native browser zoom is
allowed. The default scale, CSS, colours, card styles, banners and checkout logic
are retained. The shared script's query version is updated throughout storefront
HTML to avoid mixing the new controls with an old cached client.

## Verification

- `npm test`: 147 tests, 145 passed, zero failed, two existing skips (transaction
  rollback/concurrency checks unsupported by the pg-mem test double).
- Filter tests cover combined groups, alternatives, inclusive price bounds,
  unspecified compatibility and preventing generic action cameras from being
  classified as DJI Osmo Action.
- Headless Chromium mobile tests at 390px/light and 360px/dark: category pages,
  GoPro pagination, filter apply/reset, refresh persistence, invalid price range,
  DJI results, native product-page scale 2, and no horizontal overflow or JS errors.
- Disposable SQLite store browser checkout: guest cart, required billing fields,
  standard/express/pickup fee changes, payment selection, cash and bank order
  creation, order confirmation and cart clearing. A Rs.1,200 item plus standard
  shipping totals Rs.1,450. No live orders were placed or live data modified.
- Existing API tests also cover closed stores, disabled delivery, stock guards,
  configured fees and order validation. Browser testing does not verify receipt
  of an actual bank transfer or a physical iOS/Android device gesture.
