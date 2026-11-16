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

## Checkout and invoice pricing update (Android 1.3.1)

Offline product selection supports name/SKU search in web admin and Android. The generator labels the editable value **Selling price** and shows the original catalog price separately. Issued invoices show the catalog snapshot as Unit Price and selling price × quantity as Amount. When these prices differ, an agreed-selling-price note explains the calculation. Totals, emails and analytics use the selling price; later catalog changes do not change the invoice. Custom items use their entered price in both columns. Older invoices retain their existing rendering.

The additive `invoice_price_snapshots` table stores catalog prices by invoice item. New clients can submit optional `catalog_price`; older clients selecting a catalog product use its price at invoice creation. No historical price snapshots are invented. Deploy the server before installing Android 1.3.1.

Cart and billing use the storefront width with a two-column desktop layout, keeping the mobile layout. Cart thumbnails reserve their dimensions and use responsive image variants. Payment choices start hidden and are revealed only after settings load; failed settings requests offer Retry without exposing paused methods. Updated asset and service-worker versions refresh returning visitors.

## Conditions and independent amounts (Android 1.4.0)

Every generated PDF and HTML invoice, including website invoices and serial-number copies, includes the complete Pixelhouse Sales, Warranty & Service Conditions. PDF conditions start on a separate page. The prior unconditional seven-day invoice return statement is removed; payment notes remain. Website policy pages are unchanged.

Offline web/Android invoice editors now provide independent **Unit price** and **Amount — line total** fields. Selecting a product fills unit price; amount follows unit price × quantity until edited manually. Manual amounts remain unchanged when unit price or quantity changes. Selecting another product resets automatic calculation. The invoice prints the entered unit price and exact amount, with an optional warranty statement beneath the product. Blank warranty fields do not imply coverage. Invoice subtotal is the sum of amounts; shipping and invoice discounts retain their existing behavior. Catalog prices and stock are not modified.

The offline API accepts optional `unit_price`, `line_amount` and `warranty_text` (500 characters maximum). An additive `invoice_line_details` table stores the display unit price, exact line amount and warranty by order item. The existing financial item price stores effective amount/quantity for compatible reporting, while invoice rendering uses the exact saved amount. Older requests without the new fields retain previous behavior. Existing pricing snapshots remain supported. No past warranty or independent amount is inferred.

Deploy the server before installing Firebase-enabled Android 1.4.0; the new app checks the server capability to avoid silently losing entered amounts. Keep the additive metadata tables during rollback. Older rendering code cannot display independent amounts correctly, so retain the updated invoice renderer for invoices issued with these fields.
