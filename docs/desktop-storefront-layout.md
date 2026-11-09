# Desktop storefront layout

Desktop storefronts (768px and wider) now use the available space up to 1120px. Category tiles have equal heights, dynamic product pictures fit fully inside their image frame, and the homepage customer reviews use up to three columns. Review pagination, loading recovery, and the mobile carousel share the same review data.

Camping Accessories replaces DJI Osmo Camera in the third category position. The duplicate Camping tile and homepage DJI camera promotion were removed. Osmo Accessories and the existing camera route remain available.

The mobile layout below 768px retains its existing styles and review carousel. The category replacement and promotion removal also apply on mobile. No catalog records, prices, stock, customer reviews, or database schema are changed.

## Validation

- Node suite: 188 passed, 4 skipped, 0 failed.
- Disposable local catalog browser regression: light/dark at 360, 390, 430, 768, 980, 1024, 1440, and 1920px; full accessory/camping images; equal category heights; review pagination, retry, single-review width, and resize state.
- Mobile geometry compared with the previous CSS/JavaScript at 360, 390, and 430px.

Run the browser regression with Playwright installed and Chromium at `/usr/bin/chromium`:

```sh
node scripts/test-desktop-layout.js
```

`PLAYWRIGHT_PATH` can specify an installed Playwright module. Screenshots use synthetic local reviews and disposable stock data, not production customer data.

## Preview

[Desktop homepage](previews/desktop-storefront/home-desktop.png) · [Desktop product](previews/desktop-storefront/product-desktop.png) · [Mobile homepage](previews/desktop-storefront/home-mobile.png)

## Release

Merge and deploy the frontend update, then reload the browser. The service-worker cache version is incremented to refresh the CSS and shared storefront script. No Android APK or database migration is required.
