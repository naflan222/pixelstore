# Checkout, stock and password-session fixes

## Behavior

- Checkout reads the store's current open/closed status, enabled delivery methods,
  and delivery fees. The standard fee comes from the admin shipping-fee field;
  express uses its configured fee. The browser and order API use the same rules.
- Existing free store pickup remains available when old admin settings omit it.
  An explicitly disabled pickup option stays disabled. Express is offered only
  when enabled. No CSS or HTML source files are changed; the delivery list uses
  the existing radio/label/check markup and CSS classes.
- Order submission rechecks settings and product status inside the transaction.
  Products marked inactive cannot be newly added or purchased from existing
  carts. Rejected orders leave the customer's cart and stock unchanged.
- Cancelled/refunded orders cannot move back to an active status. Reopening
  returns a clear 409 response: create a new order instead. Repeated cancellation
  and cancellation/refund transitions do not restore stock more than once.
- A successful password change atomically updates the password and revokes the
  account's other sessions, keeping the current session logged in. Invalid
  password-change attempts do not revoke sessions.

## Deployment

Review on a separate branch before deploying through the normal hosting flow.
No database migration, live-data update, credential change, or deployment is
performed by this patch. Existing shipping settings become authoritative, so
confirm their fees and enabled methods in the admin panel before deployment.
The frontend service-worker cache version is bumped to refresh browser assets.

On staging with a separate database, check delivery prices and the final order
total, inactive-product rejection, closed-store behavior, and a password change
with two browser sessions. Confirm the current session stays signed in while
the other session must log in again. Do not place test orders in production.

## Automated checks

`node --test tests/api-sqlite.test.js tests/api-pg.test.js` exercises the same
regressions on SQLite and the PostgreSQL test double (or real disposable
PostgreSQL when TEST_DATABASE_URL is explicitly configured). The test double
does not prove real PostgreSQL rollback/concurrency semantics; those existing
tests remain skipped without a real test database.

The original three SEO/homepage/service-worker expectation failures remain
outside this patch. The old hard-coded Rs. 500 checkout test is updated to
expect the configured delivery fee rather than preserve the bug.
