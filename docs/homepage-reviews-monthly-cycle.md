# Homepage ratings and recurring monthly countdown

The catalog already had Floating Handle Stick's customer rating, but static
homepage cards still displayed No reviews yet. A homepage-aware refresh now
updates existing rating areas on the root URL and both homepage aliases using
the public product data. Cards show their average and an explicit review count.
Zero-review products still say No reviews yet.

Refresh runs immediately, once per minute while the page is visible, and on
focus/visibility changes. Successful submissions notify other tabs through a
small localStorage marker. When rating/count data changes, the existing homepage
review carousel reloads its published reviews/count too. Failed requests retain
the last successful display, and in-flight requests are not duplicated.

## Monthly cycle

The two homepage badges no longer use expired October dates. They use a shared
UTC anchor, 8 November 2026 at midnight, with the first deadline on 8 December
2026. Each deadline advances by a calendar month automatically. Refreshing the
page or clearing storage does not restart a visitor-specific timer. Long gaps,
month ends and leap years are handled without drifting the original day.

The existing badge layout is retained. Its title/accessibility label identifies
this as an automatically renewing monthly refresh rather than a one-off sale
deadline. Existing one-off countdowns on other pages are unchanged.

## Validation

Full suite: 143 passed, zero failed, two existing real-PostgreSQL skips. New tests
cover root/alias ratings, counts, failed requests, visible-tab refresh, monthly
expiry, reload consistency, skipped months, month ends and leap years.

Chromium at 390px in both themes verifies the real homepage card, a new customer
review submitted through the API, the next-minute card/footer count update,
reload-stable countdowns and automatic rollover across the December deadline.
No horizontal overflow or page JavaScript errors were observed. Tests use only
disposable local data. No CSS, inventory, review records or production data is
changed by the patch; the normal hosting deployment applies it after merge.
