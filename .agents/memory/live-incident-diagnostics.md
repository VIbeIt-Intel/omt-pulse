---
name: Live-incident diagnostics removal (RESOLVED)
description: Debug/dead code in live-incident.tsx was removed in the pre-Play-Store cleanup pass. Kept for the lessons below.
---

**Status:** RESOLVED — the on-screen MAP DEBUG overlay and the dead `{false && ...}` GPS status row were removed from `live-incident.tsx` during the Phase-1 pre-Play-Store cleanup. No follow-up needed unless re-introduced for field testing.

**Lessons worth keeping:**

1. The debug overlay's `onCameraIdle` mirroring was gated behind `debugVisibleRef` specifically because the ~400 ms tilt-keeper interval would otherwise cause a re-render storm in nav mode that resets the step-tracking interval, watchPosition, and voice. If a future on-device diagnostic is added, never let it call `setState` on every camera-idle in nav mode — gate it or use a ref.

2. `CapacitorMap.addMarker` deliberately does NOT forward `tintColor` (see comment in `CapacitorMap.tsx`): the native `@capacitor/google-maps` plugin needs `{r,g,b,a}` 0-255, and the wrapper strips it. Callers still pass `tintColor` (pre-existing, harmless, ignored at runtime) — it shows up as a `tsc` error but the build path (`tsx script/build.ts`, esbuild) never runs tsc so it does not break the APK.
