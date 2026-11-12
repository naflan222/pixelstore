# Buying guides and product advice release

Copy approved in chat on 12 November 2026; see `seo-content-review.md` for the approved text. Production publication is pending preview approval.

## Behavior

- Five English buying guides and a `/guides` index reuse the existing page shell. Guide-only contrast rules are isolated in `css/buying-guides.css`; the global stylesheet is unchanged.
- Public guide routes use the existing shared route registry, server SEO renderer and dynamic sitemap. Legacy HTML aliases redirect through the normal handler.
- Six product advice blocks are matched to catalog identity. The first description paragraph remains catalog-controlled and escaped, and refreshes from the public API. Admin descriptions, prices and stock are not migrated or overwritten.
- Rental guidance follows existing listings. Existing prices and booking links are unchanged. Footer and relevant existing description areas link to the guides.
- Battery copy, inventory, customer reviews, checkout and Search Console configuration are unchanged. Camping promotion, Sinhala adaptations and original videos are deferred.

## Review and release

Review mobile/desktop light/dark screenshots in `/workspace/shared/seo-preview`. Use the local browser script with disposable seeded data; screenshots do not represent live stock or customer reviews. Review the branch before merging; do not deploy until the owner approves the preview.

Run `npm test`, `node scripts/test-buying-guides-browser.js` and the existing product-card browser regression. Browser scripts accept `PLAYWRIGHT_PATH` where Playwright is not installed in the repository. All browser/API mutations use disposable local databases.

Rollback by reverting the release commit and redeploying the prior version. There is no database migration or production data cleanup. After publication compare Search Console at 28 and 56 days; validate real purchase tracking before attributing sales. No automatic monitoring jobs were added.
