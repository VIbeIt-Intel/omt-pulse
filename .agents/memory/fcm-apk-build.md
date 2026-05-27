---
name: FCM + GitHub Actions APK build
description: Status of FCM native push and Android APK build pipeline as of May 2026
---

## Status: APK build passing ✅, Play Store signing pending

### What's done
- Firebase Admin SDK initialised server-side (`FIREBASE_SERVICE_ACCOUNT_JSON` secret = full service account JSON)
- FCM fan-out wired into all push dispatch points (live incident, panic, severity alerts, panic ack)
- GitHub Actions workflow `.github/workflows/build-apk.yml` builds debug APK on every push to main
- Signed release build wired to 4 GitHub secrets (`KEYSTORE_BASE64`, `KEYSTORE_PASSWORD`, `KEY_ALIAS`, `KEY_PASSWORD`) — secrets not yet set
- GitHub repo: `https://github.com/IntelAfriSouthAfrica/omt-pulse.git` (org: IntelAfriSouthAfrica)
- `attached_assets/` added to `.gitignore` after Firebase service account JSONs were accidentally committed there

### Fixes applied during build setup
- Removed `applicationIdSuffix ".debug"` from `android/app/build.gradle` (caused google-services.json mismatch)
- Changed workflow JDK from 17 → 21 (Capacitor requires Java 21 source compatibility)
- Workflow `if:` conditions use `env.KEYSTORE_BASE64 != ''` not `secrets.KEYSTORE_BASE64` (secrets context invalid in if expressions)

### Next session: Play Store publishing
1. Generate a release keystore (keytool)
2. Base64-encode it and add 4 secrets to GitHub repo settings
3. Confirm signed release APK builds in Actions
4. Create Google Play Developer account ($25 one-time)
5. Submit listing with screenshots + privacy policy

### Play Store plan
- Android only for now; iOS PWA stays as-is
- No feature changes until Play Store launch is stable
- After launch: improve push notifications + maps

**Why:**
- User: Play Store is the target distribution (no sideload friction, auto-updates, trusted install)
