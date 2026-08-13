import type { TrackerConnection, TrackerProtocolHandler, ProtocolHandleResult } from "../types";
import { looksLikeH02, parseH02Packet, tryExtractH02DeviceId } from "./h02-parser";

const LOG = "vehicle-tracker:h02";

function utcStamp(format: "time" | "datetime"): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const time = `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
  if (format === "time") return time;
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${time}`;
}

/** SinoTrack expects a V4 ACK after V1 location; V0/HTBT is echoed. */
function buildH02Ack(deviceId: string, type: string): Buffer | undefined {
  const t = type.toUpperCase();
  if (t === "V1") {
    return Buffer.from(`*HQ,${deviceId},V4,V1,${utcStamp("datetime")}#`, "ascii");
  }
  if (t === "V0" || t === "HTBT") {
    return Buffer.from(`*HQ,${deviceId},${t}#`, "ascii");
  }
  return undefined;
}

export const h02ProtocolHandler: TrackerProtocolHandler = {
  id: "h02",
  label: "H02 / SinoTrack",

  matches: looksLikeH02,

  tryExtractDeviceId: tryExtractH02DeviceId,

  handlePacket(packet: Buffer, _connection: TrackerConnection): ProtocolHandleResult {
    const parsed = parseH02Packet(packet);
    const deviceId = parsed?.deviceId ?? tryExtractH02DeviceId(packet);

    if (!parsed) {
      console.log(`[${LOG}] unhandled frame (${packet.length} bytes) id=${deviceId ?? "?"}`);
      return { deviceId };
    }

    const response = deviceId ? buildH02Ack(deviceId, parsed.packetType) : undefined;
    if (response) {
      console.log(`[${LOG}] ${parsed.packetType} ACK queued for ${deviceId}`);
    }

    return {
      deviceId,
      response,
      position: parsed.position ?? undefined,
    };
  },
};
