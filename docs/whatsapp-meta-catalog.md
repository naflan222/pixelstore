# PixelHouse → Meta Commerce Manager → WhatsApp Business app

This integration uses a public **read-only** CSV product feed generated from the
live product database. It does not require the WhatsApp Cloud API or Meta tokens.

## After merging and deploying

1. Open **https://pixelhouse.lk/meta-catalog.csv** in a browser. It should
   download/show a CSV starting with `id,title,description,availability,...`.
   Check a few products: product titles, primary photos, prices and stock.
   If you see a blank or error page, check the server logs and deploy status.
2. Log in to **https://business.facebook.com/commerce** with the Facebook
   account that manages the PixelHouse Page. Create a retail/e-commerce
   catalog if you do not already have one.
3. In **Commerce Manager → Catalog → Data sources / Add items → Data feed**,
   choose a URL (scheduled feed) and paste:
   **https://pixelhouse.lk/meta-catalog.csv**.
   Choose **daily** refresh (or hourly if stock changes often). Upload the feed
   once, then check Diagnostics for rejected products and fix them in the
   PixelHouse admin dashboard.
4. Ensure the Facebook Page associated with the Meta catalog is linked to the
   same WhatsApp Business app account.
5. In the **WhatsApp Business app** on Android: **Tools → Catalog → ⋮ →
   Catalog settings → Connect catalog**, then choose/confirm the Meta catalog.
   WhatsApp says this connected-catalog feature might not be offered to every
   account. If **Connect catalog** is missing, this setup cannot yet sync to
   that ordinary app account; you can still use the Meta catalog separately.
6. Check the catalog from another phone after items pass Meta/WhatsApp review.
   Connected catalog changes can take up to 24 hours to appear in WhatsApp.

**Important**: Linking a Meta catalog archives the catalog you previously
created inside the WhatsApp app, and you no longer edit the connected catalog
from that app. Instead, edit products on PixelHouse.lk (or Commerce Manager).

## Source fields and policies

- Data source: active rows in the real `products` table, not demo products or
  static GitHub files.
- Stable ID: `PH-<database id>`; title, description, prices, links and
  image URLs are generated live.
- Discount: `old_price` becomes regular `price` and the current price
  becomes `sale_price` only when `old_price > price`.
- Availability: `stock > 0` means "in stock"; otherwise "out of stock".
  Out-of-stock products remain visible with that availability status.
- Only active products with a valid positive price, product URL, and publicly
  fetchable image URL are included. Invalid entries are skipped and the count
  is logged as `[META CATALOG]` on the server.
- **Brand**: Products with a blank brand are exported as `Unbranded`.
  Before importing, review actual camera brand names in PixelHouse admin so
  branded goods are correctly identified. Do not leave a genuine GoPro, DJI or
  Insta360 camera listed as "Unbranded".
- **Condition**: Exported as `new`. Don't use the automatic feed for used or
  refurbished stock until condition is represented explicitly in inventory.
- Admin-uploaded base64 product photos become publicly fetchable HTTPS image
  endpoints (`/meta-catalog/images/<id>`). Only active product primary images
  are exposed and the original customer/account database is never exported.

## Troubleshooting

- If a product is missing, confirm it is `active`, has a positive price,
  `url_slug`, a valid image, and check Meta's rejected-items diagnostics.
- If the photo is missing, open its `image_link` from the CSV in an incognito
  browser; it must show the product without requiring login.
- If WhatsApp doesn't reflect changes, check the last scheduled CSV import
  in Meta, Meta review, the app's connected catalog settings, and allow up
  to 24 hours for WhatsApp updates.
- The user must complete the Meta/WhatsApp connection manually; publishing
  this GitHub branch alone does not connect or modify their WhatsApp account.
