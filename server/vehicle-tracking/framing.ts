/**
 * Split a TCP stream into complete tracker frames (GT06 binary and H02 ASCII).
 * Unknown leading bytes are skipped one at a time so mixed vendors can share port 7711.
 */
export function extractTrackerPackets(buffer: Buffer): { packets: Buffer[]; remaining: Buffer } {
  const packets: Buffer[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const b0 = buffer[offset];
    const b1 = buffer[offset + 1];
    const isShort = b0 === 0x78 && b1 === 0x78;
    const isLong = b0 === 0x79 && b1 === 0x79;

    if (isShort || isLong) {
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
      continue;
    }

    if (b0 === 0x2a) {
      const hash = buffer.indexOf(0x23, offset + 1);
      if (hash === -1) {
        if (buffer.length - offset > 512) {
          offset += 1;
          continue;
        }
        break;
      }
      let end = hash + 1;
      if (buffer[end] === 0x0d) end += 1;
      if (buffer[end] === 0x0a) end += 1;
      packets.push(buffer.subarray(offset, end));
      offset = end;
      continue;
    }

    offset += 1;
  }

  return { packets, remaining: buffer.subarray(offset) };
}
