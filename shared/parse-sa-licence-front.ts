/** Validate a 13-digit South African ID number (Luhn variant). */
export function isValidSaIdNumber(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    let digit = Number(id[i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  const check = (10 - (sum % 10)) % 10;
  return check === Number(id[12]);
}

export type ParsedLicenceFrontOcr = {
  personIdNumber?: string;
  personFullName?: string;
  surname?: string;
  initials?: string;
  driversLicenceNumber?: string;
  hint?: string;
};

/** Find all 13-digit SA ID candidates in OCR text and return the first valid one. */
export function extractSaIdFromOcrText(text: string): string | null {
  const compact = text.replace(/\s+/g, "");
  const spaced = text.replace(/[^\d]/g, " ").split(/\s+/).filter(Boolean);

  const candidates = new Set<string>();

  for (const match of compact.matchAll(/\d{13}/g)) {
    candidates.add(match[0]!);
  }

  for (const chunk of spaced) {
    if (chunk.length === 13) candidates.add(chunk);
  }

  for (const id of candidates) {
    if (isValidSaIdNumber(id)) return id;
  }

  return null;
}

/** Best-effort licence number (often 12 digits on the card front). */
export function extractLicenceNumberFromOcrText(text: string): string | null {
  const labelled = text.match(
    /(?:licen[cs]e|lic|dl)\s*(?:no|number|#)?\s*[:\.]?\s*(\d{10,14})/i,
  );
  if (labelled?.[1]) return labelled[1].replace(/\s/g, "");

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^\d{12}$/.test(trimmed.replace(/\s/g, ""))) {
      return trimmed.replace(/\s/g, "");
    }
  }

  return null;
}

function cleanNameLine(line: string): string {
  return line
    .replace(/[^A-Za-zÀ-ÿ' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse OCR text from the front of a SA driver's licence.
 * Primary goal: reliable 13-digit ID; names are best-effort.
 */
export function parseSaLicenceFrontOcr(text: string): ParsedLicenceFrontOcr {
  const personIdNumber = extractSaIdFromOcrText(text) ?? undefined;
  const driversLicenceNumber = extractLicenceNumberFromOcrText(text) ?? undefined;

  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 1);

  let surname: string | undefined;
  let initials: string | undefined;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const lower = line.toLowerCase();

    if (/^surname\b/i.test(lower)) {
      const fromLabel = line.replace(/^surname\s*[:\.]?\s*/i, "").trim();
      if (fromLabel.length >= 2) surname = cleanNameLine(fromLabel);
      else if (lines[i + 1]) surname = cleanNameLine(lines[i + 1]!);
      continue;
    }

    if (/^(initials?|names?)\b/i.test(lower)) {
      const fromLabel = line.replace(/^(initials?|names?)\s*[:\.]?\s*/i, "").trim();
      if (fromLabel.length >= 1) initials = cleanNameLine(fromLabel);
      else if (lines[i + 1]) initials = cleanNameLine(lines[i + 1]!);
      continue;
    }

    if (/^identity\b/i.test(lower) && lines[i + 1] && !surname) {
      const prev = lines[i - 1];
      if (prev && /^[A-Z][A-Z' -]{2,}$/.test(prev)) surname = cleanNameLine(prev);
    }
  }

  // Fallback: line before a line containing "identity" or the ID number
  if (!surname) {
    for (let i = 0; i < lines.length; i++) {
      if (/identity|id\s*number/i.test(lines[i]!) && i > 0) {
        const candidate = cleanNameLine(lines[i - 1]!);
        if (candidate.length >= 2 && /^[A-Za-z]/.test(candidate)) {
          surname = candidate;
          break;
        }
      }
    }
  }

  // Fallback: two consecutive uppercase name lines near top (skip header)
  if (!surname) {
    for (const line of lines.slice(0, 12)) {
      const cleaned = cleanNameLine(line);
      if (
        cleaned.length >= 3 &&
        cleaned.length <= 32 &&
        /^[A-Z][A-Z' -]+$/.test(cleaned) &&
        !/republic|south africa|driv|licen|department|transport/i.test(cleaned)
      ) {
        if (!surname) surname = cleaned;
        else if (!initials && cleaned.length <= 8) {
          initials = cleaned;
          break;
        }
      }
    }
  }

  const personFullName = [initials, surname].filter(Boolean).join(" ").trim() || surname;

  if (!personIdNumber && !personFullName) {
    return {
      hint: "Could not read the front of the licence. Use brighter light, hold steady, and fill the frame with the text side.",
    };
  }

  if (personIdNumber && !personFullName) {
    return {
      personIdNumber,
      driversLicenceNumber,
      hint: "ID number found — please confirm the name on the form.",
    };
  }

  return {
    personIdNumber,
    personFullName,
    surname,
    initials,
    driversLicenceNumber,
  };
}
