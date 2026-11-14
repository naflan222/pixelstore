# One-time setup: WhatsApp-only product artwork (Pixel House)

## What stays unchanged

- Storefront `img/product/**` files, image records in the database, website product listings, and checkout
- Existing public product feed: `https://pixelhouse.lk/meta-catalog.csv`
- Meta's **current** data-source URL, until the owner intentionally switches it
- WhatsApp number, messages, and account

## One batch upload of 57 JPGs on Android

1. First review/merge PR #91. It adds this instructions file and an empty `img/whatsapp-cards/` upload folder, plus a separate `/whatsapp-catalog.csv` endpoint.
2. Download **Pixelhouse_57_WhatsApp_Cards_Upload_Only.zip** provided in the ChatGPT conversation.
3. In Android **Files** / **My Files**, extract the ZIP into a folder. Inside are 57 individual JPGs named `PH-1.jpg`, etc. Do not upload the ZIP as a single file.
4. In Chrome, open `https://github.com/naflan222/pixelstore/tree/main/img/whatsapp-cards` with **Desktop site** if needed.
5. Tap **Add file → Upload files**. Select all 57 extracted **PH-*.jpg** cards in the Android file picker. For GitHub's standard upload form, choose **Commit directly to main** and commit.
6. Wait for the website's normal GitHub deployment. No existing website product photo is overwritten.
7. Check that both of these work in an incognito tab:
   - `https://pixelhouse.lk/img/whatsapp-cards/PH-1.jpg`
   - `https://pixelhouse.lk/img/whatsapp-cards/PH-45.jpg`
8. Open `https://pixelhouse.lk/whatsapp-catalog.csv` and check the `image_link` column for PH-1: it should use `/img/whatsapp-cards/PH-1.jpg`.
9. Confirm `https://pixelhouse.lk/meta-catalog.csv` still contains the **original** product photo URLs.

## Switch Meta *after* verifying these links

1. In **Meta Commerce Manager → Pixelhouse Website Catalog → Catalog → Data sources**, open the existing **scheduled website feed**.
2. Find the editable **Data feed URL**. Change the current `https://pixelhouse.lk/meta-catalog.csv` to:
   `https://pixelhouse.lk/whatsapp-catalog.csv`.
3. Leave the business, currency (LKR), product IDs, and update schedule alone. Do **not** add a second competing source with duplicate IDs.
4. Trigger a one-time update, then inspect **Products** and the import diagnostics.
5. In WhatsApp Business, the connected catalog updates after Meta processes the feed (up to ~24 hours).

If Meta doesn't expose a URL-edit option on your account, use the Data sources screens to replace the scheduled data source while preserving the same catalog and identical product IDs. Review the actual screen before deleting any data source.

## Technical notes

- Product IDs, prices, discounts, stock and links are derived from the live database. This new endpoint changes ONLY `image_link` when a matching JPG file exists.
- The source website `/meta-catalog.csv` endpoint is still active and untouched.
- Missing JPG = original live website image (safe fallback). Future website-only products need a new card JPG later.
- Promotional cards are snapshots; regenerate manually when a product's name/photo changes. The stock/price fields still sync automatically.
- Verify generated product images for errors and accurate product brand associations before publishing.
