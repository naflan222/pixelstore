# Professional customer review display

The product review list previously reused a stock portrait for every customer
and placed the username and raw timestamp below the comment. The homepage used
only its fixed testimonials; other footers hid reviews after the third on mobile.

## Display and visibility

- Use initials derived from the existing public username, with a Customer
  fallback. No stock portrait or private account/billing information is used.
- Place the public name above the stars/comment. Format SQLite and PostgreSQL
  timestamps as readable dates in Sri Lanka's time zone. Keep machine-readable
  ISO dates in time elements; omit invalid dates rather than showing raw text.
- Keep the existing product list, footer layout, brand colors and controls.
  Review-only styling improves contrast, wrapping and readability in both themes.
- Show published product reviews in the existing homepage carousel. Load further
  pages through its next control, so the initial six are not the only reachable
  reviews. Existing Facebook testimonials remain a labeled fallback if no public
  product reviews are available.
- Other footer review grids use the same name/date/initial format and a Show more
  reviews control. Remove the mobile rule that hid cards after the third.
- Refresh product and footer reviews after a successful submission. Reading
  reviews remains public; submitting still requires the existing login flow.
- Call them customer reviews rather than claiming verified purchases, since the
  current review endpoint does not verify that the reviewer purchased an item.

## API compatibility and moderation

GET /api/reviews/recent retains its reviews array and adds pagination metadata.
It accepts positive page/limit values (limit up to 24; default 6), serves only
visible reviews on active products, and includes rating-only reviews. The same
public username and product details are returned, with no email or billing data.
No-store prevents stale public-review pages being reused from HTTP caches.

This patch does not reveal hidden/moderated reviews, rewrite customer comments,
change existing ratings, or migrate/update production data. Existing moderation
controls are preserved. The service-worker cache version is bumped so returning
visitors receive the display changes.

## Validation

Targeted tests cover date formats, escaping, avatar/name order, anonymous reading,
submission refresh, homepage pagination, footer load-more, API failure/retry,
and published/hidden/inactive/rating-only API pagination. The API checks run on
SQLite and the PostgreSQL test double using disposable databases, not live data.
The test double does not establish real PostgreSQL concurrency guarantees.

With workspace network access restored, the full suite passes: 136 passed,
zero failed, two existing skips requiring real PostgreSQL transaction tests.
Chromium checks at 390px pass in light and dark themes: eight named reviews,
formatted dates/initials, no stock portrait, all eight mobile footer cards
reachable, homepage navigation beyond the first six, no horizontal overflow,
and zero page JavaScript errors. Tests use only disposable local data.
