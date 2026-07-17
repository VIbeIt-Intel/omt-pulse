import { looksLikeGt06 } from "./gt06";

const LOG = "vehicle-tracker:gt06";

function isLongPacket(packet: Buffer): boolean {
  return packet[0] === 0x79 && packet[1] === 0x79;
}

function protocolByteIndex(packet: Buffer): number {
  return isLongPacket(packet) ? 4 : 3;
}

function dataStartIndex(packet: Buffer): number {
  return protocolByteIndex(packet) + 1;
}

/** Decode 6-byte GT06 BCD datetime (YY MM DD HH MM SS). */
function parseGt06DateTime(packet: Buffer, offset: number): Date | null {
  if (packet.length < offset + 6) return null;
  const year = 2000 + packet[offset]!;
  const month = packet[offset + 1]!;
  const day = packet[offset + 2]!;
  const hour = packet[offset + 3]!;
  const minute = packet[offset + 4]!;
  const second = packet[offset + 5]!;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
}

/**
 * Parse Concox DWXX / WHERE style coordinates.
 * Examples:
 *   Lat:N23d5.1708m,Lon:E114d23.6212m
 *   Lat:N23.086180,Lon:E114.393686
 */
export function parseDwxxCoordinates(text: string): {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
} | null {
  const latMatch = text.match(/Lat:\s*([NS])\s*([\d.]+)(?:d([\d.]+)m)?/i);
  const lonMatch = text.match(/Lon:\s*([EW])\s*([\d.]+)(?:d([\d.]+)m)?/i);
  if (!latMatch || !lonMatch) return null;

  const toDecimal = (hemi: string, degStr: string, minStr?: string): number => {
    let deg = parseFloat(degStr);
    if (minStr) deg += parseFloat(minStr) / 60;
    if (hemi === "S" || hemi === "W") deg = -deg;
    return deg;
  };

  const latitude = toDecimal(latMatch[1]!.toUpperCase(), latMatch[2]!, latMatch[3]);
  const longitude = toDecimal(lonMatch[1]!.toUpperCase(), lonMatch[2]!, lonMatch[3]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null;

  const speedMatch = text.match(/Speed:\s*([\d.]+)/i);
  const courseMatch = text.match(/Course:\s*([\d.]+)/i);

  return {
    latitude,
    longitude,
    speedKph: speedMatch ? parseFloat(speedMatch[1]!) : null,
    heading: courseMatch ? parseFloat(courseMatch[1]!) : null,
  };
}

function parseStringCommandPacket(packet: Buffer, dataStart: number): Gt06ParseResult | null {
  // 0x15: cmdLen(1) + serverFlag(4) + ascii content + language(2) + serial(2) + crc(2)
  if (packet.length < dataStart + 1 + 4 + 2 + 2) return null;
  const cmdLen = packet[dataStart]!;
  const contentStart = dataStart + 1 + 4;
  const contentLen = Math.max(0, cmdLen - 4);
  if (packet.length < contentStart + contentLen) return null;
  const text = packet.subarray(contentStart, contentStart + contentLen).toString("ascii");
  console.log(`[${LOG}] string response: ${text.slice(0, 200)}`);

  const coords = parseDwxxCoordinates(text);
  if (!coords) {
    return { packetType: "0x15-string" };
  }

  return {
    packetType: "0x15-dwxx",
    position: {
      latitude: coords.latitude,
      longitude: coords.longitude,
      speedKph: coords.speedKph,
      heading: coords.heading,
      ignitionOn: null,
      mileageKm: null,
      gpsValid: true,
      recordedAt: new Date(),
    },
  };
}

export type Gt06ParseResult = {
  packetType: string;
  position?: {
    latitude: number;
    longitude: number;
    speedKph: number | null;
    heading: number | null;
    ignitionOn: boolean | null;
    mileageKm: number | null;
    gpsValid: boolean;
    recordedAt: Date;
  };
  /** Heartbeat / status packet — update ignition without a new GPS fix. */
  ignitionOnly?: {
    ignitionOn: boolean;
    recordedAt: Date;
  };
};

/**
 * Parse GT06 location (0x12), extended location (0x22), heartbeat (0x13),
 * and string command replies (0x15, e.g. DWXX#).
 */
export function parseGt06Packet(packet: Buffer): Gt06ParseResult | null {
  if (!looksLikeGt06(packet)) return null;

  const protoIdx = protocolByteIndex(packet);
  const proto = packet[protoIdx]!;
  const dataStart = dataStartIndex(packet);

  if (proto === 0x12 || proto === 0x22) {
    const recordedAt = parseGt06DateTime(packet, dataStart) ?? new Date();
    const gpsInfoOffset = dataStart + 6;
    if (packet.length < gpsInfoOffset + 11) {
      console.warn(`[${LOG}] GPS packet 0x${proto.toString(16)} too short (${packet.length} bytes)`);
      return null;
    }

    const gpsInfo = packet[gpsInfoOffset]!;
    const satellites = gpsInfo & 0x0f;
    void satellites;

    let offset = gpsInfoOffset + 1;
    let latitude = packet.readUInt32BE(offset) / 1_800_000;
    offset += 4;
    let longitude = packet.readUInt32BE(offset) / 1_800_000;
    offset += 4;
    const speedKph = packet[offset]!;
    offset += 1;
    const courseStatus = packet.readUInt16BE(offset);
    offset += 2;

    const heading = courseStatus & 0x03ff;
    const gpsValid = (courseStatus & 0x1000) !== 0;
    if ((courseStatus & 0x0400) === 0) latitude = -latitude;
    if ((courseStatus & 0x0800) !== 0) longitude = -longitude;

    let ignitionOn: boolean | null = null;
    let mileageKm: number | null = null;

    if (proto === 0x22) {
      // MCC(2) + MNC(1) + LAC(2) + Cell ID(3) + ACC(1) + upload mode(1) + realtime(1) + mileage(4)
      const mileageOffset = offset + 2 + 1 + 2 + 3 + 1 + 1 + 1;
      if (packet.length >= mileageOffset + 4) {
        const accByte = packet[offset + 2 + 1 + 2 + 3]!;
        ignitionOn = accByte === 1;
        const mileageRaw = packet.readUInt32BE(mileageOffset);
        mileageKm = mileageRaw / 10;
      }
    }

    return {
      packetType: proto === 0x22 ? "0x22-gps-ext" : "0x12-gps",
      position: {
        latitude,
        longitude,
        speedKph,
        heading,
        ignitionOn,
        mileageKm,
        gpsValid,
        recordedAt,
      },
    };
  }

  if (proto === 0x13) {
    if (packet.length < dataStart + 1) return null;
    const terminalInfo = packet[dataStart]!;
    const ignitionOn = (terminalInfo & 0x40) !== 0;
    return {
      packetType: "0x13-heartbeat",
      ignitionOnly: {
        ignitionOn,
        recordedAt: new Date(),
      },
    };
  }

  if (proto === 0x15) {
    return parseStringCommandPacket(packet, dataStart);
  }

  return null;
}
