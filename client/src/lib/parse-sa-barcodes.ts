/**
 * Best-effort parsers for South African access-control barcodes.
 *
 * Smart ID PDF417: pipe-delimited text (Surname|Names|…|ID Number|…).
 * Green ID book Code 39: 13-digit ID only — no name in barcode.
 * Vehicle licence disc PDF417: encrypted in eNaTIS — full make/model/colour needs a licensed decoder SDK/API.
 */

export type ParsedSaId = {
  personFullName?: string;
  personIdNumber?: string;
  /** True when barcode only had ID digits (green book / partial scan). */
  idOnly?: boolean;
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

/** Smart ID: SURNAME|NAMES|SEX|NATIONALITY|ID|DOB|… */
export function parseSaIdBarcode(raw: string): ParsedSaId {
  const trimmed = raw.trim();
  if (!trimmed) return {};

  if (trimmed.includes("|")) {
    const parts = trimmed.split("|").map((p) => p.trim());
    if (parts.length >= 5) {
      const surname = parts[0] ?? "";
      const names = parts[1] ?? "";
      const idNumber = (parts[4] ?? "").replace(/\s/g, "");
      const fullName = [names, surname].filter(Boolean).join(" ").trim();
      return {
        personFullName: fullName || undefined,
        personIdNumber: idNumber || undefined,
      };
    }
  }

  const digitsOnly = trimmed.replace(/\D/g, "");
  if (digitsOnly.length === 13 && /^\d{13}$/.test(digitsOnly)) {
    return {
      personIdNumber: digitsOnly,
      idOnly: true,
      hint:
        "This scan only returned the ID number (common on green ID books). Please type the visitor's name.",
    };
  }

  return { personIdNumber: trimmed };
}

/**
 * Vehicle disc — partial text patterns only.
 * Example from field: %MVL1CC17%01 → registration L1CC17
 */
export function parseSaVehicleDiscBarcode(raw: string): ParsedSaVehicleDisc {
  const trimmed = raw.trim();
  if (!trimmed) return { licenceDiscData: "" };

  const mvMatch = trimmed.match(/^%MV([^%]+)(?:%(.+))?$/i);
  if (mvMatch) {
    const registration = mvMatch[1].trim().toUpperCase();
    return {
      registration,
      licenceDiscData: trimmed,
      hint:
        registration && !mvMatch[2]
          ? "Registration captured. Make, model and colour need the full licence-disc decode — enter manually or share a sample scan with us."
          : undefined,
    };
  }

  if (/^[A-Z]{1,3}\s?[0-9A-Z]{2,7}$/i.test(trimmed.replace(/\s/g, ""))) {
    return {
      registration: trimmed.replace(/\s/g, "").toUpperCase(),
      licenceDiscData: trimmed,
    };
  }

  return {
    licenceDiscData: trimmed,
    registration: trimmed.length <= 12 ? trimmed.toUpperCase() : undefined,
    hint: "Could not read all vehicle fields from this scan. Enter make, model and colour manually.",
  };
}
