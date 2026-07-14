/**
 * Panic SOS location capture only — not used by live-incident flows.
 * Called from a user tap on SOS; WebView treats that as a permission gesture.
 */

export type PanicLocationIssue = "unsupported" | "denied" | "unavailable" | "timeout";

export type PanicLocationResult = {
  lat?: number;
  lng?: number;
  issue?: PanicLocationIssue;
};

function getCurrentPositionOnce(options: PositionOptions): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

function issueFromGeolocationCode(code: number | undefined): PanicLocationIssue {
  if (code === 1) return "denied";
  if (code === 3) return "timeout";
  return "unavailable";
}

/**
 * User-tap probe for Allow Location — fresh fix only (maximumAge 0).
 * Prompt: ~3s so the permission dialog can be answered; granted/GPS-off: ~1.5s then Settings.
 */
export async function probeLocationForAllowTap(
  permissionHint: "granted" | "denied" | "prompt" | "unsupported" = "prompt",
): Promise<PanicLocationResult> {
  if (!navigator.geolocation) {
    return { issue: "unsupported" };
  }
  // Indoor / post-toggle cold starts often need longer than 1.5s.
  const timeoutMs = permissionHint === "prompt" ? 6_000 : 8_000;
  try {
    const pos = await getCurrentPositionOnce({
      enableHighAccuracy: false,
      timeout: timeoutMs,
      maximumAge: 15_000,
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as GeolocationPositionError).code
        : undefined;
    if (code === 1) return { issue: "denied" };
    return { issue: issueFromGeolocationCode(code) };
  }
  return { issue: "unavailable" };
}

/** @deprecated Use probeLocationForAllowTap — kept for callers that need a longer first-time window. */
export async function probeLocationPermissionGesture(): Promise<PanicLocationResult> {
  return probeLocationForAllowTap("prompt");
}

/**
 * Minimal probe when user taps Allow Location — fail fast to the right Settings screen.
 * Permission denied returns immediately; cached GPS within 60s succeeds without waiting.
 */
export async function probeLocationAccess(): Promise<PanicLocationResult> {
  if (!navigator.geolocation) {
    return { issue: "unsupported" };
  }
  try {
    const pos = await getCurrentPositionOnce({
      enableHighAccuracy: false,
      timeout: 1_000,
      maximumAge: 60_000,
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as GeolocationPositionError).code
        : undefined;
    if (code === 1) return { issue: "denied" };
    return { issue: issueFromGeolocationCode(code) };
  }
  return { issue: "unavailable" };
}

/**
 * Fast UI check only (~3s) — use when refreshing banners after Settings, not when sending SOS.
 */
export async function quickPanicLocationCheck(): Promise<PanicLocationResult> {
  if (!navigator.geolocation) {
    return { issue: "unsupported" };
  }
  try {
    const pos = await getCurrentPositionOnce({
      enableHighAccuracy: false,
      timeout: 3_000,
      maximumAge: 60_000,
    });
    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  } catch (err) {
    const code =
      typeof err === "object" && err !== null && "code" in err
        ? (err as GeolocationPositionError).code
        : undefined;
    if (code === 1) return { issue: "denied" };
  }
  return { issue: "unavailable" };
}

/** Best-effort GPS for panic: high-accuracy first, then a faster fallback. */
export async function acquirePanicLocation(): Promise<PanicLocationResult> {
  if (!navigator.geolocation) {
    return { issue: "unsupported" };
  }

  const attempts: PositionOptions[] = [
    { enableHighAccuracy: true, timeout: 18_000, maximumAge: 0 },
    { enableHighAccuracy: false, timeout: 12_000, maximumAge: 30_000 },
  ];

  let lastCode: number | undefined;
  for (const opts of attempts) {
    try {
      const pos = await getCurrentPositionOnce(opts);
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return { lat, lng };
      }
    } catch (err) {
      lastCode =
        typeof err === "object" && err !== null && "code" in err
          ? (err as GeolocationPositionError).code
          : undefined;
      if (lastCode === 1) {
        return { issue: "denied" };
      }
    }
  }

  return { issue: issueFromGeolocationCode(lastCode) };
}

/** User-facing hint when panic is sent without coordinates. */
export function panicLocationWarning(issue?: PanicLocationIssue): string {
  switch (issue) {
    case "denied":
      return "Location not shared — allow Location for OMT Pulse in your phone settings so responders can see where you are.";
    case "timeout":
      return "GPS timed out — alert sent without your position. Turn on Location and wait a few seconds before SOS if you can.";
    case "unsupported":
      return "This device cannot report GPS — alert sent without your position.";
    case "unavailable":
    default:
      return "Location unavailable — alert sent without your position. Turn on Location in phone settings for map tracking.";
  }
}

export function hasPanicCoordinates(loc: PanicLocationResult): loc is PanicLocationResult & { lat: number; lng: number } {
  return typeof loc.lat === "number" && typeof loc.lng === "number";
}

export function appendPanicLocationNote(base: string, loc: PanicLocationResult): string {
  if (hasPanicCoordinates(loc)) return base;
  return `${base} ${panicLocationWarning(loc.issue)}`;
}
