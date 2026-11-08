# PixelHouse Android Admin

The native Kotlin/Compose app lives in `android/`, package `lk.pixelhouse.admin`,
Android 8+. It uses the existing owner account and admin APIs. It does not change
storefront CSS, markup, checkout or existing permissions. Admin reads, forms,
images, ordered homepage selections, stock adjustments, CSV import/export,
offline invoices and PDF sharing are native screens, not a website wrapper.

## What the owner needs to provide

1. Open https://console.firebase.google.com/ on your phone. Use your browser's
   **Desktop site** option if needed. Create **PixelHouse Admin**; Google Analytics
   is optional and not needed. Add an Android app named **PixelHouse Admin** with
   the exact package **lk.pixelhouse.admin**. A signing certificate fingerprint is
   not required for FCM. Download **google-services.json**. This Android app
   configuration can be attached to the setup conversation; do not attach a
   service-account private key. Put it at `android/app/google-services.json`
   locally, or base64-encode it into the GitHub Actions secret
   `FIREBASE_ANDROID_CONFIG_BASE64`. The file is git-ignored. Rebuild the APK.
2. In Firebase, **Project settings → Service accounts → Firebase Admin SDK →
   Generate new private key**. Keep this JSON private. In your website hosting
   dashboard (Railway), open the website service's **Variables**, and add its
   complete JSON as `FIREBASE_SERVICE_ACCOUNT_JSON`. Add
   `MOBILE_PUSH_ENABLED=true`. Never paste the private key into chat, GitHub code,
   APK resources or screenshots. The server and Android configuration must belong
   to the same Firebase project. Confirm **Firebase Cloud Messaging API (V1)** is
   enabled under project settings / Cloud Messaging.
3. Deploy the reviewed server PR, install the APK and sign in as your existing
   owner. Open **Phone alerts → Connect this phone**, approve notification
   permission, and use **Send test notification**. Adjust sound through Android's
   notification settings. Registration does not replay old orders.
4. Place an explicitly labelled test order only when you are ready to create a
   real store order. Test foreground, background, dismissed app, locked screen,
   airplane-mode recovery, expired session and logout. A cash or bank order must
   notify before payment, and tapping must open its authenticated order details.
   Real-device FCM delivery cannot be verified without your Firebase setup and
   phone. Android force-stop or battery restrictions can prevent delivery.

A build without `google-services.json` still supports admin management, but
clearly labels alerts as unconfigured. It must not be described as a verified
notification app. Firebase failure never gates customer checkout.

## Building and signing

Use a JDK 17+, Android SDK platform 36 and build tools 36.0.0:

```sh
android/gradlew -p android testDebugUnitTest lintDebug assembleDebug
android/gradlew -p android connectedDebugAndroidTest
```

The wrapper pins Gradle 8.13 and its official SHA-256. A local `android/local.properties`
can contain `sdk.dir=/your/android/sdk`. Never commit local SDK paths.

A durable private release keystore is required for APK updates. Do not lose or
replace it. Store it and its passwords in your password manager/secret storage,
never this repository. For a release, provide `ANDROID_KEYSTORE_PATH`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, then run
`android/gradlew -p android assembleRelease`. Use `apksigner verify --print-certs`
on the result. Debug builds use a development key and must be uninstalled before
switching to a differently signed release. Back up the final release keystore
securely before distributing production APKs.

