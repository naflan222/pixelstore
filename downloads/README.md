# PixelHouse Admin Android download

Download `PixelHouse-Admin-Firebase.apk` using the GitHub **Download raw file** button.
This signed release candidate includes the supplied Firebase Android client
configuration. No server private key or signing private key is included.

Server PR #73 must be merged/deployed and the Firebase server variables configured
before alerts can work. Install the APK, sign in as the owner, then open Phone
alerts, connect the phone, allow Android notifications and send a test notification.
If a differently signed preview is installed, uninstall that preview first.
Physical-phone notification delivery still requires testing.

This branch provides a download only and is not intended to merge into main.
