/**
 * Minimal assertions for fleet trip segmentation / stop events / distance prefs.
 * Run: npx tsx scripts/assert-fleet-intelligence.tsx
 */
import {
  detectTripMapEvents,
  preferredTodayDistanceKm,
  segmentTripLegs,
  type TripPosition,
} from "../client/src/lib/fleet-intelligence.ts";

let passed = 0;
let failed = 0;

function assert(cond: boolean, message: string) {
  if (cond) {
    passed += 1;
    console.log(`  PASS  ${message}`);
  } else {
    failed += 1;
    console.error(`  FAIL  ${message}`);
  }
}

function pt(
  iso: string,
  opts: { lat?: number; lng?: number; speed?: number | null; ignition?: boolean | null } = {},
): TripPosition {
  const { lat = -26.2, lng = 28.04, speed = 0, ignition = true } = opts;
  return {
    latitude: lat,
    longitude: lng,
    speedKph: speed,
    heading: 0,
    ignitionOn: ignition,
    recordedAt: iso,
    gpsValid: true,
  };
}

/** Drive ~1 km east along a fixed latitude (≈0.009° lon per km near -26°). */
function driveSegment(startIso: string, minutes: number, startLng: number, kph = 40): TripPosition[] {
  const start = new Date(startIso).getTime();
  const points: TripPosition[] = [];
  const stepMin = 1;
  for (let m = 0; m <= minutes; m += stepMin) {
    const km = (kph * m) / 60;
    const lng = startLng + km * 0.009;
    points.push(
      pt(new Date(start + m * 60_000).toISOString(), {
        lat: -26.2,
        lng,
        speed: kph,
      }),
    );
  }
  return points;
}

function idleAt(iso: string, minutes: number, lat: number, lng: number): TripPosition[] {
  const start = new Date(iso).getTime();
  const points: TripPosition[] = [];
  for (let m = 0; m <= minutes; m += 1) {
    points.push(
      pt(new Date(start + m * 60_000).toISOString(), {
        lat,
        lng,
        speed: 0,
      }),
    );
  }
  return points;
}

console.log("\n1) Overnight idle then morning drive → trip starts in morning");
{
  const overnight = idleAt("2026-07-22T00:30:00.000Z", 6 * 60, -26.2, 28.04); // parked till ~06:30
  const morning = driveSegment("2026-07-22T07:00:00.000Z", 20, 28.04, 40);
  const legs = segmentTripLegs([...overnight, ...morning]);
  assert(legs.length === 1, `expected 1 trip leg, got ${legs.length}`);
  const startHour = new Date(legs[0]!.startAt).getUTCHours();
  assert(startHour === 7, `trip start hour should be 7 UTC, got ${startHour} (${legs[0]?.startAt})`);
  assert(
    !legs[0]!.startAt.startsWith("2026-07-22T00:"),
    "trip must not start during overnight idle",
  );
  const overnightStops = detectTripMapEvents([...overnight, ...morning]).filter((e) => e.kind === "stop");
  const leadingOvernight = overnightStops.some((s) => s.at.startsWith("2026-07-22T00:"));
  assert(!leadingOvernight, "overnight pre-departure park must not count as a stop");
}

console.log("\n2) Park 3+ min ends trip; short 1 min idle does not");
{
  const trip1 = driveSegment("2026-07-22T08:00:00.000Z", 10, 28.04, 40);
  const last1 = trip1[trip1.length - 1]!;
  const shortIdle = idleAt(
    new Date(new Date(last1.recordedAt).getTime() + 60_000).toISOString(),
    1,
    last1.latitude,
    last1.longitude,
  );
  const lastIdleShort = shortIdle[shortIdle.length - 1]!;
  const continueSame = driveSegment(
    new Date(new Date(lastIdleShort.recordedAt).getTime() + 60_000).toISOString(),
    8,
    lastIdleShort.longitude,
    40,
  );
  const withShortIdle = segmentTripLegs([...trip1, ...shortIdle, ...continueSame]);
  assert(
    withShortIdle.length === 1,
    `1 min idle should keep one trip, got ${withShortIdle.length}`,
  );

  const tripA = driveSegment("2026-07-22T10:00:00.000Z", 10, 28.1, 40);
  const lastA = tripA[tripA.length - 1]!;
  const longPark = idleAt(
    new Date(new Date(lastA.recordedAt).getTime() + 60_000).toISOString(),
    4,
    lastA.latitude,
    lastA.longitude,
  );
  const lastPark = longPark[longPark.length - 1]!;
  const tripB = driveSegment(
    new Date(new Date(lastPark.recordedAt).getTime() + 60_000).toISOString(),
    10,
    lastPark.longitude,
    40,
  );
  const withLongPark = segmentTripLegs([...tripA, ...longPark, ...tripB]);
  assert(
    withLongPark.length === 2,
    `3+ min park should split into 2 trips, got ${withLongPark.length}`,
  );
}

console.log("\n3) Stop events have until + durationMinutes");
{
  const move = driveSegment("2026-07-22T12:00:00.000Z", 5, 28.2, 35);
  const last = move[move.length - 1]!;
  const park = idleAt(
    new Date(new Date(last.recordedAt).getTime() + 60_000).toISOString(),
    5,
    last.latitude,
    last.longitude,
  );
  const resume = driveSegment(
    new Date(new Date(park[park.length - 1]!.recordedAt).getTime() + 60_000).toISOString(),
    3,
    last.longitude,
    35,
  );
  const events = detectTripMapEvents([...move, ...park, ...resume]);
  const stops = events.filter((e) => e.kind === "stop");
  assert(stops.length >= 1, `expected ≥1 stop, got ${stops.length}`);
  const stop = stops[0]!;
  assert(typeof stop.until === "string" && stop.until.length > 0, `stop.until present (${stop.until})`);
  assert(
    typeof stop.durationMinutes === "number" && Number.isFinite(stop.durationMinutes),
    `stop.durationMinutes finite (${stop.durationMinutes})`,
  );
  assert(stop.durationMinutes! >= 3, `stop duration ≥3 min, got ${stop.durationMinutes}`);
}

console.log("\n4) preferredTodayDistanceKm preference order");
{
  assert(
    preferredTodayDistanceKm({
      todayDistanceKm: 12.5,
      todayOdometerDistanceKm: 99,
      todayGpsDistanceKm: 50,
    }) === 12.5,
    "prefers todayDistanceKm first",
  );
  assert(
    preferredTodayDistanceKm({
      todayDistanceKm: null,
      todayOdometerDistanceKm: 8.2,
      todayGpsDistanceKm: 50,
    }) === 8.2,
    "falls back to todayOdometerDistanceKm",
  );
  assert(
    preferredTodayDistanceKm({
      todayDistanceKm: null,
      todayOdometerDistanceKm: null,
      todayGpsDistanceKm: 3.4,
    }) === 3.4,
    "falls back to todayGpsDistanceKm when > 0",
  );
  assert(
    preferredTodayDistanceKm({
      todayDistanceKm: null,
      todayOdometerDistanceKm: null,
      todayGpsDistanceKm: 0,
    }) === null,
    "rejects todayGpsDistanceKm === 0",
  );
  assert(
    preferredTodayDistanceKm({
      todayDistanceKm: Number.NaN,
      todayOdometerDistanceKm: Number.NaN,
      todayGpsDistanceKm: Number.NaN,
    }) === null,
    "NaN values → null",
  );
}

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
