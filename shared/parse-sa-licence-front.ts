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

/** First 6 digits are YYMMDD — reject Luhn-valid garbage from OCR noise. */
export function isPlausibleSaIdBirthDate(id: string): boolean {
  if (!/^\d{13}$/.test(id)) return false;
  const yy = Number(id.slice(0, 2));
  const mm = Number(id.slice(2, 4));
  const dd = Number(id.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return false;
  // SA IDs issued ~1920–2010s for adults; allow wide range.
  return yy <= 99;
}

const LICENCE_HEADER_WORDS =
  /republic|south africa|driv|licen|licen[cç]a|conduc|cart|carta|department|transport|sadc|identity|birth|valid|issued|vehicle|restriction|official|za\b/i;

/** Field labels printed on the card — never person names (e.g. "MALE" from the gender line). */
const LICENCE_FIELD_LABELS =
  /^(male|female|restriction|restrictions|valid|issued|identity|birth|date|official|vehicle|code|codes|country|za|none|nil)$/i;

/** Extract birth date from OCR as YYMMDD for cross-checking the ID number prefix. */
export function extractBirthDateYymmddFromOcrText(text: string): string | null {
  for (const match of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-]((19|20)\d{2})\b/g)) {
    const dd = Number(match[1]);
    const mm = Number(match[2]);
    const yyyy = Number(match[3]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    const yy = yyyy % 100;
    return `${String(yy).padStart(2, "0")}${String(mm).padStart(2, "0")}${String(dd).padStart(2, "0")}`;
  }
  return null;
}

export function idPrefixMatchesBirthDate(id: string, birthYymmdd: string): boolean {
  return /^\d{13}$/.test(id) && id.startsWith(birthYymmdd);
}

export function isPlausibleLicencePersonName(name: string): boolean {
  const cleaned = cleanNameLine(name);
  if (!isPlausibleNameToken(cleaned)) return false;
  if (LICENCE_FIELD_LABELS.test(cleaned)) return false;
  if (/^(MALE|FEMALE)$/i.test(cleaned)) return false;
  return true;
}

function isLicenceHeaderGarbage(line: string): boolean {
  const cleaned = cleanNameLine(line);
  if (cleaned.length < 2) return true;
  if (LICENCE_HEADER_WORDS.test(cleaned)) return true;
  // Fragments from bilingual header ("CARTA DE CONDUCAO")
  if (/\bCONDUC/i.test(cleaned) || /\bCARTA\b/i.test(cleaned)) return true;
  return false;
}

