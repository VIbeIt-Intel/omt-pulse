import type { SaDriversLicence } from "./sa-drivers-licence";

export const ACCESS_SCAN_METHODS = ["barcode", "ocr_front", "ocr_back", "manual"] as const;
export type AccessScanMethod = (typeof ACCESS_SCAN_METHODS)[number];

export type AccessScanIdentity = {
  fullName?: string;
  idNumber?: string;
  surname?: string;
  givenNames?: string;
  sex?: string;
  nationality?: string;
  dateOfBirth?: string;
  countryOfBirth?: string;
  citizenshipStatus?: string;
};

export type AccessScanDriversLicence = {
  licenceNumber?: string;
  issueDate?: string;
  expiryDate?: string;
  issueNumber?: string;
  vehicleCodes?: string[];
  vehicleRestrictions?: string[];
  licenceCodeIssueDates?: string[];
  driverRestrictionCodes?: string;
  prdpCode?: string;
  prdpExpiryDate?: string;
  gender?: string;
  birthdate?: string;
  idNumberType?: string;
  idCountryOfIssue?: string;
  licenceCountryOfIssue?: string;
};

/** Structured scan capture stored on each access log for investigations. */
export type AccessScanData = {
  capturedAt: string;
  scanMethod: AccessScanMethod;
  documentType?: "smart_id" | "drivers_licence" | "temporary_drivers_licence" | "id_book";
  identity: AccessScanIdentity;
  driversLicence?: AccessScanDriversLicence;
  /** Unmapped Smart ID pipe fields (index 8+). */
  extraFields?: string[];
  /** Truncated raw barcode text for audit (never full encrypted SADL). */
  rawBarcodePreview?: string;
};

/** Input shape from client parsers — mirrors ParsedSaId without importing client code. */
export type AccessScanCaptureInput = {
  documentType?: "smart_id" | "drivers_licence" | "temporary_drivers_licence" | "id_book";
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
  driversLicenceNumber?: string;
  licenceExpiryDate?: string;
  licenceValidFrom?: string;
  vehicleCodes?: string[];
  prdpCode?: string;
  prdpExpiryDate?: string;
  driversLicence?: SaDriversLicence;
};

const RAW_PREVIEW_MAX = 480;

function clean(value: string | undefined | null): string | undefined {
  const v = value?.trim();
  return v || undefined;
}

function driversLicenceFromSadl(dl: SaDriversLicence): AccessScanDriversLicence {
  return {
    licenceNumber: clean(dl.licenseNumber),
    issueDate: clean(dl.licenseIssueDate),
    expiryDate: clean(dl.licenseExpiryDate),
    issueNumber: clean(dl.licenseIssueNumber),
    vehicleCodes: dl.vehicleCodes?.length ? dl.vehicleCodes : undefined,
    vehicleRestrictions: dl.vehicleRestrictions?.length ? dl.vehicleRestrictions : undefined,
    licenceCodeIssueDates: dl.licenseCodeIssueDates?.length ? dl.licenseCodeIssueDates : undefined,
    driverRestrictionCodes: clean(dl.driverRestrictionCodes),
    prdpCode: clean(dl.prdpCode),
    prdpExpiryDate: clean(dl.prdpExpiryDate),
    gender: dl.gender,
    birthdate: clean(dl.birthdate),
    idNumberType: clean(dl.idNumberType),
    idCountryOfIssue: clean(dl.idCountryOfIssue),
    licenceCountryOfIssue: clean(dl.licenseCountryOfIssue),
  };
}

function hasIdentityData(identity: AccessScanIdentity): boolean {
  return Object.values(identity).some((v) => v != null && String(v).trim() !== "");
}

function hasDriversLicenceData(dl: AccessScanDriversLicence | undefined): boolean {
  if (!dl) return false;
  return Object.entries(dl).some(([, v]) => {
    if (Array.isArray(v)) return v.length > 0;
    return v != null && String(v).trim() !== "";
  });
}

