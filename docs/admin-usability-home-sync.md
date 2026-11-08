# PixelHouse Admin 1.1.0 and homepage synchronization

## What changed

The native dashboard prioritizes today's/month's order value, pending orders,
recent orders and stock alerts. Orders have readable customer/total/status cards,
search, payment/status filters and a Sri Lanka calendar date filter. Detail pages
separate customer contacts, items, totals, delivery, notes and history; existing
status, fulfillment and invoice actions remain available. Permanent deletion is
under More actions and requires confirmation. Returning to the order list keeps
its filters and scroll position.

Analytics uses Sri Lanka dates, quick periods and calendar-selected custom ranges.
It labels sales as **order value**, including unpaid orders and excluding cancelled
and refunded orders. Charts show daily values through 90 days and monthly values
for longer ranges. Product/category rankings use the same period.

Settings are grouped into Store details, Payments, Delivery and Notifications.
Only changed fields are sent. Save/cancel controls, validation, unsaved-change
navigation confirmation and checkout-availability confirmation reduce accidental
changes. Editing is disabled on an older server until `settings_patch` capability
is present. The existing full settings PUT remains available to old clients.

Homepage product selection has search, thumbnails, ordered selection and up/down/
remove controls. A successful write is followed by a separate public API read to
verify IDs and order. A verification failure is reported as **saved but not
verified**, never retried as another write.

The canonical `/` route now refreshes all four configured homepage sections on
load, every 30 seconds while visible, and when the tab/window returns to focus.
Unchanged sections retain their DOM and carousel position. Updates preserve each
section's existing card layout, product links, ratings, stock bars, badges,
countdowns and cart behavior. Failed requests retain the last successful display.
A configured section with no active products displays an empty state rather than
showing unrelated fallback products. No website CSS or checkout logic changes.

## API compatibility

- `PATCH /api/admin/settings` is owner-only and accepts a nonempty subset of the
  existing settings fields. It validates the merged values and transactionally
  preserves unexposed contact fields, other payment methods, express/pickup fees,
  custom labels/options and notification preferences.
- `GET /api/admin/analytics` and `/api/admin/orders` accept optional
  `timezone=Asia/Colombo`. Default remains UTC for existing clients; stored UTC
  timestamps are unchanged. Analytics range metadata includes the selected zone.
- Public homepage JSON retains `{ sections }` and adds `configured_sections`.
  Responses require cache revalidation. No database migration is required.

## Rollout

1. Merge/deploy the server and web changes first. Existing APKs remain compatible.
2. Install the signed Firebase **1.1.0 (version code 2)** APK over the working app.
   **Do not uninstall:** the same package and signing certificate preserve app
   data/session and Firebase setup. No Firebase secret changes are required.
3. Open Homepage sections, choose/order products, save and check the verification
   message. Open the website; an already-open visible homepage refreshes within
   30 seconds. Check settings, a real existing order and invoice sharing on the
   physical phone. No test order or test customer review is required.

Rollback: restore the previous server/web commit and reinstall a future APK with
an incremented version code if needed; Android normally blocks version-code
downgrades. No production records or schema are deleted by this upgrade.

## Validation

Automated checks use disposable databases and synthetic accounts. The optional
browser regression runs with `PLAYWRIGHT_PATH=/path/to/playwright node
scripts/test-homepage-sync.js` and Chromium at `/usr/bin/chromium`. It exercises
root loading, ordered admin saves, real 30-second polling, unchanged nodes,
carousel position, section-specific layouts, stock bars, single cart action,
outage retention and configured-empty behavior. The shared API suite tests PATCH
preservation/access/type guards and UTC versus Sri Lanka midnight boundaries on
SQLite, pg-mem and disposable real PostgreSQL. Native JVM/UI tests cover formatting,
partial settings, authenticated navigation and existing product rating preservation.
Physical-phone notification delivery and real customer payments are not simulated
by these checks.
