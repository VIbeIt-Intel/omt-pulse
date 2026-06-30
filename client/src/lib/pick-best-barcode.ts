/** Prefer Smart ID PDF417 pipe payloads over short Code 39 ID-only reads. */
import { isSadlEncryptedString } from "@/lib/sa-drivers-licence";

export function scoreBarcodePayload(raw: string, format?: string): number {
  const value = raw.trim();
  if (!value) return -1;

  let score = Math.min(value.length, 200);
  const fmt = (format ?? "").toLowerCase();

  if (value.includes("|")) score += 2_000;
  if (isSadlEncryptedString(value)) score += 1_800;
  if (fmt.includes("pdf417") || fmt.includes("pdf_417")) score += 800;
  if (value.length > 40) score += 400;
  if (value.length >= 700) score += 300;

  const digits = value.replace(/\D/g, "");
  if (digits.length === 13 && value.length <= 14 && !value.includes("|")) {
    score -= 600;
  }

  return score;
}

export function pickBestBarcodePayload(
  codes: Array<{ rawValue: string; format?: string }>,
): string | null {
  if (!codes.length) return null;

  const ranked = codes
    .map((c) => ({
      value: c.rawValue?.trim() ?? "",
      score: scoreBarcodePayload(c.rawValue, c.format),
    }))
    .filter((c) => c.value && c.score >= 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.value ?? null;
}

/** Smart ID full decode — pipe-delimited PDF417 on back of card. */
export function isSmartIdPipePayload(raw: string): boolean {
  const parts = raw.trim().split("|");
  return parts.length >= 5 && parts[0].length > 0 && parts[1].length > 0;
}
