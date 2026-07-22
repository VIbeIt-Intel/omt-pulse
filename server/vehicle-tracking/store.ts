import { eq, sql, asc, and, gte, lt, inArray, isNotNull } from "drizzle-orm";
import { db } from "../storage";
import { commands, trackerDevices, trackerPositions } from "@shared/schema";
import type { ParsedTrackerPosition } from "./types";
import { KNOWN_TRACKER_DEVICES } from "./known-devices";

const LOG = "vehicle-tracker:store";
/** Ignore GPS jitter below ~15 m when accumulating path distance. */
const MIN_GPS_SEGMENT_KM = 0.015;
/** Gaps longer than this between fixes are not counted as continuous travel. */
const MAX_GPS_SEGMENT_GAP_MS = 15 * 60 * 1000;

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const r = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

async function resolveCommandLink(imei: string): Promise<{ organizationId: string; commandId: number } | null> {
  const config = KNOWN_TRACKER_DEVICES[imei];
  if (!config) return null;

  const targetName = config.targetCommandName.trim();

  const exact = await db.execute<{ id: number; organization_id: string }>(sql`
    SELECT id, organization_id FROM commands
    WHERE lower(trim(name)) = lower(${targetName})
    ORDER BY is_central DESC
    LIMIT 1
  `);
  if (exact.rows[0]) {
    return { organizationId: exact.rows[0].organization_id, commandId: exact.rows[0].id };
  }

  const fuzzy = await db.execute<{ id: number; organization_id: string }>(sql`
    SELECT id, organization_id FROM commands
    WHERE name ILIKE ${"%" + targetName + "%"}
    ORDER BY is_central DESC
    LIMIT 1
  `);
  if (fuzzy.rows[0]) {
    return { organizationId: fuzzy.rows[0].organization_id, commandId: fuzzy.rows[0].id };
  }

  console.warn(
    `[${LOG}] no command named "${targetName}" for IMEI ${imei} — device will register without command link`,
  );
  return null;
}

