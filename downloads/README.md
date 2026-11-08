# PixelHouse Admin Android download

**Latest: PixelHouse-Admin-1.1.0-Firebase.apk** (version code 2).
Use GitHub's Download raw file button to download it.

Merge/deploy server and website PR #74 first. Then install this APK over the
working PixelHouse Admin app **without uninstalling**. The package and release
signing certificate match the previous Firebase APK; existing data, session and
notification setup can be retained. No new Firebase server variables are needed.

This version improves Dashboard, Orders/details, Sales analytics and Store settings,
and verifies saved homepage selections against the public website API. Website
homepage sections refresh within 30 seconds while visible.

The release includes Firebase Android client configuration. No Firebase server
private key, signing private key, password or customer data is included. Previous
1.0.0 remains available as PixelHouse-Admin-Firebase.apk for reference; Android
normally blocks installing it as a downgrade over 1.1.0.

Source: feat/admin-usability-home-sync, commit e876e28.
This branch is download-only and must not be merged into main.
