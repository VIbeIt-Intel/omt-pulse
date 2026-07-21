/**
 * Quick sanity checks for patrol soft-geofence and distance helpers.
 * Run: node scripts/test-patrol-proof.mjs
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

// Compile-time TS helpers are imported via tsx-style dynamic transpile isn't available;
// duplicate the core math here so the script stays dependency-light and mirrors shared/patrol-proof.ts.
function haversineM(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sl = Math.sin(dLat / 2);
  const sln = Math.sin(dLng / 2);
  const x =
    sl * sl +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      sln *
      sln;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

function evaluateCheckpointProof(input) {
  const radius = input.geofenceRadiusM ?? 75;
  const hasCheckpoint =
    input.checkpointLat != null &&
    input.checkpointLng != null &&
    Number.isFinite(input.checkpointLat) &&
    Number.isFinite(input.checkpointLng);
  const hasUser =
    input.userLat != null &&
    input.userLng != null &&
    Number.isFinite(input.userLat) &&
    Number.isFinite(input.userLng);
  if (!hasCheckpoint) return { distanceM: null, withinGeofence: null, flagged: !hasUser };
  if (!hasUser) return { distanceM: null, withinGeofence: false, flagged: true };
  const distanceM = haversineM(
    { lat: input.userLat, lng: input.userLng },
    { lat: input.checkpointLat, lng: input.checkpointLng },
  );
  const withinGeofence = distanceM <= radius;
  return {
    distanceM: Math.round(distanceM * 10) / 10,
    withinGeofence,
    flagged: !withinGeofence,
  };
}

function pathDistanceM(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineM(
      { lat: points[i - 1].latitude, lng: points[i - 1].longitude },
      { lat: points[i].latitude, lng: points[i].longitude },
    );
  }
  return Math.round(total * 10) / 10;
}

// ~0 m — same point
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: -25.83,
    userLng: 28.42,
  });
  assert.equal(r.withinGeofence, true);
  assert.equal(r.flagged, false);
  assert.ok((r.distanceM ?? 0) < 1);
}

// ~111 m north at equator-ish (1e-3 deg lat ≈ 111 m)
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: -25.829,
    userLng: 28.42,
    geofenceRadiusM: 75,
  });
  assert.equal(r.withinGeofence, false);
  assert.equal(r.flagged, true);
  assert.ok((r.distanceM ?? 0) > 75);
}

// Missing GPS soft-fails
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: null,
    userLng: null,
  });
  assert.equal(r.withinGeofence, false);
  assert.equal(r.flagged, true);
}

// Stationary path ≈ 0
{
  const d = pathDistanceM([
    { latitude: -25.83, longitude: 28.42 },
    { latitude: -25.83, longitude: 28.42 },
    { latitude: -25.83001, longitude: 28.42 },
  ]);
  assert.ok(d < 5, `expected near-zero distance, got ${d}`);
}

console.log("patrol-proof checks passed");
void createRequire;
void assert;
