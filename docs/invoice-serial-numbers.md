# Invoice serial numbers and cash-only checkout

Deploy the server update before installing Android Admin 1.3.0. The database update adds an `invoice_serials` table on SQLite and PostgreSQL; it does not replace existing invoices or orders.

## Offline invoices

In web admin or Android Admin, open Invoices and choose a product. Its catalog price fills automatically and remains editable for that invoice only. Custom items remain supported. Cameras and camera bundles open optional serial-number fields automatically; serial entry can also be enabled for other items. Each unit has its own field, shown ten at a time. Serial numbers print below the corresponding product and preserve leading zeros. Creating an offline invoice keeps the existing behavior: it creates an offline order and sends the invoice, without deducting inventory.

## Existing website orders

Open the order and choose **Serial-number copy**. Enter serial numbers, save them, then download/share the PDF or explicitly email the copy. The copy keeps the original order number and totals and is labelled as a copy. It does not create another sale or change stock. Original website invoices and automatic confirmation emails remain unchanged.

## Website payments

The first production startup applies a one-time, audited setting change to cash on delivery only. Checkout hides disabled methods and the server rejects new bank-transfer orders. Existing bank-transfer orders remain intact; offline admins can still record bank payments. The owner can enable bank transfer again in Store Settings: the startup change will not repeat once recorded in the audit log.

## Verification and rollback

API tests cover both database engines, serial validation, invoice rendering and email attachments, unchanged original invoices, stock preservation, and the reversible payment setting. Browser checks cover mobile and desktop invoice editors and cash-only checkout. Android unit tests, lint and release build pass.

Keep the additive table and serial data during rollback. Reverting code does not automatically restore the payment setting; use Store Settings if bank transfer should be re-enabled. No live orders or customer emails are used by the verification scripts.
