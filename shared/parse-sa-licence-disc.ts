export type ParsedLicenceDiscOcr = {
  registration?: string;
  make?: string;
  model?: string;
  colour?: string;
  vin?: string;
  licenceNumber?: string;
  hint?: string;
};

/** SA plate / register number on the disc face (not the encrypted barcode fragment). */
export function isPlausibleSaVehicleRegistration(reg: string): boolean {
  const s = reg.replace(/\s/g, "").toUpperCase().replace(/\/[A-Z]{2}$/, "");
  if (s.length < 7 || s.length > 12) return false;
  if (!/^[A-Z0-9]+$/.test(s)) return false;
  if (!/[A-Z]/.test(s) || !/\d/.test(s)) return false;
  return true;
}

function cleanToken(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function afterLabel(text: string, labels: RegExp[]): string | null {
  for (const label of labels) {
    const re = new RegExp(`${label.source}\\s*:?\\s*([A-Z0-9][A-Z0-9 /\\-]{2,40})`, label.flags);
    const m = text.match(re);
    if (m?.[1]) return cleanToken(m[1]);
  }
  return null;
}

function scoreDiscParse(parsed: ParsedLicenceDiscOcr): number {
  let score = 0;
  if (parsed.registration && isPlausibleSaVehicleRegistration(parsed.registration)) score += 120;
  if (parsed.make && parsed.make.length >= 2) score += 40;
  if (parsed.model && parsed.model.length >= 2) score += 30;
  if (parsed.colour && parsed.colour.length >= 3) score += 15;
  if (parsed.vin && parsed.vin.length === 17) score += 20;
  return score;
}

/** Read visible text from a SA licence disc photo (OCR output). */
export function parseSaLicenceDiscOcr(text: string): ParsedLicenceDiscOcr {
  const normalized = text.replace(/\r/g, "\n");
  const flat = normalized.replace(/\s+/g, " ");

  const registrationRaw =
    afterLabel(flat, [/vrt\.?\s*registernr/i, /vehicle\s*register/i]) ??
    afterLabel(flat, [/registernr/i]);

  let registration: string | undefined;
  if (registrationRaw) {
    const token = registrationRaw.split(/\s+/)[0]!.replace(/[^A-Z0-9]/gi, "").toUpperCase();
    if (isPlausibleSaVehicleRegistration(token)) registration = token;
  }

  const licenceNumberRaw = afterLabel(flat, [/lisensienr/i, /licen[cs]e\s*nr/i]);
  const licenceNumber = licenceNumberRaw
    ? licenceNumberRaw.split(/\s+/)[0]!.replace(/[^A-Z0-9]/gi, "").toUpperCase()
    : undefined;

  const makeRaw = afterLabel(flat, [/fabrikaat/i, /\bmake\b/i]);
  const make = makeRaw
    ? makeRaw.split(/[/\n]/)[0]!.replace(/[^A-Za-z0-9\s-]/g, "").trim().toUpperCase()
    : undefined;

  const descRaw = afterLabel(flat, [/beskrywing/i, /description/i]);
  let model: string | undefined;
  if (descRaw) {
    const part = descRaw.split("/")[0]!.trim();
    model = part.replace(/\s+/g, " ").slice(0, 48);
    if (model.length < 2) model = undefined;
  }

  const colourRaw = afterLabel(flat, [/kleur/i, /\bcolour\b/i, /\bcolor\b/i]);
  const colour = colourRaw
    ? colourRaw.split(/[/\n]/)[0]!.replace(/[^A-Za-z\s-]/g, "").trim()
    : undefined;

  const vinMatch = flat.match(/\bVIN\s*:?\s*([A-HJ-NPR-Z0-9]{17})\b/i);
  const vin = vinMatch?.[1]?.toUpperCase();

  const parsed: ParsedLicenceDiscOcr = {
    registration,
    make: make && make.length >= 2 ? make : undefined,
    model,
    colour: colour && colour.length >= 3 ? colour : undefined,
    vin,
    licenceNumber,
  };

  if (!parsed.registration && !parsed.make && !parsed.model) {
    parsed.hint =
      "Could not read the disc. Photograph the printed face (registration, make, description) in good light — the square barcode alone does not give full vehicle details.";
  } else if (!parsed.registration) {
    parsed.hint = "Make/model read — check registration or enter plate manually.";
  }

  return parsed;
}

export function scoreLicenceDiscOcr(parsed: ParsedLicenceDiscOcr): number {
  return scoreDiscParse(parsed);
}
