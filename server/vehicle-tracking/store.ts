import { eq, sql } from "drizzle-orm";
import { db } from "../storage";
import { commands, trackerDevices, trackerPositions } from "@shared/schema";
import type { ParsedTrackerPosition } from "./types";
import { KNOWN_TRACKER_DEVICES } from "./known-devices";

const LOG = "vehicle-tracker:store";

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

export async function saveTrackerPosition(
  imei: string,
  protocol: string,
  position: ParsedTrackerPosition,
): Promise<void> {
  const deviceId = await ensureTrackerDevice(imei, protocol);

  const device = (
    await db
      .select({ organizationId: trackerDevices.organizationId })
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

  await db
    .update(trackerDevices)
    .set({
      lastLat: position.latitude,
      lastLng: position.longitude,
      lastSpeedKph: position.speedKph,
      lastHeading: position.heading,
      lastIgnitionOn: position.ignitionOn,
      lastMileageKm: position.mileageKm,
      lastGpsValid: position.gpsValid,
      lastPositionAt: position.recordedAt,
      lastSeenAt: new Date(),
    })
    .where(eq(trackerDevices.id, deviceId));
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
