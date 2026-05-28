---
name: Android Google Maps renderer
description: Why tilt may silently not render on Capacitor Google Maps Android
---

The Google Maps Android SDK has two renderers: **LEGACY** (raster tiles) and **LATEST** (vector). Tilt is silently ignored in LEGACY — the camera tilt value is accepted but the rendered map stays flat top-down.

`@capacitor/google-maps` v8 already calls `MapsInitializer.initialize(LATEST, callback)` in its `Plugin.load()` (CapacitorGoogleMapsPlugin.kt line 47). However:
- `LATEST` is only a **preference** — Play Services can silently fall back to LEGACY if the device/install can't load the vector renderer
- The callback's `onMapsSdkInitialized(renderer)` reports the **actual** renderer chosen, only via `Logger.debug` with tag "Capacitor Google Maps"
- Without adb access, you cannot tell from the device whether you got LATEST or LEGACY

**Why:** Hours of debugging flat tilt on a Samsung A06 (A065F) with v70-v72 patches all in place (gesture lock, 200ms animateCamera, animate:true entry, tilt-keeper) — every code path was correct but tilt still didn't render. Suspected renderer fallback to LEGACY.

**How to apply:** Calling `MapsInitializer.initialize(LATEST, this)` again from `MainActivity.onCreate` (before the plugin loads) is harmless and adds an early `Log.d("OMTPatch", ...)` line that can be greppped in logcat. If tilt still doesn't render after confirming LATEST is active, the next diagnostic step is to add a plugin method that returns the renderer enum to JS so it can be shown in the on-screen debug overlay.
