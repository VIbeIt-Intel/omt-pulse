import {
  fleetAlertDefaults,
  fleetAlerts,
  fleetDeviceAlertRules,
  trackerDevices,
  type FleetAlertDefaults,
  type FleetAlertSummary,
  type FleetDeviceAlertRules,
  type ResolvedFleetAlertRules,
} from "@shared/schema";
import {
  DEFAULT_FLEET_GEOFENCE_RADIUS_M,
  DEFAULT_FLEET_IDLE_MINUTES,
  DEFAULT_FLEET_OFFLINE_MINUTES,
  DEFAULT_FLEET_SPEED_LIMIT_KPH,
  type FleetAlertType,
} from "@shared/fleet-alerts";
import { db } from "../storage";
import { eq, and, desc, gte, isNull } from "drizzle-orm";

function mergeRules(
  defaults: FleetAlertDefaults | undefined,
  device: FleetDeviceAlertRules | undefined,
): ResolvedFleetAlertRules {
  const base = defaults ?? {
    speedLimitKph: DEFAULT_FLEET_SPEED_LIMIT_KPH,
    idleMinutes: DEFAULT_FLEET_IDLE_MINUTES,
    offlineMinutes: DEFAULT_FLEET_OFFLINE_MINUTES,
    geofenceEnabled: false,
    geofenceLat: null,
    geofenceLng: null,
    geofenceRadiusM: DEFAULT_FLEET_GEOFENCE_RADIUS_M,
  };
  return {
    alertsEnabled: device?.alertsEnabled ?? true,
    speedLimitKph: device?.speedLimitKph ?? base.speedLimitKph ?? DEFAULT_FLEET_SPEED_LIMIT_KPH,
    idleMinutes: device?.idleMinutes ?? base.idleMinutes ?? DEFAULT_FLEET_IDLE_MINUTES,
    offlineMinutes: device?.offlineMinutes ?? base.offlineMinutes ?? DEFAULT_FLEET_OFFLINE_MINUTES,
    geofenceEnabled: device?.geofenceEnabled ?? base.geofenceEnabled ?? false,
    geofenceLat: device?.geofenceLat ?? base.geofenceLat ?? null,
    geofenceLng: device?.geofenceLng ?? base.geofenceLng ?? null,
    geofenceRadiusM: device?.geofenceRadiusM ?? base.geofenceRadiusM ?? DEFAULT_FLEET_GEOFENCE_RADIUS_M,
  };
}

export async function getFleetAlertDefaults(orgId: string): Promise<ResolvedFleetAlertRules> {
  const [row] = await db
    .select()
    .from(fleetAlertDefaults)
    .where(eq(fleetAlertDefaults.organizationId, orgId))
    .limit(1);
  return mergeRules(row, undefined);
}

export async function upsertFleetAlertDefaults(
  orgId: string,
  patch: Partial<ResolvedFleetAlertRules>,
): Promise<ResolvedFleetAlertRules> {
  const existing = await db
    .select()
    .from(fleetAlertDefaults)
    .where(eq(fleetAlertDefaults.organizationId, orgId))
    .limit(1);

  if (existing[0]) {
    await db
      .update(fleetAlertDefaults)
      .set({
        speedLimitKph: patch.speedLimitKph ?? existing[0].speedLimitKph,
        idleMinutes: patch.idleMinutes ?? existing[0].idleMinutes,
        offlineMinutes: patch.offlineMinutes ?? existing[0].offlineMinutes,
        geofenceEnabled: patch.geofenceEnabled ?? existing[0].geofenceEnabled,
        geofenceLat: patch.geofenceLat !== undefined ? patch.geofenceLat : existing[0].geofenceLat,
        geofenceLng: patch.geofenceLng !== undefined ? patch.geofenceLng : existing[0].geofenceLng,
        geofenceRadiusM: patch.geofenceRadiusM ?? existing[0].geofenceRadiusM,
        updatedAt: new Date(),
      })
      .where(eq(fleetAlertDefaults.organizationId, orgId));
  } else {
    await db.insert(fleetAlertDefaults).values({
      organizationId: orgId,
      speedLimitKph: patch.speedLimitKph ?? DEFAULT_FLEET_SPEED_LIMIT_KPH,
      idleMinutes: patch.idleMinutes ?? DEFAULT_FLEET_IDLE_MINUTES,
      offlineMinutes: patch.offlineMinutes ?? DEFAULT_FLEET_OFFLINE_MINUTES,
      geofenceEnabled: patch.geofenceEnabled ?? false,
      geofenceLat: patch.geofenceLat ?? null,
      geofenceLng: patch.geofenceLng ?? null,
      geofenceRadiusM: patch.geofenceRadiusM ?? DEFAULT_FLEET_GEOFENCE_RADIUS_M,
    });
  }

  return getFleetAlertDefaults(orgId);
}

