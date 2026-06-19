/** Space-separated lowercase hex for logs. */
export function bufferToHex(packet: Buffer): string {
  return [...packet].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/** Printable ASCII preview (non-printable → `.`). */
export function bufferToAsciiPreview(packet: Buffer, max = 64): string {
  const slice = packet.subarray(0, max);
  return slice.toString("ascii").replace(/[^\x20-\x7E]/g, ".");
}

export function protocolNumberHex(packet: Buffer): string | null {
  if (packet.length < 4) return null;
  if (packet[0] === 0x78 && packet[1] === 0x78) {
    return packet[3]?.toString(16).padStart(2, "0") ?? null;
  }
  if (packet[0] === 0x79 && packet[1] === 0x79 && packet.length >= 5) {
    return packet[4]?.toString(16).padStart(2, "0") ?? null;
  }
  return null;
}
