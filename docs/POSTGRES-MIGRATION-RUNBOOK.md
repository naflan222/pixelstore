# PostgreSQL Cutover Runbook (Phase 2)

One-way migration of the PixelStore backend from SQLite to PostgreSQL, and the
production cutover that follows it. Every step is manual and explicit — there
is no automatic cutover, no automatic seeding, and no destructive default.

> **Scope guardrails**
> - Production stays on **SQLite** until an operator runs this runbook.
> - The migration scripts never modify the SQLite file (opened read-only) and
>   never `DROP` anything on either side.
> - The destination must be **empty** or the import aborts (override exists,
>   see step 7).
> - `DATABASE_URL` lives **only** in server-side env. It is never sent to the
>   frontend, never printed by any script, and must never be pasted into docs,
>   chat logs, or screenshots.
> - No step in this runbook merges branches, restarts production by itself, or
>   touches email deliverability.

## 0. Vocabulary

| Item | Meaning |
|---|---|
| `DB_ENGINE` | `sqlite` (default when unset) or `postgres`. Only this switch changes engines. |
| `DATABASE_URL` | Postgres connection string. Required iff `DB_ENGINE=postgres`. |
| `MAINTENANCE_MODE` | `true` blocks all writes (POST/PUT/PATCH/DELETE → 503); reads + `/api/health` keep working. Default `false`. |
| `SEED_DEMO_DATA` | `true` seeds demo products + owner. **Never `true` in production.** Default `false`. |
| `SQLITE_DB_PATH` | Path to the live SQLite file. |

Tooling (all in this repo):

| Script | Purpose |
|---|---|
| `npm run db:init:postgres` | Applies `server/schema-postgres.sql` to `DATABASE_URL`. Idempotent, creates **no** data. |
| `npm run migrate:sqlite-to-postgres -- <sqlite-file>` | Dry-run import plan + source counts. Add `--execute` to import. |
| `npm run verify:migration -- <sqlite-file>` | Independent post-import check: counts, per-row content hashes, FK integrity, invariants, sequences. |
| `npm test` | Full suite on SQLite + (pg-mem) Postgres + migration round-trip. |
| `TEST_DATABASE_URL=<url> npm test` | Same suite, but the Postgres leg runs against a **real** server (its `public` schema is dropped first — disposable test DBs only). |

## 1. Prove the suite is green on this exact commit

```sh
git log --oneline -1        # note the commit you are cutting over
npm test                    # expect: 0 failures
```

If available, also run the real-Postgres leg against a **disposable** database
(local docker or staging — never production):

```sh
TEST_DATABASE_URL='<test-database-url>' node --test tests/api-pg.test.js
```

This is the only leg that proves transactional rollback and last-unit race
behaviour on real PostgreSQL; the default pg-mem double self-skips those two
subtests (documented in `tests/suite.js`).

## 2. Back up the SQLite file

```sh
cp '<live-db-path>' "/backups/pixels-$(date -u +%Y%m%dT%H%M%SZ).db"
sha256sum "/backups/pixels-"*.db | tail -1   # record the hash
```

Keep this backup until the post-cutover retention window expires (step 12).
The importer only reads the source, but a restorable backup is still required.

## 3. Provision PostgreSQL and set server-side env (no restart yet)