export async function getResolvedFleetAlertRules(
  orgId: string,
  deviceId: number,
): Promise<ResolvedFleetAlertRules> {
  const [defaults] = await db
    .select()
    .from(fleetAlertDefaults)
    .where(eq(fleetAlertDefaults.organizationId, orgId))
    .limit(1);
  const [deviceRules] = await db
    .select()
    .from(fleetDeviceAlertRules)
    .where(and(eq(fleetDeviceAlertRules.deviceId, deviceId), eq(fleetDeviceAlertRules.organizationId, orgId)))
    .limit(1);
  return mergeRules(defaults, deviceRules);
}

export async function upsertFleetDeviceAlertRules(
  orgId: string,
  deviceId: number,
  patch: Partial<ResolvedFleetAlertRules> & { alertsEnabled?: boolean },
): Promise<ResolvedFleetAlertRules> {
  const existing = await db
    .select()
    .from(fleetDeviceAlertRules)
    .where(and(eq(fleetDeviceAlertRules.deviceId, deviceId), eq(fleetDeviceAlertRules.organizationId, orgId)))
    .limit(1);

  if (existing[0]) {
    await db
      .update(fleetDeviceAlertRules)
      .set({
        alertsEnabled: patch.alertsEnabled ?? existing[0].alertsEnabled,
        speedLimitKph: patch.speedLimitKph !== undefined ? patch.speedLimitKph : existing[0].speedLimitKph,
        idleMinutes: patch.idleMinutes !== undefined ? patch.idleMinutes : existing[0].idleMinutes,
        offlineMinutes: patch.offlineMinutes !== undefined ? patch.offlineMinutes : existing[0].offlineMinutes,
        geofenceEnabled: patch.geofenceEnabled !== undefined ? patch.geofenceEnabled : existing[0].geofenceEnabled,
        geofenceLat: patch.geofenceLat !== undefined ? patch.geofenceLat : existing[0].geofenceLat,
        geofenceLng: patch.geofenceLng !== undefined ? patch.geofenceLng : existing[0].geofenceLng,
        geofenceRadiusM: patch.geofenceRadiusM !== undefined ? patch.geofenceRadiusM : existing[0].geofenceRadiusM,
        updatedAt: new Date(),
      })
      .where(eq(fleetDeviceAlertRules.deviceId, deviceId));
  } else {
    await db.insert(fleetDeviceAlertRules).values({
      deviceId,
      organizationId: orgId,
      alertsEnabled: patch.alertsEnabled ?? true,
      speedLimitKph: patch.speedLimitKph ?? null,
      idleMinutes: patch.idleMinutes ?? null,
      offlineMinutes: patch.offlineMinutes ?? null,
      geofenceEnabled: patch.geofenceEnabled ?? null,
      geofenceLat: patch.geofenceLat ?? null,
      geofenceLng: patch.geofenceLng ?? null,
      geofenceRadiusM: patch.geofenceRadiusM ?? null,
    });
  }

  return getResolvedFleetAlertRules(orgId, deviceId);
}

export async function createFleetAlert(input: {
  organizationId: string;
  deviceId: number;
  alertType: FleetAlertType;
  title: string;
  message: string;
  details?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  speedKph?: number | null;
  pushSent?: boolean;
}): Promise<FleetAlertSummary> {
  const [row] = await db
    .insert(fleetAlerts)
    .values({
      organizationId: input.organizationId,
      deviceId: input.deviceId,
      alertType: input.alertType,
      title: input.title,
      message: input.message,
      details: input.details ?? null,
      latitude: input.latitude ?? null,
      longitude: input.longitude ?? null,
      speedKph: input.speedKph ?? null,
      pushSent: input.pushSent ?? false,
    })
    .returning();

  const [device] = await db
    .select({
      label: trackerDevices.label,
      vehicleRegistration: trackerDevices.vehicleRegistration,
      vehicleMake: trackerDevices.vehicleMake,
      vehicleModel: trackerDevices.vehicleModel,
    })
    .from(trackerDevices)
    .where(eq(trackerDevices.id, input.deviceId))
    .limit(1);

  const vehicleLabel =
    [device?.vehicleMake, device?.vehicleModel].filter(Boolean).join(" ").trim()
    || device?.label
    || null;

  return {
    ...row,
    vehicleLabel,
    vehicleRegistration: device?.vehicleRegistration ?? null,
  };
}

export async function markFleetAlertPushSent(alertId: number): Promise<void> {
  await db.update(fleetAlerts).set({ pushSent: true }).where(eq(fleetAlerts.id, alertId));
}

