# Production security patch

This patch changes server behavior only. Storefront HTML, CSS, JavaScript,
images, product data, orders, and existing account credentials are unchanged.

## Behavior

- Only the storefront asset directories (`css`, `js`, `img`, `admin`) and
  the named root assets are served statically. HTML and sitemap routes retain
  their existing handlers. Source code, package files, and `data` are private.
- With `NODE_ENV=production`, password reset requires working email configuration.
  Missing email configuration or `FORCE_DEV_CODES=1` returns a generic 503
  before account lookup, without generating or returning a reset code.
  Configured SMTP/Brevo email resets keep their existing behavior.
- Production cannot seed a demo owner in SQLite or PostgreSQL, even with
  `SEED_DEMO_DATA=true`. SQLite no longer promotes an existing account just
  because its email matches the demo address. Existing roles are not changed.
  Local development seeding is preserved.

## Before production deployment

1. Take the normal database backup. Review and deploy through the existing
   hosting workflow; do not replace the live database with a local test database.
2. Confirm `NODE_ENV=production`, `FORCE_DEV_CODES` is unset, and the existing
   Brevo/SMTP configuration is present. Keep the current database settings.
3. If the live demo owner still has its documented default password, change
   that password through the existing account controls before deployment.
   This patch intentionally does not delete accounts or change their passwords.
4. Test the branch on staging with a separate database and email test transport.
   Check home, product, cart, checkout, invoice, admin login, and password reset.
5. After deployment, verify `/server/routes.js`, `/package.json`, and
   `/data/pixels.db` return 404, while storefront assets still return 200.

If database files were reachable on the live site, existing sessions may have
been exposed. Plan a controlled session revocation after the patch is deployed;
this logs customers and staff out and is not performed automatically here.

## Validation

`node --test tests/production-security.test.js` checks production file access,
unchanged asset bytes, page availability, SQLite/PostgreSQL demo-account rules,
preservation of existing account roles, registration/login/checkout/invoice, and
password reset both without email and with a mocked Brevo transport.

The repository's full suite had three pre-existing failures before this patch:
SEO CSS version, service-worker version, and homepage content expectations.
They are outside this patch; no storefront design is changed to satisfy them.
