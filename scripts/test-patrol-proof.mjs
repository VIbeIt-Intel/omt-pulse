/**
 * Quick sanity checks for patrol hard-geofence and distance helpers.
 * Run: node scripts/test-patrol-proof.mjs
 */
import assert from "node:assert/strict";

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
  const radius = input.geofenceRadiusM ?? 40;
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
  if (!hasCheckpoint) {
    return {
      distanceM: null,
      withinGeofence: null,
      flagged: !hasUser,
      blockReason: hasUser ? null : "GPS is required to clock this checkpoint.",
    };
  }
  if (!hasUser) {
    return {
      distanceM: null,
      withinGeofence: false,
      flagged: true,
      blockReason: "GPS is required to clock this checkpoint.",
    };
  }
  const distanceM = haversineM(
    { lat: input.userLat, lng: input.userLng },
    { lat: input.checkpointLat, lng: input.checkpointLng },
  );
  const withinGeofence = distanceM <= radius;
  const inaccurate =
    input.accuracyM != null && Number.isFinite(input.accuracyM) && input.accuracyM > radius;
  let blockReason = null;
  if (!withinGeofence) {
    blockReason = `You are ${Math.round(distanceM)} m from this checkpoint — move within ${Math.round(radius)} m to clock it.`;
  } else if (inaccurate) {
    blockReason = `GPS accuracy is ±${Math.round(input.accuracyM)} m — wait for a clearer fix (need ≤ ${Math.round(radius)} m).`;
  }
  return {
    distanceM: Math.round(distanceM * 10) / 10,
    withinGeofence,
    flagged: !withinGeofence || inaccurate,
    blockReason,
  };
}

function minTravelSecondsBetween(from, to) {
  const dist = haversineM(from, to);
  if (dist < 25) return 0;
  const seconds = Math.ceil(dist / 1.5);
  return Math.min(180, Math.max(15, seconds));
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

// Same point — within 40 m
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: -25.83,
    userLng: 28.42,
  });
  assert.equal(r.withinGeofence, true);
  assert.equal(r.flagged, false);
  assert.equal(r.blockReason, null);
  assert.ok((r.distanceM ?? 0) < 1);
}

// ~111 m away — blocked
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: -25.829,
    userLng: 28.42,
    geofenceRadiusM: 40,
  });
  assert.equal(r.withinGeofence, false);
  assert.equal(r.flagged, true);
  assert.ok(r.blockReason);
  assert.ok((r.distanceM ?? 0) > 40);
}

// 48 m away with old soft 75 m would pass — new 40 m hard radius blocks
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: -25.82957,
    userLng: 28.42,
    geofenceRadiusM: 40,
  });
  assert.equal(r.withinGeofence, false);
  assert.ok(r.blockReason);
}

// Missing GPS blocked
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: null,
    userLng: null,
  });
  assert.equal(r.withinGeofence, false);
  assert.equal(r.flagged, true);
  assert.ok(r.blockReason);
}

// Poor accuracy blocked even when near pin
{
  const r = evaluateCheckpointProof({
    checkpointLat: -25.83,
    checkpointLng: 28.42,
    userLat: -25.83,
    userLng: 28.42,
    accuracyM: 80,
    geofenceRadiusM: 40,
  });
  assert.equal(r.withinGeofence, true);
  assert.equal(r.flagged, true);
  assert.ok(r.blockReason);
}

// Rapid travel between distant pins needs wait time
{
  const secs = minTravelSecondsBetween(
    { lat: -25.81973, lng: 28.42413 },
    { lat: -25.81898, lng: 28.42457 },
  );
  assert.ok(secs >= 15, `expected travel wait, got ${secs}`);
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
