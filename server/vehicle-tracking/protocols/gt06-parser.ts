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
 * Parse GT06 location (0x12), extended location (0x22), and heartbeat (0x13).
 * Returns null when the packet type is not handled or data is too short.
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

  return null;
}