function mapAlertRow(r: {
  alert: typeof fleetAlerts.$inferSelect;
  label: string | null;
  vehicleRegistration: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
}): FleetAlertSummary {
  const vehicleLabel =
    [r.vehicleMake, r.vehicleModel].filter(Boolean).join(" ").trim() || r.label || null;
  return {
    ...r.alert,
    vehicleLabel,
    vehicleRegistration: r.vehicleRegistration,
  };
}

export async function getFleetAlerts(
  orgId: string,
  opts?: { deviceId?: number; hours?: number; limit?: number },
): Promise<FleetAlertSummary[]> {
  const limit = Math.min(Math.max(opts?.limit ?? 50, 1), 200);
  const hours = opts?.hours ?? 168;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const conditions = [eq(fleetAlerts.organizationId, orgId), gte(fleetAlerts.triggeredAt, since)];
  if (opts?.deviceId != null) {
    conditions.push(eq(fleetAlerts.deviceId, opts.deviceId));
  }

  const rows = await db
    .select({
      alert: fleetAlerts,
      label: trackerDevices.label,
      vehicleRegistration: trackerDevices.vehicleRegistration,
      vehicleMake: trackerDevices.vehicleMake,
      vehicleModel: trackerDevices.vehicleModel,
    })
    .from(fleetAlerts)
    .innerJoin(trackerDevices, eq(fleetAlerts.deviceId, trackerDevices.id))
    .where(and(...conditions))
    .orderBy(desc(fleetAlerts.triggeredAt))
    .limit(limit);

  return rows.map(mapAlertRow);
}

export async function acknowledgeFleetAlert(
  alertId: number,
  orgId: string,
  userId: string,
): Promise<FleetAlertSummary | undefined> {
  const [updated] = await db
    .update(fleetAlerts)
    .set({
      acknowledgedAt: new Date(),
      acknowledgedByUserId: userId,
    })
    .where(and(eq(fleetAlerts.id, alertId), eq(fleetAlerts.organizationId, orgId)))
    .returning();

  if (!updated) return undefined;

  const [device] = await db
    .select({
      label: trackerDevices.label,
      vehicleRegistration: trackerDevices.vehicleRegistration,
      vehicleMake: trackerDevices.vehicleMake,
      vehicleModel: trackerDevices.vehicleModel,
    })
    .from(trackerDevices)
    .where(eq(trackerDevices.id, updated.deviceId))
    .limit(1);

  const vehicleLabel =
    [device?.vehicleMake, device?.vehicleModel].filter(Boolean).join(" ").trim()
    || device?.label
    || null;

  return {
    ...updated,
    vehicleLabel,
    vehicleRegistration: device?.vehicleRegistration ?? null,
  };
}

export async function getActiveFleetAlertCountsByDevice(
  orgId: string,
  hours = 24,
): Promise<Record<number, number>> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select({
      deviceId: fleetAlerts.deviceId,
    })
    .from(fleetAlerts)
    .where(
      and(
        eq(fleetAlerts.organizationId, orgId),
        gte(fleetAlerts.triggeredAt, since),
        isNull(fleetAlerts.acknowledgedAt),
      ),
    );

  const counts: Record<number, number> = {};
  for (const row of rows) {
    counts[row.deviceId] = (counts[row.deviceId] ?? 0) + 1;
  }
  return counts;
}

export type TrackerDeviceForAlerts = {
  id: number;
  organizationId: string;
  commandId: number | null;
  label: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleRegistration: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastSeenAt: Date | null;
};

export async function getTrackerDevicesForAlertScan(): Promise<TrackerDeviceForAlerts[]> {
  return db
    .select({
      id: trackerDevices.id,
      organizationId: trackerDevices.organizationId,
      commandId: trackerDevices.commandId,
      label: trackerDevices.label,
      vehicleMake: trackerDevices.vehicleMake,
      vehicleModel: trackerDevices.vehicleModel,
      vehicleRegistration: trackerDevices.vehicleRegistration,
      lastLat: trackerDevices.lastLat,
      lastLng: trackerDevices.lastLng,
      lastSpeedKph: trackerDevices.lastSpeedKph,
      lastSeenAt: trackerDevices.lastSeenAt,
    })
    .from(trackerDevices);
}

export function vehicleDisplayNameForAlert(device: TrackerDeviceForAlerts): string {
  const makeModel = [device.vehicleMake, device.vehicleModel].filter(Boolean).join(" ").trim();
  if (makeModel) return makeModel;
  if (device.label?.trim()) return device.label.trim();
  if (device.vehicleRegistration?.trim()) return device.vehicleRegistration.trim();
  return `Vehicle #${device.id}`;
}