The **Android admin APK** GitHub workflow builds test APKs for PRs and on manual
request. A signed manual release additionally needs repository Actions secrets
`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and
`ANDROID_KEY_PASSWORD`. Creating these needs repository secret-management rights;
ordinary code-push access is insufficient. Firebase server keys do not belong in
these Android build secrets. Workflow artifacts contain only APKs, not keystores.
Install from a trusted download and allow **Install unknown apps** for your browser
when Android prompts. Future releases must increment `versionCode` and retain the
same package/signing certificate. Google Play publication is not required.

## Server interfaces and delivery

All `/api/mobile` endpoints require a valid session cookie and exact `owner` role:

- `GET /api/mobile/capabilities`: app/server version handshake and preview support;
  available to owners even with push disabled. The app blocks management until
  the matching server update is deployed, preventing CSV writes on older servers.
- `GET /api/mobile/devices`: device IDs and timestamps, no tokens.
- `PUT /api/mobile/devices/:uuid`: `{token}` from FCM; registration is idempotent.
- `DELETE /api/mobile/devices/:uuid`: revoke one of this owner's phones.
- `POST /api/mobile/devices/:uuid/test`: test message to the current session's
  registered phone, separately rate limited.

Disabled/unconfigured setup returns 503; no Firebase SDK is imported by checkout.
Two additive tables are created only after explicitly enabling/configuring push:
`mobile_push_devices` and `mobile_push_jobs`. Existing users/sessions/admin
notifications are reused; session deletion cascades device and queued-job removal.
Tokens stay in the private database and are not returned in lists or logs.

The worker checks every ten seconds. It scans committed admin notifications from
registration onward using the pairing baseline and an outbox join (so out-of-order
commits are not skipped behind a moving cursor), writes a deduplicated outbox, claims jobs with a two-minute
lease and sends data-only high-priority FCM messages. Payload: `event_id`,
`order_id`, `kind`; no customer information or amount. The app displays an order
number and fetches details only after sign-in. Firebase acceptance is not proof
of phone display. Retries are bounded by a 24-hour expiry, backoff up to one hour,
and source notification settings; old job metadata is removed after seven days.
Provider acceptance and a database acknowledgement cannot be atomic, so the app
also deduplicates events. Avoid force-stopping the app. Disabled notification
preferences suppress new-order delivery. Turning them back on does not replay
records the worker already processed while disabled.

The Android app uses encrypted session storage backed by Android Keystore, TLS,
no stored password, no network logging, no automatic mutation retry and no queued
offline writes. Server session expiry/revocation and owner role are checked at
send time. Logout must reach the server to stop delivery; the app reports an
offline failure instead of pretending to revoke a live session.

CSV preview extends the existing endpoint with
`POST /api/admin/products/import?dry_run=true`. It performs existing validation
and duplicate checks without writes. The original import route is unchanged.

## Rollout and rollback

Review/merge the PR with push disabled first. Run website health and checkout
checks. Add Firebase credentials and enable push only when the app is configured.
Review server logs for `[MOBILE PUSH]` messages without exposing credentials.
Set `MOBILE_PUSH_ENABLED=false` and redeploy to stop the worker immediately; web
checkout and existing admin notifications continue. Tables are additive and can
be retained when rolling server code back. No destructive production migration
or live order is part of automated verification.

## Verification of this implementation

- Full Node suite: 152 tests, 150 passed, zero failed, two existing pg-mem
  transaction/concurrency skips. The shared CSV test verifies that preview writes
  nothing before a confirmed import.
- Disposable real PostgreSQL 16: all 46 API tests passed, including transaction
  rollback and the last-unit checkout race. The additional mobile delivery suite
  passed against real PostgreSQL and SQLite, including late/out-of-order commits,
  retries, token invalidation, role guards, logout revocation and no old-alert
  replay after queue cleanup.
- Seven Android JVM tests passed. All four instrumented Android 8 tests passed:
  authenticated order deep links, non-owner rejection, native admin navigation,
  and product editing that preserves the existing customer review rating.
  Instrumented tests inject fixture HTTP responses; they never use live accounts.
- Debug APK, instrumented-test APK, signed release APK and Android lint built
  successfully. `apksigner verify` confirms the release signature. The private
  signing key/password are outside the repository, not in artifacts or source.
- No storefront HTML/CSS, checkout logic or existing database records were changed
  by this feature or its tests. No live order, email or Firebase message was sent.
- Still requires owner input: Firebase Android configuration, hosting secrets,
  secure signing-key backup and a physical-phone delivery/permission test. The
  current APK explicitly shows Firebase as unconfigured. Do not claim push delivery
  is verified merely because a device can register.

The current GitHub integration can push code/workflows but cannot manage Actions
secrets (403); release asset upload also returned 401. No APK release was publicly
published. The signed APK is retained as a shared session artifact. The included
workflow can build a downloadable APK artifact; configuring repeatable signed CI
releases requires the repository owner to add the signing secrets securely.
