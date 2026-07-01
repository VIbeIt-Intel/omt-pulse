import type { ParsedSaId } from "@/lib/parse-sa-barcodes";

export type NativeLicenceScanFailure =
  | "cancelled"
  | "permission"
  | "unsupported"
  | "no_barcode"
  | "decode_failed";

export type NativeLicenceScanResult =
  | { ok: true; parsed: ParsedSaId }
  | { ok: false; reason: NativeLicenceScanFailure };