export function buildAccessScanData(
  parsed: AccessScanCaptureInput,
  scanMethod: AccessScanMethod,
  rawBarcode?: string,
): AccessScanData | null {
  const dl = parsed.driversLicence;
  const identity: AccessScanIdentity = {
    fullName: clean(parsed.personFullName),
    idNumber: clean(parsed.personIdNumber),
    surname: clean(parsed.personSurname),
    givenNames: clean(parsed.personGivenNames),
    sex: clean(parsed.personSex) ?? (dl?.gender ? (dl.gender === "male" ? "M" : "F") : undefined),
    nationality: clean(parsed.personNationality),
    dateOfBirth: clean(parsed.personDateOfBirth) ?? clean(dl?.birthdate),
    countryOfBirth: clean(parsed.personCountryOfBirth),
    citizenshipStatus: clean(parsed.personCitizenshipStatus),
  };

  const driversLicence: AccessScanDriversLicence | undefined = dl
    ? driversLicenceFromSadl(dl)
    : parsed.documentType === "drivers_licence" || parsed.documentType === "temporary_drivers_licence"
      ? {
          licenceNumber: clean(parsed.driversLicenceNumber),
          issueDate: clean(parsed.licenceValidFrom),
          expiryDate: clean(parsed.licenceExpiryDate),
          vehicleCodes: parsed.vehicleCodes?.length ? parsed.vehicleCodes : undefined,
          prdpCode: clean(parsed.prdpCode),
          prdpExpiryDate: clean(parsed.prdpExpiryDate),
        }
      : undefined;

  const hasDl = hasDriversLicenceData(driversLicence);
  const hasId = hasIdentityData(identity);
  const hasExtra = (parsed.extraFields?.length ?? 0) > 0;

  if (!hasId && !hasDl && !hasExtra && !rawBarcode?.trim()) {
    return null;
  }

  let rawBarcodePreview: string | undefined;
  if (rawBarcode?.trim()) {
    const trimmed = rawBarcode.trim();
    if (!trimmed.includes("|") && trimmed.length > 200) {
      rawBarcodePreview = `[encrypted payload ${trimmed.length} chars]`;
    } else {
      rawBarcodePreview =
        trimmed.length > RAW_PREVIEW_MAX ? `${trimmed.slice(0, RAW_PREVIEW_MAX)}…` : trimmed;
    }
  }

  return {
    capturedAt: new Date().toISOString(),
    scanMethod,
    documentType: parsed.documentType,
    identity,
    driversLicence: hasDl ? driversLicence : undefined,
    extraFields: parsed.extraFields?.length ? parsed.extraFields : undefined,
    rawBarcodePreview,
  };
}

/** One-line summary for activity lists. */
export function formatAccessScanSummary(data: AccessScanData | null | undefined): string | null {
  if (!data) return null;
  const parts: string[] = [];
  const id = data.identity;
  if (id.idNumber) parts.push(`ID ${id.idNumber}`);
  if (id.dateOfBirth) parts.push(`DOB ${id.dateOfBirth}`);
  if (id.sex) parts.push(id.sex);
  if (id.nationality) parts.push(id.nationality);
  const dl = data.driversLicence;
  if (dl?.licenceNumber) parts.push(`DL ${dl.licenceNumber}`);
  if (dl?.expiryDate) parts.push(`exp ${dl.expiryDate}`);
  if (dl?.vehicleCodes?.length) parts.push(dl.vehicleCodes.join("/"));
  if (dl?.prdpCode) parts.push(`PrDP ${dl.prdpCode}`);
  if (data.documentType === "smart_id" && data.extraFields?.length) {
    parts.push(`+${data.extraFields.length} fields`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/** Multi-line detail for expanded views. */
export function formatAccessScanDetailLines(data: AccessScanData | null | undefined): string[] {
  if (!data) return [];
  const lines: string[] = [];
  const id = data.identity;
  if (id.surname) lines.push(`Surname: ${id.surname}`);
  if (id.givenNames) lines.push(`Names: ${id.givenNames}`);
  if (id.fullName) lines.push(`Full name: ${id.fullName}`);
  if (id.idNumber) lines.push(`ID number: ${id.idNumber}`);
  if (id.sex) lines.push(`Sex: ${id.sex}`);
  if (id.nationality) lines.push(`Nationality: ${id.nationality}`);
  if (id.dateOfBirth) lines.push(`Date of birth: ${id.dateOfBirth}`);
  if (id.countryOfBirth) lines.push(`Country of birth: ${id.countryOfBirth}`);
  if (id.citizenshipStatus) lines.push(`Status: ${id.citizenshipStatus}`);
  const dl = data.driversLicence;
  if (dl?.licenceNumber) lines.push(`Licence no.: ${dl.licenceNumber}`);
  if (dl?.issueDate) lines.push(`Licence issued: ${dl.issueDate}`);
  if (dl?.expiryDate) lines.push(`Licence expires: ${dl.expiryDate}`);
  if (dl?.vehicleCodes?.length) lines.push(`Vehicle codes: ${dl.vehicleCodes.join(", ")}`);
  if (dl?.vehicleRestrictions?.length) {
    lines.push(`Restrictions: ${dl.vehicleRestrictions.join(", ")}`);
  }
  if (dl?.prdpCode) lines.push(`PrDP: ${dl.prdpCode}`);
  if (dl?.prdpExpiryDate) lines.push(`PrDP expires: ${dl.prdpExpiryDate}`);
  if (data.extraFields?.length) {
    lines.push(`Extra: ${data.extraFields.join(" | ")}`);
  }
  if (data.documentType) lines.push(`Document: ${data.documentType.replace("_", " ")}`);
  if (data.scanMethod) lines.push(`Scan: ${data.scanMethod.replace("_", " ")}`);
  return lines;
}