1. Provision the production Postgres instance.
2. Set `DATABASE_URL` (with the provider's `sslmode` parameter) as a
   server-side secret. The app respects whatever `sslmode` the URL carries —
   it never forces or downgrades TLS itself.
3. Leave `DB_ENGINE` **unset** (SQLite) for now.
4. Leave `SEED_DEMO_DATA` unset/`false` and `MAINTENANCE_MODE` unset/`false`.

## 4. Deploy the Phase-2 code (still on SQLite)

Deploy normally. With `DB_ENGINE` unset the app behaves exactly as before:

```sh
curl -s https://<host>/api/health
# {"ok":true,"engine":"sqlite","db_reachable":true,...}
```

`timestamptz` values are stored in UTC; the app pins the Postgres session to
`TimeZone=UTC` so date bucketing never shifts with server locale.

## 5. Create the PostgreSQL schema (no data)

From a machine that can reach production Postgres (CI job or operator shell
with `DATABASE_URL` exported — never commit it anywhere):

```sh
npm run db:init:postgres
# PostgreSQL schema ready (23 tables in public schema). No demo data created.
```

Safe to re-run (all DDL is `IF NOT EXISTS`). It creates tables, indexes,
partial uniques, and the singleton `store_settings` row — nothing else.

## 6. Dry-run the import and eyeball the counts

```sh
npm run migrate:sqlite-to-postgres -- '<live-db-path>'
```

This prints per-table source counts and `DRY RUN — nothing was written`.
Sanity-check the totals against the live shop (admin stats / a read-only
`SELECT COUNT(*)` each). Investigate any surprise before proceeding.

## 7. Enable maintenance mode (writes freeze)

Set `MAINTENANCE_MODE=true` on the app and restart/redeploy so it takes
effect. Expected behaviour:

- `POST/PUT/PATCH/DELETE` → `503 { maintenance: true, ... }`
- `GET` pages/APIs and `/api/health` keep working (`maintenance: true` in body)

Place a test order attempt and confirm the 503; confirm the storefront still
renders. From this point on, the SQLite file is stable and safe to copy from.

## 8. Execute the import

```sh
npm run migrate:sqlite-to-postgres -- --execute '<live-db-path>'
```

What it does and guarantees:

- Opens SQLite **read-only** (+ `integrity_check` first; aborts if corrupt).
- **Aborts if any destination table is non-empty**, unless you pass
  `--allow-non-empty` (only for a deliberate, understood re-run into a wiped
  schema — conflicting ids still abort the import).
- Copies all 23 tables in FK-safe order **inside one Postgres transaction**
  (all-or-nothing), preserving ids, password hashes, guest ids, order
  snapshots, image blobs, JSON settings, histories, audit logs, and sessions.
- Imports only **valid** (unused, unexpired) password-reset codes by default;
  pass `--include-expired-resets` to copy everything.
- Normalises legacy `''` date sentinels to `NULL` on 4 date columns (documented
  in the script; both engines treat `NULL` as "no date").
- Repairs every identity sequence past `MAX(id)` so the next app insert never
  collides (this also covers explicit ids from CSV imports).
- Prints per-table source → destination counts and **fails if any mismatch**.
- Never prints hashes, tokens, codes, PII, or `DATABASE_URL`.

## 9. Verify independently, then reconcile

```sh
npm run verify:migration -- '<live-db-path>'
# ... PASS lines ...
# VERIFICATION PASSED
```

The verifier re-opens SQLite read-only and checks: per-table counts, per-row
SHA-256 content hashes (timestamps normalised to epoch millis), min/max id
ranges, 22 foreign keys (zero orphans), order/item/payment linkage, the
≤1-primary-image invariant, payment 1:1 uniqueness, case-insensitive coupon
uniqueness, the settings singleton, complete order snapshots, and that every
sequence sits past its table's `MAX(id)`.

- `VERIFICATION PASSED` (exit 0) → proceed.
- Any `FAIL` (exit 1) → **stop, do not cut over**. Keep maintenance mode on,
  wipe the Postgres schema (`DROP SCHEMA public CASCADE; CREATE SCHEMA
  public;` on the **production Postgres only if you are certain it holds no
  live data yet**), fix the cause, and restart from step 5. SQLite is still
  the live engine, so the shop is unharmed.

## 10. Smoke-test against PostgreSQL (staging first, then prod-shadow)

Recommended: point a staging deployment at a **copy** of the migrated
database with `DB_ENGINE=postgres` and walk the critical paths:

1. `/api/health` reports `"engine":"postgres","db_reachable":true`.
2. Register → login → profile → logout → password reset (dev code).
3. Browse/search product, guest cart → login merge → coupon → checkout.
4. Customer: order list, invoice PDF. Owner: fulfil, ship, cancel/restore.
5. Admin: product create + image upload, inventory adjust, CSV export/import,
   coupon create, banner create, settings round-trip, analytics load.

Only when staging is clean should production proceed to step 11.

## 11. Cut over production

1. Confirm maintenance mode is still `true` (no writes since step 7 — if any
   write reached SQLite after the import, re-run steps 8–9 first).
2. Set `DB_ENGINE=postgres` (keep `MAINTENANCE_MODE=true` for the restart).
3. Restart the app, then check `/api/health` → `"engine":"postgres"`.
4. Place one real test order end-to-end (then cancel it from admin to restore
   stock), or run the read-only smoke list from step 10.
5. Set `MAINTENANCE_MODE=false` (or unset) and restart. Confirm a write
   succeeds and `/api/health` shows `maintenance: false`.

## 12. Post-cutover watch + SQLite retention

- Watch logs and `/api/health` (`db_reachable`) for at least one business day.
- Keep the step-2 SQLite backup for the agreed retention window (suggested:
  30 days) before deleting.
- Do **not** delete SQLite support from the codebase yet — it is the rollback
  engine (step 13) and the dev/test default.

## 13. Rollback (if anything is wrong after step 11)

Rollback returns the live engine to SQLite. It is safe at any time, with one
caveat: **orders/data written to Postgres after the cutover do not exist in
SQLite** — export anything needed (admin CSV / order list) before rolling
back, and reconcile manually afterwards.

1. Set `MAINTENANCE_MODE=true`, restart. Confirm writes 503.
2. Unset `DB_ENGINE` (or set it to `sqlite`). Restart.
3. Confirm `/api/health` → `"engine":"sqlite"` and the shop reads/writes.
4. Set `MAINTENANCE_MODE=false`, restart. Confirm normal operation.
5. Leave Postgres untouched for forensics; do **not** re-import over it
   without wiping it first (the importer aborts on non-empty destinations).

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `DB_ENGINE=postgres requires the DATABASE_URL environment variable` at boot | `DATABASE_URL` not exported in the app env. Set it server-side; never in client bundles. |
| Import aborts: `Destination is NOT empty` | Schema was seeded or a previous import ran. Wipe (`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`) on a disposable DB, or investigate — never `--allow-non-empty` blindly. |
| Import aborts: `integrity_check` | Source SQLite file is corrupt — restore from the step-2 backup and retry. |
| Verify `FAIL`s on counts/content | Do not cut over. See step 9. |
| `503 maintenance` after cutover | `MAINTENANCE_MODE` still `true` — set `false` and restart. |
| Health `db_reachable: false` | Postgres unreachable / TLS (`sslmode`) / credentials — check server env and network; the health body never includes the URL. |
| Sequence/duplicate-key errors on first writes | Import's sequence repair was skipped (only possible with `--allow-non-empty` into a dirty schema). Wipe and re-import cleanly. |

## Appendix: what the import preserves, exactly

ids (all tables) · password hashes · session tokens+expiry · guest cart /
wishlist ownership · coupon codes + usage counters · order header/item
snapshots + payment rows + status history · inventory movements · reviews +
aggregates · contact messages + read markers · vendor applications ·
notifications (user + admin) · audit logs · store settings JSON · promotional
banners · product image blobs + primary flags + sort order. Skipped by
default: used/expired password-reset codes (override:
`--include-expired-resets`). Normalised: `''` → `NULL` on
`coupons.expires_at`, `promotional_banners.starts_at/ends_at`,
`payments.paid_at`.
