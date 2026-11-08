# Stock labels and accidental store review

The storefront keeps its existing yellow availability bars but hides the text
above them. JavaScript no longer inserts stock counts in these labels or their
accessible names. Product-detail low-stock quantity messages are also removed.
Out-of-stock controls, order quantities, inventory tracking and checkout stock
validation remain intact; this is a display change rather than an inventory edit.

## Exactly one owner-requested review cleanup

The public review API identified review #2 as the accidental entry: username
Pixelhouse, product slug wpdcase (Water Proof Diving Case), five stars, blank
comment, created on 4 November 2026 at 01:46:08 UTC. The owner requested its
removal while preserving all other reviews.

After database initialization, a transactional cleanup hides a record only if
all those identifiers/details still match. Its database row/comment are retained
for recovery. The product's visible-review rating/count are recalculated and an
audit entry is written. Repeated startup does nothing once the entry is hidden.
No broad store-account filtering or removal of customer reviews is introduced.

If cleanup fails, the transaction rolls back and startup logs the failure while
keeping the storefront available. The cleanup will retry on a later restart.
No live review has been changed during preparation: the cleanup runs when this
branch is deployed through the normal hosting workflow.

Tests cover mismatched-author/product/rating/comment/time guards, preservation of
other customers and other store-account reviews, aggregate recalculation,
idempotence/audit behavior, and SQLite rollback after an injected failure. The
same matching and idempotence checks also run on the PostgreSQL test double.

Validation: full suite 137 passed, zero failed, two existing skips. Chromium
checks at 320, 390 and 1440 pixels in both themes confirm that the quantity
labels/low-stock numbers are hidden, progress bars stay yellow, and out-of-stock
purchase controls still work. A local startup test confirms that only review #2
is hidden while the customer review remains public. No live data was changed.
