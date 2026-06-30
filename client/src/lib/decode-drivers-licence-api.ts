import { apiRequest } from "@/lib/queryClient";
import {
  driversLicenceToParsedFields,
  looksLikeSadlEncryptedString,
  sadlLatin1ToBase64,
  type SaDriversLicence,
} from "@shared/sa-drivers-licence";
import type { ParsedSaId } from "@/lib/parse-sa-barcodes";

export function sadlBytesToBase64(bytes: Uint8Array | number[]): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode(...u8.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function decodeDriversLicenceViaApiFromBase64(
  payloadBase64: string,
): Promise<ParsedSaId | null> {
  try {
    const dl = (await apiRequest("POST", "/api/access-control/decode-drivers-licence", {
      payloadBase64,
    })) as unknown as SaDriversLicence;
    return driversLicenceToParsedFields(dl);
  } catch {
    return null;
  }
}

/** Decode SADL on the server — never run RSA decrypt on the phone. */
export async function decodeDriversLicenceViaApi(rawLatin1: string): Promise<ParsedSaId | null> {
  if (!looksLikeSadlEncryptedString(rawLatin1)) return null;
  const payloadBase64 = sadlLatin1ToBase64(rawLatin1);
  return decodeDriversLicenceViaApiFromBase64(payloadBase64);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read image"));
    reader.readAsDataURL(blob);
  });
}

/** Server reads PDF417 from image (sharp + zxing) then decrypts — most reliable on Android. */
export async function decodeDriversLicenceFromImageViaApi(
  image: Blob,
): Promise<ParsedSaId | null> {
  try {
    const imageBase64 = await blobToBase64(image);
    const dl = (await apiRequest("POST", "/api/access-control/decode-drivers-licence-image", {
      imageBase64,
    })) as unknown as SaDriversLicence;
    return driversLicenceToParsedFields(dl);
  } catch {
    return null;
  }
}
