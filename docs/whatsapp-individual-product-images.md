# PixelHouse WhatsApp catalog image pack

This is a **separate WhatsApp-only pack**. It does not edit the website product photos, product prices, orders, or live Meta catalog.

## Source

The generator uses the current public Pixelhouse product catalog where available, with images already published by the site and the same GitHub image files. If the live catalog is temporarily unreachable, it falls back to the 22 original products in `server/seed-data.js` and the 35 approved product entries in `catalog/accessories-20261109.json` and `catalog/camping-20261109.json`.

Products are rendered **one at a time**, preserving the actual product photo. Source resolution limits detail: sharpening improves appearance but cannot invent real missing detail.

## Layout

- Square 1200 × 1200 JPG for each product
- Large product name and prominent actual product photo
- Phone number **0777466675**
- **CASH ON DELIVERY** and **SHOP NOW** callouts
- Blue/navy GoPro-compatible theme
- Mint/dark DJI Osmo theme
- Green/gold camping theme
- Purple Insta360 theme
- Compatible-accessory wording where appropriate, rather than claiming all generic accessories are made by the camera brand

## Download the finished image pack

GitHub → **Actions → Build separate WhatsApp catalog images** → choose a successful run → **Artifacts** → **Pixelhouse-WhatsApp-Individual-Product-Images**.

The artifact contains individual JPGs, a contact sheet, product name/ID mapping CSV, and a README with any missing photos. The run can also be started manually from the Actions tab once the workflow is merged into `main`.

## Publish to WhatsApp

These are **not uploaded automatically**. Review the images and, if approved, configure the Meta feed to serve these images through a separate feed image URL. That is a subsequent step because changing the live `image_link` prematurely could replace currently approved photos or point to unavailable images.

Current website product images remain untouched.
