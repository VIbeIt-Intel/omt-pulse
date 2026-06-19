import type { TrackerConnection, TrackerProtocolHandler, ProtocolHandleResult } from "../types";

import { parseGt06Packet } from "./gt06-parser";



const LOG = "vehicle-tracker:gt06";



/** CRC-ITU (XMODEM) used by GT06 / Concox family. */

export function gt06Crc16(data: Buffer): number {

  let crc = 0xffff;

  for (let i = 0; i < data.length; i++) {

    crc ^= data[i]!;

    for (let j = 0; j < 8; j++) {

      crc = crc & 1 ? (crc >> 1) ^ 0x8408 : crc >> 1;

    }

  }

  return ~crc & 0xffff;

}



export function looksLikeGt06(packet: Buffer): boolean {

  return (

    packet.length >= 5 &&

    ((packet[0] === 0x78 && packet[1] === 0x78) || (packet[0] === 0x79 && packet[1] === 0x79))

  );

}



function isLongPacket(packet: Buffer): boolean {

  return packet[0] === 0x79 && packet[1] === 0x79;

}



function protocolByteIndex(packet: Buffer): number {

  return isLongPacket(packet) ? 4 : 3;

}



/** Decode 8-byte BCD IMEI from GT06 login (protocol 0x01). */

export function tryExtractGt06Imei(packet: Buffer): string | null {

  if (!looksLikeGt06(packet)) return null;

  const protoIdx = protocolByteIndex(packet);

  if (packet[protoIdx] !== 0x01) return null;

  const imeiStart = protoIdx + 1;

  if (packet.length < imeiStart + 8) return null;

  let imei = "";

  for (let i = 0; i < 8; i++) {

    const b = packet[imeiStart + i]!;

    const hi = Math.floor(b / 16);

    const lo = b % 16;

    if (hi > 9 || lo > 9) return null;

    imei += String(hi) + String(lo);

  }

  return imei.replace(/^0+/, "") || imei;

}



function readSerial(packet: Buffer): [number, number] | null {

  if (!looksLikeGt06(packet)) return null;

  const protoIdx = protocolByteIndex(packet);

  const serialIdx = packet.length - 6;

  if (serialIdx <= protoIdx) return null;

  return [packet[serialIdx]!, packet[serialIdx + 1]!];

}



/** ACK for login, GPS, heartbeat, and other GT06 packets that expect a response. */

function buildProtocolAck(packet: Buffer): Buffer | null {

  if (!looksLikeGt06(packet)) return null;

  const proto = packet[protocolByteIndex(packet)];

  const serial = readSerial(packet);

  if (!serial) return null;



  const body = Buffer.from([0x05, proto, serial[0], serial[1]]);

  const crc = gt06Crc16(body);

  return Buffer.from([

    0x78,

    0x78,

    0x05,

    proto,

    serial[0],

    serial[1],

    (crc >> 8) & 0xff,

    crc & 0xff,

    0x0d,

    0x0a,

  ]);

}



const ACK_PROTOCOLS = new Set([0x01, 0x12, 0x13, 0x15, 0x16, 0x22, 0x26]);



/**

 * Split stream buffer into complete GT06 frames (terminated with 0x0D 0x0A).

 */

export function extractGt06Packets(buffer: Buffer): { packets: Buffer[]; remaining: Buffer } {

  const packets: Buffer[] = [];

  let offset = 0;



  while (offset < buffer.length) {

    const b0 = buffer[offset];

    const b1 = buffer[offset + 1];

    const isShort = b0 === 0x78 && b1 === 0x78;

    const isLong = b0 === 0x79 && b1 === 0x79;

    if (!isShort && !isLong) {

      offset += 1;

      continue;

    }



    const headerSize = isLong ? 4 : 3;

    if (offset + headerSize > buffer.length) break;



    const len = isLong ? buffer.readUInt16BE(offset + 2) : buffer[offset + 2]!;

    const total = headerSize + len + 2;

    if (offset + total > buffer.length) break;



    if (buffer[offset + total - 2] !== 0x0d || buffer[offset + total - 1] !== 0x0a) {

      offset += 1;

      continue;

    }



    packets.push(buffer.subarray(offset, offset + total));

    offset += total;

  }



  return { packets, remaining: buffer.subarray(offset) };

}



export const gt06ProtocolHandler: TrackerProtocolHandler = {

  id: "gt06",

  label: "GT06 / Concox",



  matches: looksLikeGt06,



  tryExtractDeviceId: tryExtractGt06Imei,



  handlePacket(packet: Buffer, _connection: TrackerConnection): ProtocolHandleResult {

    const proto = packet[protocolByteIndex(packet)];

    const parsed = parseGt06Packet(packet);



    let response: Buffer | undefined;

    if (ACK_PROTOCOLS.has(proto)) {

      response = buildProtocolAck(packet) ?? undefined;

      if (response && proto === 0x01) {

        console.log(`[${LOG}] login ACK queued (${response.length} bytes)`);

      }

    }



    const result: ProtocolHandleResult = {

      deviceId: tryExtractGt06Imei(packet),

      response,

    };



    if (parsed?.position) {
      result.position = { ...parsed.position, packetType: parsed.packetType };
    } else if (parsed?.ignitionOnly) {

      result.ignitionUpdate = parsed.ignitionOnly;

    }



    return result;

  },

};


