import { apiRequest } from "@/lib/queryClient";
import {
  driversLicenceToParsedFields,
  looksLikeSadlEncryptedString,
  sadlLatin1ToBase64,
  type SaDriversLicence,
} from "@shared/sa-drivers-licence";
import type { ParsedSaId } from "@/lib/parse-sa-barcodes";

/** Decode SADL on the server — never run RSA decrypt on the phone (crashes WebView). */
export async function decodeDriversLicenceViaApi(rawLatin1: string): Promise<ParsedSaId | null> {
  if (!looksLikeSadlEncryptedString(rawLatin1)) return null;
  try {
    const payloadBase64 = sadlLatin1ToBase64(rawLatin1);
    const dl = await apiRequest("POST", "/api/access-control/decode-drivers-licence", {
      payloadBase64,
    }) as SaDriversLicence;
    return driversLicenceToParsedFields(dl);
  } catch {
    return null;
  }
}
