import type { ParsedTrackerPosition } from "../types";

const LOG = "vehicle-tracker:h02";

/** H02 / SinoTrack speed is NMEA knots. */
const KNOTS_TO_KPH = 1.852;

export type H02ParseResult = {
  deviceId: string;
  packetType: string;
  position?: ParsedTrackerPosition;
  batteryPercent?: number | null;
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

/** Map SinoTrack battery tokens to 0–100. */
export function normalizeBatteryPercent(raw: number): number | null {
  if (!Number.isFinite(raw)) return null;
  const n = Math.round(raw);
  if (n >= 0xf1 && n <= 0xf6) {
    const mapped = [10, 30, 60, 80, 100, 100];
    return mapped[n - 0xf1] ?? null;
  }
  if (n >= 0 && n <= 6) {
    return [0, 10, 20, 30, 40, 50, 100][n] ?? null;
  }
  if (n >= 0 && n <= 100) return n;
  return null;
}

function parseBatteryToken(token: string | undefined): number | null {
  if (!token) return null;
  const pct = token.match(/(\d{1,3})\s*%/);
  if (pct) {
    const n = parseInt(pct[1]!, 10);
    return n >= 0 && n <= 100 ? n : null;
  }
  if (/^bat(?:tery)?[:\s]/i.test(token.trim())) {
    const n = parseInt(token.replace(/[^\d]/g, ""), 10);
    return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
  }
  if (!/^\d+(\.\d+)?$/.test(token.trim())) return null;
  const n = Math.round(parseFloat(token));
  if (n >= 0 && n <= 100) return n;
  return normalizeBatteryPercent(n);
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
 * LINK/HTBT carry battery; V1 may include an extra percent field.
 */
export function parseH02Packet(packet: Buffer): H02ParseResult | null {
  const text = stripFrame(packet);
  if (!text.startsWith("*") || !text.endsWith("#")) return null;

  const parts = text.slice(1, -1).split(",");
  if (parts.length < 3) return null;

  const deviceId = parts[1]?.trim();
  const type = (parts[2]?.trim() ?? "").toUpperCase();
  if (!deviceId || !/^\d{8,20}$/.test(deviceId)) return null;

  if (type === "LINK") {
    // *HQ,ID,LINK,HHMMSS,rssi,sats,battery,steps,turnovers,DDMMYY,status#
    return {
      deviceId,
      packetType: "link",
      batteryPercent: parseBatteryToken(parts[6]),
    };
  }

  if (type === "HTBT") {
    return {
      deviceId,
      packetType: "htbt",
      batteryPercent: parseBatteryToken(parts[3]),
    };
  }

  if (type === "V4") {
    let batteryPercent: number | null = null;
    for (const token of parts.slice(3)) {
      const fromLabel = parseBatteryToken(token);
      if (fromLabel != null && /bat|%/i.test(token)) {
        batteryPercent = fromLabel;
        break;
      }
    }
    if (batteryPercent == null) {
      for (const token of parts.slice(3)) {
        if (!/^\d{1,3}$/.test(token.trim())) continue;
        const n = parseInt(token, 10);
        if (n >= 0 && n <= 100) {
          batteryPercent = n;
          break;
        }
      }
    }
    return { deviceId, packetType: "v4", batteryPercent };
  }

  if (type === "V0" || type === "NBR" || type === "V3") {
    return { deviceId, packetType: type.toLowerCase() };
  }

  // V1 / VP1 location: ID, TYPE, time, validity, lat, hemi, lon, hemi, speed, course, date, status [, battery]
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
  const extraBattery = parseBatteryToken(parts[13]);

  const position: ParsedTrackerPosition = {
    latitude,
    longitude,
    speedKph: Number.isFinite(speedKnots) ? Math.round(speedKnots * KNOTS_TO_KPH * 10) / 10 : null,
    heading: Number.isFinite(course) ? course : null,
    ignitionOn: parseStatusIgnition(parts[12]),
    mileageKm: null,
    batteryPercent: extraBattery,
    gpsValid,
    packetType: type.toLowerCase() || "v1",
    recordedAt: parseUtcDateTime(parts[3], parts[11]),
  };

  return {
    deviceId,
    packetType: position.packetType,
    position,
    batteryPercent: extraBattery,
  };
}
