import type { ProtocolHandleResult } from "./types";
import { saveTrackerIgnition, saveTrackerPosition } from "./store";

const LOG = "vehicle-tracker";

export async function persistProtocolResult(
  imei: string,
  protocolId: string,
  result: ProtocolHandleResult,
): Promise<void> {
  if (result.position) {
    await saveTrackerPosition(imei, protocolId, result.position);
    const p = result.position;
    console.log(
      `[${LOG}] GPS saved IMEI=${imei} lat=${p.latitude.toFixed(6)} lng=${p.longitude.toFixed(6)}` +
        ` speed=${p.speedKph ?? "?"}kph heading=${p.heading ?? "?"}°` +
        ` ignition=${p.ignitionOn ?? "?"} valid=${p.gpsValid}` +
        (p.mileageKm != null ? ` mileage=${p.mileageKm}km` : "") +
        ` @ ${p.recordedAt.toISOString()}`,
    );
    return;
  }

  if (result.ignitionUpdate) {
    await saveTrackerIgnition(imei, protocolId, result.ignitionUpdate.ignitionOn);
    console.log(
      `[${LOG}] ignition update IMEI=${imei} ACC=${result.ignitionUpdate.ignitionOn ? "on" : "off"}`,
    );
  }
}
