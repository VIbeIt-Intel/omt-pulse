/**
 * Decode SA motor vehicle licence disc PDF417 text (MVL format).
 * Barcode is a percent-delimited string, NOT the 720-byte RSA SADL payload used on driver's licences.
 * Format documented by community decoders (e.g. license-disc-decode on npm).
 *
 * Example:
 * %MVL1CC08%0168%1001A6GK%1%1001055W4R60%CA419547%HXV436S%Sedan%MERCEDES-BENZ%W203%Grey%VIN%engine%2015-02-28%
 */

export type ParsedMvlDisc = {
  registration?: string;
  licenceNumber?: string;
  make?: string;
  model?: string;
  colour?: string;
  description?: string;
  vin?: string;
  engineNumber?: string;
  expiryDate?: string;
  controlNumber?: string;
  /** True when the scan string has enough segments for plate + make. */
  complete: boolean;
  hint?: string;
};

function firstSegment(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const part = value.split("/")[0]!.trim();
  return part || undefined;
}

/** Parse a raw MVL barcode string from PDF417 (percent-separated fields). */
export function parseSaMvlDiscBarcode(raw: string): ParsedMvlDisc {
  const trimmed = raw.trim();
  if (!trimmed.includes("%")) {
    return {
      complete: false,
      hint: "Not a licence disc barcode. Use Photo of disc or scan the square PDF417 on the disc.",
    };
  }

  const parts = trimmed.split("%");
  // parts[1] often "MVL1CC08" or similar header — fields start at index 4 per MVL layout
  const status = parts[4]?.trim() ?? "";
  const controlNumber = parts[5]?.trim() ?? "";
  const registration = parts[6]?.trim().toUpperCase() || undefined;
  const licenceNumber = parts[7]?.trim().toUpperCase() || undefined;
  const description = firstSegment(parts[8]);
  const make = parts[9]?.trim().toUpperCase() || undefined;
  const modelCode = parts[10]?.trim() || undefined;
  const colour = firstSegment(parts[11]);
  const vin = parts[12]?.trim().toUpperCase() || undefined;
  const engineNumber = parts[13]?.trim() || undefined;
  const expiryDate = parts[14]?.trim() || undefined;

  const model = modelCode && modelCode.length <= 32 ? modelCode : description;
  const complete = Boolean(registration && (make || description));

  if (!complete) {
    return {
      registration,
      licenceNumber,
      make,
      model,
      colour,
      description,
      vin,
      engineNumber,
      expiryDate,
      controlNumber: controlNumber || undefined,
      complete: false,
      hint:
        parts.length < 8
          ? "Barcode scan was incomplete — hold steady on the full square code, or use Photo of disc."
          : "Partial disc barcode — check registration or use Photo of disc for make and model.",
    };
  }

  return {
    registration,
    licenceNumber,
    make,
    model,
    colour,
    description,
    vin,
    engineNumber,
    expiryDate,
    controlNumber: controlNumber || undefined,
    complete: true,
  };
}
