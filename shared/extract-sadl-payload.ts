import { isSadlEncryptedPayload } from "@shared/sa-drivers-licence";

export function padSadlTo720(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(720);
  out.set(bytes.subarray(0, Math.min(720, bytes.length)));
  return out;
}

export function hexToSadlBytes(hex: string): Uint8Array | null {
  const cleaned = hex.replace(/\s/g, "");
  if (cleaned.length < 1400 || cleaned.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(cleaned)) return null;
  const out = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function latin1BytesFromText(text: string): Uint8Array | null {
  if (text.length < 700) return null;
  const len = Math.min(text.length, 720);
  const out = new Uint8Array(720);
  for (let i = 0; i < len; i++) {
    out[i] = text.charCodeAt(i) & 0xff;
  }
  return out;
}

/** Slide a 720-byte window to find the encrypted SADL header. */
export function findSadl720InBuffer(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length === 720 && isSadlEncryptedPayload(bytes)) return bytes;
  if (bytes.length > 720) {
    for (let i = 0; i <= bytes.length - 720; i++) {
      const slice = bytes.subarray(i, i + 720);
      if (isSadlEncryptedPayload(slice)) return slice;
    }
  }
  if (bytes.length >= 700 && bytes.length < 720) {
    const padded = padSadlTo720(bytes);
    if (isSadlEncryptedPayload(padded)) return padded;
  }
  return null;
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export type BinaryEyeScanPayload = {
  text?: string;
  bytesBase64?: string;
  hex?: string;
  latin1TextBase64?: string;
};

/** Normalize Binary Eye / ZXing scan output into a 720-byte SADL payload. */
export function extractSadl720FromScan(input: BinaryEyeScanPayload): Uint8Array | null {
  const candidates: Uint8Array[] = [];

  const push = (bytes: Uint8Array | null | undefined) => {
    if (bytes && bytes.length >= 700) candidates.push(bytes);
  };

  if (input.bytesBase64) {
    try {
      push(base64ToBytes(input.bytesBase64));
    } catch {
      /* ignore */
    }
  }

  if (input.latin1TextBase64) {
    try {
      push(base64ToBytes(input.latin1TextBase64));
    } catch {
      /* ignore */
    }
  }

  if (input.hex) {
    push(hexToSadlBytes(input.hex));
  }

  const text = input.text?.trim();
  if (text) {
    push(hexToSadlBytes(text));
    try {
      const decoded = atob(text);
      if (decoded.length >= 700) {
        push(Uint8Array.from(decoded, (c) => c.charCodeAt(0)));
      }
    } catch {
      /* not base64 */
    }
    push(latin1BytesFromText(text));
  }

  for (const candidate of candidates) {
    const found = findSadl720InBuffer(candidate);
    if (found) return found;
  }

  return null;
}
