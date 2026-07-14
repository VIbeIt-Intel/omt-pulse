/**
 * Best-effort parsers for South African access-control barcodes.
 *
 * Smart ID PDF417: pipe-delimited text (Surname|Names|…|ID Number|…).
 * Driver's licence PDF417: 720-byte RSA-encrypted SADL payload.
 * Green ID book Code 39: 13-digit ID only — no name in barcode.
 * Vehicle licence disc PDF417: encrypted in eNaTIS — use Photo of disc for full fields.
 */

import { isPlausibleSaVehicleRegistration } from "@shared/parse-sa-licence-disc";
import { parseSaMvlDiscBarcode } from "@shared/parse-sa-mvl-disc";

import {
  looksLikeSadlEncryptedString,
  type SaDriversLicence,
  driversLicenceToParsedFields,
} from "@shared/sa-drivers-licence";
import type { AccessScanMethod } from "@shared/access-scan-data";

export type ParsedSaId = {
  personFullName?: string;
  personIdNumber?: string;
  personSurname?: string;
  personGivenNames?: string;
  personSex?: string;
  personNationality?: string;
  personDateOfBirth?: string;
  personCountryOfBirth?: string;
  personCitizenshipStatus?: string;
  extraFields?: string[];
  /** True when barcode only had ID digits (green book / partial scan). */
  idOnly?: boolean;
  documentType?: "smart_id" | "drivers_licence" | "id_book";
  driversLicenceNumber?: string;
  licenceExpiryDate?: string;
  licenceValidFrom?: string;
  vehicleCodes?: string[];
  prdpCode?: string;
  prdpExpiryDate?: string;
  driversLicence?: SaDriversLicence;
  hint?: string;
};

export type ParsedSaVehicleDisc = {
  registration?: string;
  make?: string;
  model?: string;
  colour?: string;
  licenceDiscData: string;
  hint?: string;
};

export function parsedSaIdFromDriversLicence(dl: SaDriversLicence): ParsedSaId {
  return {
    ...driversLicenceToParsedFields(dl),
    driversLicence: dl,
    personSex: dl.gender === "male" ? "M" : dl.gender === "female" ? "F" : undefined,
    personDateOfBirth: dl.birthdate || undefined,
    personSurname: dl.surname || undefined,
    personGivenNames: dl.initials || undefined,
  };
}

export type AccessIdentityScanResult =
  | { kind: "raw"; value: string }
  | { kind: "parsed"; parsed: ParsedSaId; scanMethod?: AccessScanMethod };

/** Smart ID pipe text, driver's licence binary, or green-book ID-only. */
export function parseSaIdentityScan(raw: string): ParsedSaId {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return {};

    if (trimmed.includes("|")) {
      return { ...parseSaIdBarcode(trimmed), documentType: "smart_id" };
    }

    if (looksLikeSadlEncryptedString(trimmed)) {
      return {
        documentType: "drivers_licence",
        hint: "Driver's licence detected — use Scan or Take photo to decode.",
      };
    }

    return parseSaIdBarcode(trimmed);
  } catch {
    return {
      hint: "Could not read this barcode. Enter details manually or try Scan photo.",
    };
  }
}

/** Smart ID: SURNAME|NAMES|SEX|NATIONALITY|ID|DOB|… */
export function parseSaIdBarcode(raw: string): ParsedSaId {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.includes("|")) {
    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length >= 5) {
      const surname = parts[0] ?? "";
      const names = parts[1] ?? "";
      const sex = parts[2] ?? "";
      const nationality = parts[3] ?? "";
      const idNumber = (parts[4] ?? "").replace(/\s/g, "");
      const dateOfBirth = parts[5] ?? "";
      const countryOfBirth = parts[6] ?? "";
      const citizenshipStatus = parts[7] ?? "";
      const extraFields = parts.length > 8 ? parts.slice(8).filter(Boolean) : undefined;
      const fullName = [names, surname].filter(Boolean).join(" ").trim();
      return {
        personFullName: fullName || undefined,
        personIdNumber: idNumber || undefined,
        personSurname: surname || undefined,
        personGivenNames: names || undefined,
        personSex: sex || undefined,
        personNationality: nationality || undefined,
        personDateOfBirth: dateOfBirth || undefined,
        personCountryOfBirth: countryOfBirth || undefined,
        personCitizenshipStatus: citizenshipStatus || undefined,
        extraFields,
      };
    }
  }

  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 13 && /^\d{13}$/.test(digitsOnly)) {
    return {
      personIdNumber: digitsOnly,
      idOnly: true,
      documentType: "id_book",
      hint:
        "Only the ID number was read. Scan the large square PDF417 on the back of a Smart ID or driver's licence (hold steady for 2–3 seconds).",
    };
  }

  return { personIdNumber: trimmed };
}

/**
 * Vehicle disc — MVL percent-delimited text from PDF417 (not SADL / not RSA like driver's licence).
 */
export function parseSaVehicleDiscBarcode(raw: string): ParsedSaVehicleDisc {
  const trimmed = raw.trim();
  if (!trimmed) return { licenceDiscData: "" };

  if (trimmed.includes("%")) {
    const mvl = parseSaMvlDiscBarcode(trimmed);
    return {
      registration: mvl.registration,
      make: mvl.make,
      model: mvl.model ?? mvl.description,
      colour: mvl.colour,
      licenceDiscData: trimmed,
      hint: mvl.hint,
    };
  }

  const plateLike = trimmed.replace(/\s/g, "").toUpperCase();
  if (isPlausibleSaVehicleRegistration(plateLike)) {
    return {
      registration: plateLike,
      licenceDiscData: trimmed,
      hint: "Use Photo of disc for make and model if they are missing.",
    };
  }

  return {
    licenceDiscData: trimmed,
    hint: "Could not read vehicle details from this barcode. Use Photo of disc or enter manually.",
  };
}