/** Reject OCR noise like "SH -" or single-letter fragments before treating a token as a name. */
function isPlausibleNameToken(raw: string): boolean {
  const t = raw.trim();
  if (t.length < 3) return false;
  // Must start and end with a letter — rejects trailing "-" / leading punctuation noise.
  if (!/^[A-Za-z][A-Za-z' -]*[A-Za-z]$/.test(t)) return false;
  // Needs at least 3 letters total (not just "S H").
  if ((t.match(/[A-Za-z]/g) ?? []).length < 3) return false;
  if (isLicenceHeaderGarbage(t)) return false;
  return true;
}

function scoreSaIdCandidate(
  id: string,
  text: string,
  indexInDigitRun: number,
  birthYymmdd: string | null,
): number {
  let score = 0;
  if (!isValidSaIdNumber(id)) return -1;
  score += 50;
  if (isPlausibleSaIdBirthDate(id)) score += 80;

  // When the card shows a birth date, the ID must start with YYMMDD — strongest filter.
  if (birthYymmdd) {
    if (idPrefixMatchesBirthDate(id, birthYymmdd)) score += 250;
    else return -1;
  }

  const idLabel = text.search(/id\s*(?:no|number)?\.?/i);
  if (idLabel >= 0) {
    const digitRun = ocrTextToDigitRuns(text);
    const idPos = digitRun.indexOf(id);
    const labelPos = ocrTextToDigitRuns(text.slice(0, idLabel)).length;
    if (idPos >= 0 && Math.abs(idPos - labelPos) < 24) score += 60;
  }

  // Prefer IDs found in labelled ID field runs over random sliding windows.
  if (indexInDigitRun < 0) score += 20;

  return score;
}

export type ParsedLicenceFrontOcr = {
  personIdNumber?: string;
  personFullName?: string;
  surname?: string;
  initials?: string;
  driversLicenceNumber?: string;
  hint?: string;
};

/** Map common OCR misreads to digits inside ID-like runs. */
function normalizeOcrDigitChar(ch: string): string {
  const c = ch.toUpperCase();
  if (c === "O" || c === "Q" || c === "D") return "0";
  if (c === "I" || c === "L" || c === "|" || c === "!") return "1";
  if (c === "Z") return "2";
  if (c === "S") return "5";
  if (c === "G") return "6";
  if (c === "B") return "8";
  if (c >= "0" && c <= "9") return c;
  return "";
}

/** Collapse OCR noise into digits only, fixing common letter→digit swaps. */
export function ocrTextToDigitRuns(text: string): string {
  let out = "";
  for (const ch of text) {
    out += normalizeOcrDigitChar(ch);
  }
  return out;
}

/** Find a valid SA ID in noisy OCR (plastic glare, split digits, O/0 confusion). */
export function extractSaIdFromOcrText(text: string): string | null {
  const birthYymmdd = extractBirthDateYymmddFromOcrText(text);
  const compact = text.replace(/\s+/g, "");
  const scored: { id: string; score: number }[] = [];

  function consider(id: string, indexInDigitRun = -1) {
    const score = scoreSaIdCandidate(id, text, indexInDigitRun, birthYymmdd);
    if (score >= 0) scored.push({ id, score });
  }

  for (const match of compact.matchAll(/\d{13}/g)) {
    consider(match[0]!, -1);
  }

  const spaced = text.replace(/[^\d]/g, " ").split(/\s+/).filter(Boolean);
  for (const chunk of spaced) {
    if (chunk.length === 13) consider(chunk, -1);
  }

  for (const match of text.matchAll(
    /(\d{2})\s*(\d{2})\s*(\d{2})\s*(\d{4})\s*(\d{2,3})/g,
  )) {
    const joined = `${match[1]}${match[2]}${match[3]}${match[4]}${match[5]}`.slice(0, 13);
    if (joined.length === 13) consider(joined, -1);
  }

  for (const match of text.matchAll(
    /(?:id\s*(?:no|number)?\.?|identity)\s*[:\.]?\s*([\dOIlSsBZo\s/]{10,24})/gi,
  )) {
    const digits = ocrTextToDigitRuns(match[1] ?? "");
    if (digits.length >= 13) {
      for (let i = 0; i <= digits.length - 13; i++) {
        consider(digits.slice(i, i + 13), i);
      }
    }
  }

  const digitRun = ocrTextToDigitRuns(text);
  for (let i = 0; i <= digitRun.length - 13; i++) {
    consider(digitRun.slice(i, i + 13), i);
  }

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best) {
    // Birth date visible but no Luhn-valid ID with matching prefix — don't guess.
    if (birthYymmdd) return null;
    return null;
  }

  // Require plausible birth date when multiple Luhn-valid noise hits exist.
  if (scored.length > 1 && !isPlausibleSaIdBirthDate(best.id)) {
    const plausible = scored.find((c) => isPlausibleSaIdBirthDate(c.id));
    if (plausible) return plausible.id;
  }

  return best.id;
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
  let personIdNumber = extractSaIdFromOcrText(text) ?? undefined;
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
      if (prev && isPlausibleNameToken(prev)) surname = cleanNameLine(prev);
    }
  }

  // Fallback: line before a line containing "identity" or the ID number
  if (!surname) {
    for (let i = 0; i < lines.length; i++) {
      if (/identity|id\s*number/i.test(lines[i]!) && i > 0) {
        const candidate = cleanNameLine(lines[i - 1]!);
        if (isPlausibleNameToken(candidate)) {
          surname = candidate;
          break;
        }
      }
    }
  }

  // "N VENTER" / "NV VENTER" on one line (common on card front)
  if (!surname) {
    for (const line of lines) {
      const cleaned = cleanNameLine(line);
      const m = cleaned.match(/^([A-Z](?:\.[A-Z]){0,3}|[A-Z]{1,3})\s+([A-Z][A-Z' -]{2,})$/);
      if (m && isPlausibleNameToken(m[2]!) && !isLicenceHeaderGarbage(cleaned)) {
        initials = cleanNameLine(m[1]!);
        surname = cleanNameLine(m[2]!);
        break;
      }
    }
  }

  // Line immediately before "ID No." label
  if (!surname) {
    for (let i = 0; i < lines.length; i++) {
      if (/id\s*no/i.test(lines[i]!) && i > 0) {
        const candidate = cleanNameLine(lines[i - 1]!);
        if (isPlausibleNameToken(candidate) && !isLicenceHeaderGarbage(candidate)) {
          const parts = candidate.split(/\s+/);
          if (parts.length >= 2 && parts[0]!.length <= 4 && isPlausibleNameToken(parts.slice(1).join(" "))) {
            initials = parts[0];
            surname = parts.slice(1).join(" ");
          } else if (parts.length === 1) {
            surname = candidate;
          }
          break;
        }
      }
    }
  }

  // Fallback: uppercase name lines (skip header)
  if (!surname) {
    for (const line of lines.slice(0, 14)) {
      const cleaned = cleanNameLine(line);
      if (
        cleaned.length <= 32 &&
        /^[A-Z][A-Z' -]+$/.test(cleaned) &&
        isPlausibleNameToken(cleaned) &&
        !isLicenceHeaderGarbage(cleaned)
      ) {
        if (!surname) surname = cleaned;
        else if (!initials && cleaned.length <= 8) {
          initials = cleaned;
          break;
        }
      }
    }
  }

  const personFullNameRaw = [initials, surname].filter(Boolean).join(" ").trim() || surname;
  let personFullName = personFullNameRaw && isPlausibleLicencePersonName(personFullNameRaw)
    ? personFullNameRaw
    : undefined;
  if (!personFullName) {
    surname = undefined;
    initials = undefined;
  }

  const birthYymmdd = extractBirthDateYymmddFromOcrText(text);
  if (
    personIdNumber &&
    birthYymmdd &&
    !idPrefixMatchesBirthDate(personIdNumber, birthYymmdd)
  ) {
    personIdNumber = undefined;
  }

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