async function defaultOrganizationId(): Promise<string | null> {
  const row = await db.execute<{ id: string }>(sql`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  return row.rows[0]?.id ?? null;
}

export async function ensureTrackerDevice(imei: string, protocol: string): Promise<number> {
  const existing = await db
    .select({ id: trackerDevices.id })
    .from(trackerDevices)
    .where(eq(trackerDevices.imei, imei))
    .limit(1);

  if (existing[0]) {
    await db
      .update(trackerDevices)
      .set({ lastSeenAt: new Date(), protocol })
      .where(eq(trackerDevices.id, existing[0].id));
    return existing[0].id;
  }

  const link = await resolveCommandLink(imei);
  let organizationId = link?.organizationId ?? null;
  if (!organizationId) {
    organizationId = await defaultOrganizationId();
  }
  if (!organizationId) {
    throw new Error(`cannot register tracker ${imei}: no organization in database`);
  }

  const config = KNOWN_TRACKER_DEVICES[imei];
  const inserted = await db
    .insert(trackerDevices)
    .values({
      imei,
      organizationId,
      commandId: link?.commandId ?? null,
      protocol,
      label: config?.note ?? null,
    })
    .returning({ id: trackerDevices.id });

  const deviceId = inserted[0]!.id;
  const commandName = link
    ? (await db.select({ name: commands.name }).from(commands).where(eq(commands.id, link.commandId)).limit(1))[0]
        ?.name
    : null;

  console.log(
    `[${LOG}] registered device IMEI=${imei} id=${deviceId}` +
      (commandName ? ` → command "${commandName}"` : ""),
  );

  return deviceId;
}

function trackerDayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function computeOdometerMetrics(
  deviceId: number,
  mileageKm: number,
  recordedAt: Date,
  previous: {
    lastPositionAt: Date | null;
    todayOdometerDistanceKm: number | null;
  },
): Promise<{ todayOdometerDistanceKm: number; lastTripDistanceKm?: number }> {
  const startOfDay = new Date(recordedAt);
  startOfDay.setUTCHours(0, 0, 0, 0);

  const [firstToday] = await db
    .select({ mileageKm: trackerPositions.mileageKm })
    .from(trackerPositions)
    .where(
      and(
        eq(trackerPositions.deviceId, deviceId),
        gte(trackerPositions.recordedAt, startOfDay),
        isNotNull(trackerPositions.mileageKm),
      ),
    )
    .orderBy(asc(trackerPositions.recordedAt))
    .limit(1);

  const firstMileage = firstToday?.mileageKm ?? mileageKm;
  const todayOdometerDistanceKm = Math.max(0, mileageKm - firstMileage);

  let lastTripDistanceKm: number | undefined;
  if (previous.lastPositionAt) {
    const prevDay = trackerDayKey(previous.lastPositionAt);
    const newDay = trackerDayKey(recordedAt);
    if (prevDay !== newDay && previous.todayOdometerDistanceKm != null && previous.todayOdometerDistanceKm > 0) {
      lastTripDistanceKm = previous.todayOdometerDistanceKm;
    }
  }

  return { todayOdometerDistanceKm, lastTripDistanceKm };
}

function nextTodayGpsDistanceKm(
  previous: {
    lastLat: number | null;
    lastLng: number | null;
    lastPositionAt: Date | null;
    todayGpsDistanceKm: number | null;
  },
  position: ParsedTrackerPosition,
): number {
  let todayGps = previous.todayGpsDistanceKm ?? 0;
  if (previous.lastPositionAt && trackerDayKey(previous.lastPositionAt) !== trackerDayKey(position.recordedAt)) {
    todayGps = 0;
  }
  if (position.gpsValid === false) return todayGps;
  if (previous.lastLat == null || previous.lastLng == null || !previous.lastPositionAt) return todayGps;

  const gapMs = position.recordedAt.getTime() - previous.lastPositionAt.getTime();
  if (gapMs <= 0 || gapMs > MAX_GPS_SEGMENT_GAP_MS) return todayGps;

  const segmentKm = haversineKm(
    previous.lastLat,
    previous.lastLng,
    position.latitude,
    position.longitude,
  );
  if (segmentKm < MIN_GPS_SEGMENT_KM) return todayGps;
  return todayGps + segmentKm;
}

/** Path distance (km) for UTC today from stored GPS fixes — used when odometer packets are missing. */
export async function computeTodayGpsPathDistances(
  deviceIds: number[],
  day: Date = new Date(),
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (deviceIds.length === 0) return result;

  const startOfDay = new Date(day);
  startOfDay.setUTCHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setUTCDate(endOfDay.getUTCDate() + 1);

  const rows = await db
    .select({
      deviceId: trackerPositions.deviceId,
      latitude: trackerPositions.latitude,
      longitude: trackerPositions.longitude,
      recordedAt: trackerPositions.recordedAt,
      gpsValid: trackerPositions.gpsValid,
    })
    .from(trackerPositions)
    .where(
      and(
        inArray(trackerPositions.deviceId, deviceIds),
        gte(trackerPositions.recordedAt, startOfDay),
        lt(trackerPositions.recordedAt, endOfDay),
      ),
    )
    .orderBy(asc(trackerPositions.recordedAt));

  const lastByDevice = new Map<number, { lat: number; lng: number; at: Date }>();
  for (const row of rows) {
    if (row.gpsValid === false) continue;
    const prev = lastByDevice.get(row.deviceId);
    if (prev) {
      const gapMs = row.recordedAt.getTime() - prev.at.getTime();
      if (gapMs > 0 && gapMs <= MAX_GPS_SEGMENT_GAP_MS) {
        const segmentKm = haversineKm(prev.lat, prev.lng, row.latitude, row.longitude);
        if (segmentKm >= MIN_GPS_SEGMENT_KM) {
          result.set(row.deviceId, (result.get(row.deviceId) ?? 0) + segmentKm);
        }
      }
    }
    lastByDevice.set(row.deviceId, { lat: row.latitude, lng: row.longitude, at: row.recordedAt });
  }

  return result;
}

export async function saveTrackerPosition(
  imei: string,
  protocol: string,
  position: ParsedTrackerPosition,
): Promise<void> {
  const deviceId = await ensureTrackerDevice(imei, protocol);

  const device = (
    await db
      .select({
        organizationId: trackerDevices.organizationId,
        lastLat: trackerDevices.lastLat,
        lastLng: trackerDevices.lastLng,
        lastPositionAt: trackerDevices.lastPositionAt,
        todayOdometerDistanceKm: trackerDevices.todayOdometerDistanceKm,
        todayGpsDistanceKm: trackerDevices.todayGpsDistanceKm,
      })
      .from(trackerDevices)
      .where(eq(trackerDevices.id, deviceId))
      .limit(1)
  )[0]!;

  await db.insert(trackerPositions).values({
    deviceId,
    organizationId: device.organizationId,
    latitude: position.latitude,
    longitude: position.longitude,
    speedKph: position.speedKph,
    heading: position.heading,
    ignitionOn: position.ignitionOn,
    mileageKm: position.mileageKm,
    gpsValid: position.gpsValid,
    packetType: position.packetType,
    recordedAt: position.recordedAt,
  });

  const devicePatch: {
    lastLat: number;
    lastLng: number;
    lastSpeedKph: number | null;
    lastHeading: number | null;
    lastIgnitionOn: boolean | null;
    lastMileageKm: number | null;
    lastGpsValid: boolean;
    lastPositionAt: Date;
    lastSeenAt: Date;
    todayOdometerDistanceKm?: number;
    todayGpsDistanceKm?: number;
    lastTripDistanceKm?: number;
  } = {
    lastLat: position.latitude,
    lastLng: position.longitude,
    lastSpeedKph: position.speedKph,
    lastHeading: position.heading,
    lastIgnitionOn: position.ignitionOn,
    lastGpsValid: position.gpsValid,
    lastPositionAt: position.recordedAt,
    lastSeenAt: new Date(),
    todayGpsDistanceKm: nextTodayGpsDistanceKm(device, position),
  };

  // Only overwrite odometer when the tracker actually sent mileage — keep manual entries.
  if (position.mileageKm != null) {
    devicePatch.lastMileageKm = position.mileageKm;
    const odometerMetrics = await computeOdometerMetrics(deviceId, position.mileageKm, position.recordedAt, {
      lastPositionAt: device.lastPositionAt,
      todayOdometerDistanceKm: device.todayOdometerDistanceKm,
    });
    devicePatch.todayOdometerDistanceKm = odometerMetrics.todayOdometerDistanceKm;
    if (odometerMetrics.lastTripDistanceKm != null) {
      devicePatch.lastTripDistanceKm = odometerMetrics.lastTripDistanceKm;
    }
  }

  await db
    .update(trackerDevices)
    .set(devicePatch)
    .where(eq(trackerDevices.id, deviceId));

  void import("../fleet-alerts/detection")
    .then(({ evaluateFleetAlertsOnPosition }) => evaluateFleetAlertsOnPosition(deviceId, position))
    .catch((err) => {
      console.error("[fleet-alerts] position evaluation failed:", err instanceof Error ? err.message : err);
    });
}

export async function saveTrackerIgnition(
  imei: string,
  protocol: string,
  ignitionOn: boolean,
): Promise<void> {
  const deviceId = await ensureTrackerDevice(imei, protocol);
  await db
    .update(trackerDevices)
    .set({ lastIgnitionOn: ignitionOn, lastSeenAt: new Date() })
    .where(eq(trackerDevices.id, deviceId));
}
