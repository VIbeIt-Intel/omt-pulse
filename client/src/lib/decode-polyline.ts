/** Lat/lng point for map polylines. */
export type LatLngPoint = { lat: number; lng: number };

/**
 * Decode a Google encoded polyline string into coordinates.
 * Standalone implementation — does not require the Maps geometry library.
 * @see https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodeGooglePolyline(encoded: string): LatLngPoint[] {
  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }

  return points;
}

/** Extract encoded polyline string from Directions API shapes (string or { points }). */
export function encodedPolylinePoints(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object" && "points" in value) {
    const pts = (value as { points?: unknown }).points;
    if (typeof pts === "string" && pts.length > 0) return pts;
  }
  return null;
}

function decodeFlexible(
  encoded: string,
  mapsDecodePath?: (enc: string) => Array<{ lat: () => number; lng: () => number }>,
): LatLngPoint[] {
  if (typeof mapsDecodePath === "function") {
    try {
      const decoded = mapsDecodePath(encoded);
      if (decoded.length >= 2) {
        return decoded.map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
      }
    } catch {
      /* fall through */
    }
  }
  return decodeGooglePolyline(encoded);
}

function appendPath(target: LatLngPoint[], segment: LatLngPoint[]) {
  if (segment.length === 0) return;
  if (target.length === 0) {
    target.push(...segment);
    return;
  }
  const last = target[target.length - 1];
  const first = segment[0];
  const sameJunction =
    Math.abs(last.lat - first.lat) < 1e-6 && Math.abs(last.lng - first.lng) < 1e-6;
  target.push(...(sameJunction ? segment.slice(1) : segment));
}

/**
 * Build a road-following path from a Directions leg.
 * Per-step polylines are preferred — overview_path is often degenerate (2 points)
 * inside Capacitor WebView even when turn-by-turn steps are correct.
 */
export function pathFromDirectionsLeg(leg: google.maps.DirectionsLeg): LatLngPoint[] {
  const mapsDecodePath = (google.maps as any).geometry?.encoding?.decodePath as
    | ((enc: string) => Array<{ lat: () => number; lng: () => number }>)
    | undefined;

  const fromSteps: LatLngPoint[] = [];
  for (const step of leg.steps ?? []) {
    const enc = encodedPolylinePoints((step as { polyline?: unknown }).polyline);
    if (enc) {
      appendPath(fromSteps, decodeFlexible(enc, mapsDecodePath));
      continue;
    }
    if (step.path && step.path.length > 0) {
      appendPath(
        fromSteps,
        step.path.map((ll) => ({ lat: ll.lat(), lng: ll.lng() })),
      );
    }
  }
  if (fromSteps.length >= 2) return fromSteps;
  return [];
}

/** Full route path: step polylines first, then overview encoded polyline, then overview_path. */
export function pathFromDirectionsRoute(
  route: google.maps.DirectionsRoute,
  leg: google.maps.DirectionsLeg,
): LatLngPoint[] {
  const mapsDecodePath = (google.maps as any).geometry?.encoding?.decodePath as
    | ((enc: string) => Array<{ lat: () => number; lng: () => number }>)
    | undefined;

  const fromSteps = pathFromDirectionsLeg(leg);
  if (fromSteps.length >= 2) return fromSteps;

  const overviewEnc = encodedPolylinePoints((route as { overview_polyline?: unknown }).overview_polyline);
  if (overviewEnc) {
    const decoded = decodeFlexible(overviewEnc, mapsDecodePath);
    if (decoded.length >= 2) return decoded;
  }

  const overviewPath = route.overview_path ?? [];
  if (overviewPath.length >= 2) {
    return overviewPath.map((ll) => ({ lat: ll.lat(), lng: ll.lng() }));
  }

  return fromSteps;
}
