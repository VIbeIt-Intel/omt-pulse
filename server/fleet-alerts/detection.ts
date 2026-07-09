import { isWithinPremiseRadius } from "@shared/premises-geofence";
import {
  FLEET_ALERT_COOLDOWN_MS,
  FLEET_ALERT_LABELS,
  type FleetAlertType,
} from "@shared/fleet-alerts";
import type { ParsedTrackerPosition } from "../vehicle-tracking/types";
import {
  createFleetAlert,
  getResolvedFleetAlertRules,
  getTrackerDevicesForAlertScan,
  markFleetAlertPushSent,
  vehicleDisplayNameForAlert,
  type TrackerDeviceForAlerts,
} from "./storage";
import { notifyFleetAlertPush } from "./push";

const MOVING_SPEED_KPH = 5;

type DeviceRuntimeState = {
  geofenceInside: boolean | null;
  idleSince: Date | null;
  lastAlertAt: Partial<Record<FleetAlertType, number>>;
  offlineAlertActive: boolean;
};

const runtimeState = new Map<number, DeviceRuntimeState>();

function getState(deviceId: number): DeviceRuntimeState {
  let state = runtimeState.get(deviceId);
  if (!state) {
    state = {
      geofenceInside: null,
      idleSince: null,
      lastAlertAt: {},
      offlineAlertActive: false,
    };
    runtimeState.set(deviceId, state);
  }
  return state;
}

function canFireAlert(state: DeviceRuntimeState, type: FleetAlertType): boolean {
  const last = state.lastAlertAt[type];
  if (!last) return true;
  return Date.now() - last >= FLEET_ALERT_COOLDOWN_MS;
}

function markAlertFired(state: DeviceRuntimeState, type: FleetAlertType): void {
  state.lastAlertAt[type] = Date.now();
}

async function fireAlert(
  device: TrackerDeviceForAlerts,
  type: FleetAlertType,
  title: string,
  message: string,
  opts?: {
    details?: string;
    latitude?: number | null;
    longitude?: number | null;
    speedKph?: number | null;
  },
): Promise<void> {
  const state = getState(device.id);
  if (!canFireAlert(state, type)) return;

  const alert = await createFleetAlert({
    organizationId: device.organizationId,
    deviceId: device.id,
    alertType: type,
    title,
    message,
    details: opts?.details ?? null,
    latitude: opts?.latitude ?? device.lastLat,
    longitude: opts?.longitude ?? device.lastLng,
    speedKph: opts?.speedKph ?? device.lastSpeedKph,
  });

  markAlertFired(state, type);
  await notifyFleetAlertPush({ alert, commandId: device.commandId });
  await markFleetAlertPushSent(alert.id);
}

export async function evaluateFleetAlertsOnPosition(
  deviceId: number,
  position: ParsedTrackerPosition,
): Promise<void> {
  const devices = await getTrackerDevicesForAlertScan();
  const device = devices.find((d) => d.id === deviceId);
  if (!device) return;

  const rules = await getResolvedFleetAlertRules(device.organizationId, device.id);
  if (!rules.alertsEnabled) return;

  const state = getState(device.id);
  const name = vehicleDisplayNameForAlert(device);
  const speed = position.speedKph ?? 0;

  state.offlineAlertActive = false;

  if (position.speedKph != null && position.speedKph > rules.speedLimitKph) {
    await fireAlert(device, "speeding", `${FLEET_ALERT_LABELS.speeding}: ${name}`, `${Math.round(position.speedKph)} km/h (limit ${Math.round(rules.speedLimitKph)} km/h)`, {
      details: `Speed ${position.speedKph.toFixed(1)} km/h exceeded limit of ${rules.speedLimitKph} km/h`,
      latitude: position.latitude,
      longitude: position.longitude,
      speedKph: position.speedKph,
    });
  }

  const isMoving = speed >= MOVING_SPEED_KPH;
  if (isMoving) {
    state.idleSince = null;
  } else if (!state.idleSince) {
    state.idleSince = position.recordedAt;
  } else {
    const idleMs = position.recordedAt.getTime() - state.idleSince.getTime();
    const idleMinutes = idleMs / 60_000;
    if (idleMinutes >= rules.idleMinutes) {
      await fireAlert(device, "idle", `${FLEET_ALERT_LABELS.idle}: ${name}`, `Idle for ${Math.round(idleMinutes)} min (threshold ${rules.idleMinutes} min)`, {
        details: `Vehicle stationary below ${MOVING_SPEED_KPH} km/h since ${state.idleSince.toISOString()}`,
        latitude: position.latitude,
        longitude: position.longitude,
        speedKph: position.speedKph,
      });
      state.idleSince = position.recordedAt;
    }
  }

  if (
    rules.geofenceEnabled
    && rules.geofenceLat != null
    && rules.geofenceLng != null
    && position.gpsValid
  ) {
    const inside = isWithinPremiseRadius(
      position.latitude,
      position.longitude,
      rules.geofenceLat,
      rules.geofenceLng,
      rules.geofenceRadiusM,
    );
    if (state.geofenceInside === null) {
      state.geofenceInside = inside;
    } else if (inside !== state.geofenceInside) {
      state.geofenceInside = inside;
      const type: FleetAlertType = inside ? "geofence_enter" : "geofence_leave";
      await fireAlert(
        device,
        type,
        `${FLEET_ALERT_LABELS[type]}: ${name}`,
        inside
          ? `Entered monitored zone (${Math.round(rules.geofenceRadiusM)} m radius)`
          : `Left monitored zone (${Math.round(rules.geofenceRadiusM)} m radius)`,
        {
          latitude: position.latitude,
          longitude: position.longitude,
          speedKph: position.speedKph,
        },
      );
    }
  }
}

export async function evaluateFleetOfflineAlerts(): Promise<void> {
  const devices = await getTrackerDevicesForAlertScan();
  const now = Date.now();

  for (const device of devices) {
    const rules = await getResolvedFleetAlertRules(device.organizationId, device.id);
    if (!rules.alertsEnabled || !device.lastSeenAt) continue;

    const offlineMs = rules.offlineMinutes * 60_000;
    const ageMs = now - device.lastSeenAt.getTime();
    const state = getState(device.id);

    if (ageMs >= offlineMs) {
      if (!state.offlineAlertActive && canFireAlert(state, "offline")) {
        const name = vehicleDisplayNameForAlert(device);
        const mins = Math.round(ageMs / 60_000);
        await fireAlert(
          device,
          "offline",
          `${FLEET_ALERT_LABELS.offline}: ${name}`,
          `No signal for ${mins} min (threshold ${rules.offlineMinutes} min)`,
          {
            details: `Last seen ${device.lastSeenAt.toISOString()}`,
            latitude: device.lastLat,
            longitude: device.lastLng,
            speedKph: device.lastSpeedKph,
          },
        );
        state.offlineAlertActive = true;
      }
    } else {
      state.offlineAlertActive = false;
    }
  }
}

export function startFleetOfflineAlertMonitor(): void {
  const intervalMs = 60_000;
  setInterval(() => {
    void evaluateFleetOfflineAlerts().catch((err) => {
      console.error("[fleet-alerts] offline scan failed:", err instanceof Error ? err.message : err);
    });
  }, intervalMs);
  console.log(`[fleet-alerts] offline monitor started (every ${intervalMs / 1000}s)`);
}
