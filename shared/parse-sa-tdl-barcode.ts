/**
 * South African temporary driving licence / certificate PDF417 text (eNaTIS TDL format).
 * Percent-delimited like MVL discs — not the 720-byte RSA SADL card payload.
 *
 * Examples:
 * %TDL88%0092%8939A00C%1%893900007M20VENTER%B/2010-08-26/0%%%%%%2026-07-06%
 * %TDL…%893900007KXFMSVENTER%B/2003-08-20/…%  (licence + check letters + initials + surname)
 */

import { isValidSaIdNumber } from "./parse-sa-licence-front";

export type ParsedSaTdlBarcode = {
  personFullName?: string;
  personSurname?: string;
  personGivenNames?: string;
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

/** Short alpha tails on certificate numbers (e.g. KXF) — not surnames. */
function isCertificateSuffix(token: string): boolean {
  return /^[A-Z]{2,4}$/.test(token);
}

function isPlausibleSurname(token: string): boolean {
  if (!/^[A-Z][A-Z' -]*[A-Z]$/.test(token) && !/^[A-Z]{3,}$/.test(token)) return false;
  if (token.length < 3) return false;
  if (isCertificateSuffix(token)) return false;
  if (ISO_DATE.test(token)) return false;
  return true;
}

type NameHit = {
  surname?: string;
  initials?: string;
  licenceRef?: string;
};

function digitLicencePrefix(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  const m = ref.match(/^\d{6,12}/);
  return m?.[0];
}

/**
 * Pull licence ref / initials / surname from a TDL segment.
 * Must not treat certificate check-letters (KXF on 893900007KXF) as the person's name.
 */
export function extractNameFromTdlSegment(segment: string): NameHit {
  const trimmed = segment.trim().toUpperCase();
  if (!trimmed) return {};

  // Pure alphabetic / spaced name — no digits.
  if (!/\d/.test(trimmed) && /^[A-Z][A-Z' -]{1,39}$/.test(trimmed)) {
    const spaced = trimmed.match(/^([A-Z]{1,5})\s+([A-Z][A-Z' -]{1,39})$/);
    if (spaced && isPlausibleSurname(spaced[2]!)) {
      return { initials: spaced[1], surname: spaced[2] };
    }
    if (isPlausibleSurname(trimmed)) return { surname: trimmed };
    return {};
  }

  const head = trimmed.match(/^(\d{6,12})([A-Z0-9]*)$/);
  if (!head) return {};
  const licenceDigits = head[1]!;
  const rest = head[2] ?? "";

  // Certificate number only — digits + short alpha suffix (NOT a name).
  // e.g. 893900007KXF
  if (/^[A-Z]{2,4}$/.test(rest)) {
    return { licenceRef: trimmed };
  }

  // Try stripping a 2–4 letter certificate suffix, then initials (prefer 2, then 1, then 3) + surname.
  // e.g. 893900007KXFMSVENTER → licence 893900007KXF, initials MS, surname VENTER
  if (/^[A-Z]+$/.test(rest) && rest.length >= 5) {
    for (const checkLen of [3, 2, 4, 0]) {
      if (rest.length < checkLen + 5 && checkLen > 0) continue;
      const check = checkLen > 0 ? rest.slice(0, checkLen) : "";
      const nameBody = rest.slice(checkLen);
      if (!nameBody) continue;
      for (const initLen of [2, 1, 3]) {
        if (nameBody.length < initLen + 4) continue;
        const init = nameBody.slice(0, initLen);
        const sur = nameBody.slice(initLen);
        if (!/^[A-Z]+$/.test(init) || !isPlausibleSurname(sur)) continue;
        return {
          licenceRef: check ? `${licenceDigits}${check}` : licenceDigits,
          initials: init,
          surname: sur,
        };
      }
      // nameBody is the surname alone (no initials encoded)
      if (isPlausibleSurname(nameBody) && nameBody.length >= 4) {
        return {
          licenceRef: check ? `${licenceDigits}${check}` : licenceDigits,
          surname: nameBody,
        };
      }
    }
  }

  // licence + initials + optional issue digits + surname
  // e.g. 893900007M20VENTER → 893900007 | M | 20 | VENTER
  const classic = rest.match(/^([A-Z]{1,3})(\d{0,4})([A-Z]{3,40})$/);
  if (classic && isPlausibleSurname(classic[3]!) && classic[3]!.length >= 4) {
    return {
      licenceRef: licenceDigits,
      initials: classic[1],
      surname: classic[3],
    };
  }

  // Fallback: trailing long surname after digit/alnum prefix.
  const glued = trimmed.match(/^(\d[A-Z0-9]*?)([A-Z]{4,})$/);
  if (glued && isPlausibleSurname(glued[2]!)) {
    return { licenceRef: glued[1], surname: glued[2] };
  }

  return {};
}

function parseCodeDobSegment(segment: string): { code?: string; dateOfBirth?: string } {
  const match = segment.trim().match(/^([A-Z]{1,3})\/(\d{4}-\d{2}-\d{2})(?:\/|$)/i);
  if (!match) return {};
  return { code: match[1]!.toUpperCase(), dateOfBirth: match[2] };
}

function digitCount(value: string): number {
  return (value.match(/\d/g) ?? []).length;
}

function preferLicenceRef(current: string | undefined, incoming: string): string {
  if (!current) return incoming;
  if (digitCount(incoming) > digitCount(current)) return incoming;
  if (digitCount(incoming) === digitCount(current) && incoming.length > current.length) return incoming;
  return current;
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
  let initials: string | undefined;
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

    const nameParts = extractNameFromTdlSegment(segment);
    if (nameParts.surname && (!surname || (isCertificateSuffix(surname) && !isCertificateSuffix(nameParts.surname)))) {
      surname = nameParts.surname;
      if (nameParts.initials) initials = nameParts.initials;
    } else if (nameParts.initials && !initials) {
      initials = nameParts.initials;
    }
    if (nameParts.licenceRef) {
      licenceRef = preferLicenceRef(licenceRef, nameParts.licenceRef.toUpperCase());
    } else if (
      /^[A-Z0-9]{6,20}$/i.test(segment) &&
      /\d/.test(segment) &&
      !(segment.length === 13 && isValidSaIdNumber(segment)) &&
      !extractNameFromTdlSegment(segment).surname
    ) {
      // Generic certificate-like token — never treat a 13-digit SA ID as the licence number.
      licenceRef = preferLicenceRef(licenceRef, segment.toUpperCase());
    }
  }

  const allDates = [...trimmed.matchAll(/\d{4}-\d{2}-\d{2}/g)].map((m) => m[0]);
  const licenceExpiryDate =
    allDates.filter((d) => d !== dateOfBirth).sort().at(-1) ??
    (allDates.length === 1 ? undefined : allDates.at(-1));

  const personIdNumber = extractSaIdFromText(trimmed);
  const certificateRef = cleanSegment(parts[3]);
  const driversLicenceNumber =
    digitLicencePrefix(licenceRef) ??
    digitLicencePrefix(certificateRef) ??
    licenceRef ??
    certificateRef;

  if (surname && isCertificateSuffix(surname)) {
    surname = undefined;
  }

  const personFullName = [initials, surname].filter(Boolean).join(" ").trim() || surname;
  const complete = Boolean(surname || personIdNumber);

  return {
    personSurname: surname,
    personGivenNames: initials,
    personFullName: personFullName || undefined,
    personIdNumber,
    personDateOfBirth: dateOfBirth,
    driversLicenceNumber,
    licenceExpiryDate,
    vehicleCodes: vehicleCodes.length ? [...new Set(vehicleCodes)] : undefined,
    certificateRef,
    complete,
    hint: complete
      ? surname
        ? undefined
        : personIdNumber
          ? "Temporary licence — name not in barcode. Enter full name manually."
          : "Temporary licence — add ID number manually if it is not on the barcode."
      : "Could not read name from temporary licence barcode. Enter details manually.",
  };
}
