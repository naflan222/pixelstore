# PixelHouse and Daraz Sri Lanka

## Current implementation

The **Daraz Integration** tab provides seller authorization, connection status, an authenticated catalog-read test, local disconnect, and a dry run of active PixelHouse products. The preview checks core listing fields and reports possible duplicate SKUs, website regular and offer prices in LKR, stock, and image counts. It does not send or validate a listing on Daraz.

PixelHouse uses Express and a static storefront and dashboard. Its shared database adapter supports SQLite and PostgreSQL. The products table holds stock, current and former prices, SKU, category, brand and MPN. Gallery assets can be existing paths or uploaded image data. The site already uses transactional checkout and inventory adjustments. There is no native per-variation stock model for this integration to assume. Daraz packaging, warranty, variations and required category attributes need seller-supplied values when absent. Marketplace pricing, commission and costs should be captured separately from the website.

## Register and authorize

1. Register at [Daraz Open Platform](https://open.daraz.com/) and open **App Console**. Create an application in the category appropriate for operating your own Sri Lanka seller account. If Daraz requires approval or a seller allowlist for that category, complete it in **Auth Management** before connecting.
2. Copy the App Key and App Secret from the application management page into the backend secret store. Register `https://pixelhouse.lk/api/admin/daraz/callback` as the exact callback URL. Use the actual admin HTTPS origin if testing on a separate deployment.
3. In App Management, inspect and request the permissions exposed for your application. The current connection test requires **GetProducts**. The full integration requires seller product read and write, category and attribute reads, image upload or migration, price and quantity updates, listing QC status, and order and order-item reads. Confirm granted APIs and available return/finance capabilities in your own console. This implementation does not request unmasked buyer details.
4. Configure the following backend variables and restart with the two database schemas available. Startup creates the connection table on either engine.

| Variable | Value |
| --- | --- |
| `DARAZ_APP_KEY` | App Key from Daraz |
| `DARAZ_APP_SECRET` | App Secret from Daraz |
| `DARAZ_REDIRECT_URI` | The exact registered HTTPS callback |
| `DARAZ_API_BASE_URL` | Optional. Defaults to `https://api.daraz.lk/rest` |
| `DARAZ_TOKEN_KEY` | Separate 32-byte secret encoded as 64 hex characters. Generate with `openssl rand -hex 32`. Keep stable across restarts and replicas. |

5. Sign in to PixelHouse as an owner or admin. Visit **Daraz Integration**, select **Connect Daraz Account**, and sign in to the Sri Lanka seller account on Daraz. After returning, select **Test Connection**, then **Preview Catalog**. If a token expires and refresh is unavailable, authorize again. Disconnect removes the local encrypted authorization and pending OAuth state. Revoke the grant on Daraz separately if you want Daraz to revoke the app’s access.
6. Configure hosting and reverse-proxy logging to redact the callback query string. It contains Daraz’s single-use authorization code. Backend secrets and seller tokens belong in the backend secret store and encrypted database storage. Do not paste them into GitHub or chat.

## Publishing and synchronization

This change does not implement or enable product publication, order import, marketplace pricing, or stock synchronization. Before an approved one-product trial, verify the category tree, required attribute values, image intake, SKU lookup, and order/return lifecycle using the authorized account and API Explorer. API Explorer uses production data. Use read operations during verification.

The one-product trial requires explicit approval. It must verify listing identity and review status, separate LKR pricing, stock reconciliation, replayed order events, cancellation and actual return restocking, and recovery after throttling. Enable bulk publication and automatic synchronization only after these tests and separate explicit approval. Polling alone cannot guarantee zero oversells because both stores can accept orders before they hear about each other. A production rollout needs an explicit inventory allocation policy and reconciled reservations.

## Official references

- [Daraz API reference](https://open.daraz.com/doc/api.htm)
- [Daraz API Explorer](https://open.daraz.com/doc/doc.htm)
- [Daraz seller authorization and token refresh](https://api.alidayu.com/docs/doc.htm?articleId=120222&docType=1&treeId=754)
- [Daraz API method mapping](https://developer.alibaba.com/docs/doc.htm?articleId=120243&docType=1&treeId=754)
- [Daraz request signing](https://doc.alidayu.com/docs/doc.htm?articleId=120322&docType=1&treeId=754)
- [Sri Lanka Seller Center](https://sellercenter.daraz.lk/)
