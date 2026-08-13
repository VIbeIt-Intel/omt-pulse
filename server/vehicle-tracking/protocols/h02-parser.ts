import type { ParsedTrackerPosition } from "../types";

const LOG = "vehicle-tracker:h02";

/** H02 / SinoTrack speed is NMEA knots. */
const KNOTS_TO_KPH = 1.852;

export type H02ParseResult = {
  deviceId: string;
  packetType: string;
  position?: ParsedTrackerPosition;
};

function stripFrame(packet: Buffer): string {
  return packet.toString("ascii").replace(/[\r\n]/g, "").trim();
}

export function looksLikeH02(packet: Buffer): boolean {
  if (packet.length < 8) return false;
  if (packet[0] !== 0x2a) return false; // *
  return packet.includes(0x23); // #
}

export function tryExtractH02DeviceId(packet: Buffer): string | null {
  if (packet[0] !== 0x2a) return null;
  const text = stripFrame(packet);
  const parts = text.replace(/#$/, "").split(",");
  const id = parts[1]?.trim();
  if (!id || !/^\d{8,20}$/.test(id)) return null;
  return id;
}

/** NMEA ddmm.mmmm / dddmm.mmmm → decimal degrees. */
export function nmeaToDecimal(raw: string, hemi: string): number | null {
  const val = parseFloat(raw);
  if (!Number.isFinite(val)) return null;
  const abs = Math.abs(val);
  const degrees = Math.floor(abs / 100);
  const minutes = abs - degrees * 100;
  let decimal = degrees + minutes / 60;
  const h = hemi.toUpperCase();
  if (h === "S" || h === "W") decimal = -decimal;
  if (Math.abs(decimal) > 180) return null;
  return decimal;
}

function parseUtcDateTime(hhmmss: string | undefined, ddmmyy: string | undefined): Date {
  if (!hhmmss || hhmmss.length < 6 || !ddmmyy || ddmmyy.length < 6) {
    return new Date();
  }
  const hour = parseInt(hhmmss.slice(0, 2), 10);
  const minute = parseInt(hhmmss.slice(2, 4), 10);
  const second = parseInt(hhmmss.slice(4, 6), 10);
  const day = parseInt(ddmmyy.slice(0, 2), 10);
  const month = parseInt(ddmmyy.slice(2, 4), 10);
  const year = 2000 + parseInt(ddmmyy.slice(4, 6), 10);
  if (
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return new Date();
  }
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

function parseStatusIgnition(statusHex: string | undefined): boolean | null {
  if (!statusHex || !/^[0-9a-fA-F]+$/.test(statusHex)) return null;
  try {
    const status = BigInt(`0x${statusHex}`);
    return Boolean(status & (1n << 10n));
  } catch {
    return null;
  }
}

/**
 * Parse SinoTrack / H02 ASCII frames:
 * `*HQ,ID,V1,HHMMSS,A,lat,N,lon,E,speed,course,DDMMYY,status#`
 */
export function parseH02Packet(packet: Buffer): H02ParseResult | null {
  const text = stripFrame(packet);
  if (!text.startsWith("*") || !text.endsWith("#")) return null;

  const parts = text.slice(1, -1).split(",");
  if (parts.length < 3) return null;

  const deviceId = parts[1]?.trim();
  const type = (parts[2]?.trim() ?? "").toUpperCase();
  if (!deviceId || !/^\d{8,20}$/.test(deviceId)) return null;

  if (type === "V0" || type === "HTBT" || type === "LINK" || type === "NBR" || type === "V3") {
    return { deviceId, packetType: type.toLowerCase() };
  }

  // V1 / V4 / VP1 location: ID, TYPE, time, validity, lat, hemi, lon, hemi, speed, course, date, status
  const validity = parts[4]?.trim().toUpperCase();
  const latRaw = parts[5];
  const latHemi = parts[6]?.trim();
  const lonRaw = parts[7];
  const lonHemi = parts[8]?.trim();
  if (!latRaw || !latHemi || !lonRaw || !lonHemi) {
    return { deviceId, packetType: type.toLowerCase() || "h02" };
  }

  const latitude = nmeaToDecimal(latRaw, latHemi);
  const longitude = nmeaToDecimal(lonRaw, lonHemi);
  if (latitude == null || longitude == null || Math.abs(latitude) > 90) {
    console.warn(`[${LOG}] bad coordinates in ${text.slice(0, 80)}`);
    return { deviceId, packetType: type.toLowerCase() || "h02" };
  }

  const speedKnots = parseFloat(parts[9] ?? "");
  const course = parseFloat(parts[10] ?? "");
  const gpsValid = validity === "A" || validity === "B";

  const position: ParsedTrackerPosition = {
    latitude,
    longitude,
    speedKph: Number.isFinite(speedKnots) ? Math.round(speedKnots * KNOTS_TO_KPH * 10) / 10 : null,
    heading: Number.isFinite(course) ? course : null,
    ignitionOn: parseStatusIgnition(parts[12]),
    mileageKm: null,
    gpsValid,
    packetType: type.toLowerCase() || "v1",
    recordedAt: parseUtcDateTime(parts[3], parts[11]),
  };

  return {
    deviceId,
    packetType: position.packetType,
    position,
  };
}
