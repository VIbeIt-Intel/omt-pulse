---
name: Android nav-mode tilt
description: Why setCamera animate:false breaks tilt on the @capacitor/google-maps Android SDK
---

On `@capacitor/google-maps` v8 Android, `setCamera({animate:false})` routes to Kotlin `moveCamera(CameraUpdateFactory.newCameraPosition(...))` which silently drops the tilt component — the camera moves to the new target/zoom/bearing but stays flat. `animate:true` routes to `animateCamera(...)` which honors tilt.

**Why:** Discovered after v70/v71 patches (gesture lock + 200ms animateCamera patch + 400ms tilt-keeper) still left nav-mode flat. The initial nav-mode entry used `animate:false` for "instant tilt", but that path never applied tilt at all — and the tilt-keeper alone wasn't recovering it reliably on real devices.

**How to apply:** Any setCamera call that sets tilt must use `animate:true` with a short `animationDuration` (100ms works) to avoid fighting subsequent ticks. Never use `animate:false` for a tilted camera position on Android.

Also relevant: `CapacitorMap` native readiness timeout was bumped 3s→8s in v72 because slower Android devices legitimately take 4–6s for Maps SDK warm-up + GCP auth, and the old 3s cap was silently falling back to the WebView JS API map (which renders flat regardless of tilt). The NATIVE/WEB MAP badge in the GPS chip surfaces this fallback so it can't hide silently again.
