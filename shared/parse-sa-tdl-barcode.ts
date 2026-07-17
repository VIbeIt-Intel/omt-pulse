/**
 * South African temporary driving licence / certificate PDF417 text (eNaTIS TDL format).
 * Percent-delimited like MVL discs — not the 720-byte RSA SADL card payload.
 *
 * Example:
 * %TDL88%0092%8939A00C%1%893900007M20VENTER%B/2010-08-26/0%%%%%%2026-07-06%
 */

import { isValidSaIdNumber } from "./parse-sa-licence-front";

export type ParsedSaTdlBarcode = {
  personFullName?: string;
  personSurname?: string;
  personIdNumber?: string;
  personDateOfBirth?: string;
  driversLicenceNumber?: string;
  licenceExpiryDate?: string;
  vehicleCodes?: string[];
  certificateRef?: string;
  complete: boolean;
  hint?: string;
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function cleanSegment(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

/** True when the scan text is a temporary driving licence barcode (not MVL / not SADL). */
export function looksLikeSaTdlBarcode(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  return t.includes("%TDL") || /^TDL\d/.test(t);
}

function extractSaIdFromText(raw: string): string | undefined {
  for (const match of raw.matchAll(/\d{13}/g)) {
    const candidate = match[0];
    if (isValidSaIdNumber(candidate)) return candidate;
  }
  return undefined;
}

function extractSurnameFromSegment(segment: string): { surname?: string; prefix?: string } {
  const trimmed = segment.trim();
  if (!trimmed) return {};

  if (/^[A-Z][A-Z' -]{1,39}$/i.test(trimmed) && !trimmed.includes("/") && !/\d/.test(trimmed)) {
    return { surname: trimmed.toUpperCase() };
  }

  const glued = trimmed.match(/^(.+?)([A-Z]{3,})$/);
  if (glued) {
    const prefix = glued[1]?.trim();
    const surname = glued[2]?.trim().toUpperCase();
    if (surname && /^[A-Z' -]+$/.test(surname) && !ISO_DATE.test(surname)) {
      return { surname, prefix: prefix || undefined };
    }
  }

  return {};
}

function parseCodeDobSegment(segment: string): { code?: string; dateOfBirth?: string } {
  const match = segment.trim().match(/^([A-Z]{1,3})\/(\d{4}-\d{2}-\d{2})(?:\/|$)/i);
  if (!match) return {};
  return { code: match[1]!.toUpperCase(), dateOfBirth: match[2] };
}

/** Parse TDL percent-string from a temporary driving licence barcode. */
export function parseSaTdlBarcode(raw: string): ParsedSaTdlBarcode {
  const trimmed = raw.trim();
  if (!trimmed.includes("%") || !looksLikeSaTdlBarcode(trimmed)) {
    return { complete: false, hint: "Not a temporary driving licence barcode." };
  }

  const parts = trimmed.split("%");
  const header = parts[1]?.trim().toUpperCase() ?? "";
  if (!header.startsWith("TDL")) {
    return { complete: false, hint: "Not a temporary driving licence barcode." };
  }

  let surname: string | undefined;
  let licenceRef: string | undefined;
  const vehicleCodes: string[] = [];
  let dateOfBirth: string | undefined;

  for (let i = 2; i < parts.length; i++) {
    const segment = cleanSegment(parts[i]);
    if (!segment) continue;

    const codeDob = parseCodeDobSegment(segment);
    if (codeDob.code) {
      vehicleCodes.push(codeDob.code);
      if (codeDob.dateOfBirth) dateOfBirth = codeDob.dateOfBirth;
      continue;
    }

    const nameParts = extractSurnameFromSegment(segment);
    if (nameParts.surname && !surname) {
      surname = nameParts.surname;
      if (nameParts.prefix && !licenceRef) licenceRef = nameParts.prefix;
      continue;
    }

    if (!licenceRef && /^[A-Z0-9]{6,20}$/i.test(segment) && /\d/.test(segment)) {
      licenceRef = segment.toUpperCase();
    }
  }

  const allDates = [...trimmed.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]);
  const licenceExpiryDate =
    allDates.filter((d) => d !== dateOfBirth).sort().at(-1) ??
    (allDates.length === 1 ? undefined : allDates.at(-1));

  const personIdNumber = extractSaIdFromText(trimmed);
  const certificateRef = cleanSegment(parts[3]);

  const complete = Boolean(surname || personIdNumber);

  return {
    personSurname: surname,
    personFullName: surname,
    personIdNumber,
    personDateOfBirth: dateOfBirth,
    driversLicenceNumber: licenceRef ?? certificateRef,
    licenceExpiryDate,
    vehicleCodes: vehicleCodes.length ? [...new Set(vehicleCodes)] : undefined,
    certificateRef,
    complete,
    hint: complete
      ? personIdNumber
        ? undefined
        : "Temporary licence — add ID number manually if it is not on the barcode."
      : "Could not read name from temporary licence barcode. Enter details manually.",
  };
}
