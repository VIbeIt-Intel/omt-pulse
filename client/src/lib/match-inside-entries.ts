import type { AccessLogWithDetails } from "@shared/schema";

export type CheckoutMatchQuery = {
  personIdNumber?: string;
  personFullName?: string;
  registration?: string;
};

export function normalizeSaId(id: string): string {
  return id.replace(/\D/g, "");
}

export function normalizePlate(reg: string): string {
  return reg.replace(/\s/g, "").toUpperCase();
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

function scoreEntry(entry: AccessLogWithDetails, query: CheckoutMatchQuery): number {
  let score = 0;
  const id = query.personIdNumber ? normalizeSaId(query.personIdNumber) : "";
  const plate = query.registration ? normalizePlate(query.registration) : "";
  const entryId = entry.personIdNumber ? normalizeSaId(entry.personIdNumber) : "";

  if (id.length === 13 && entryId.length === 13 && id === entryId) {
    return 1_000;
  }

  if (plate && entry.vehicle?.registration) {
    const entryPlate = normalizePlate(entry.vehicle.registration);
    if (entryPlate === plate) score += 800;
    else if (entryPlate.includes(plate) || plate.includes(entryPlate)) score += 400;
  }

  if (query.personFullName) {
    const qName = query.personFullName.trim().toLowerCase();
    const eName = entry.personFullName.trim().toLowerCase();
    if (qName && eName === qName) score += 600;
    else if (qName && eName.includes(qName)) score += 350;
    else if (qName && qName.includes(eName)) score += 300;
    else {
      const qTokens = nameTokens(qName);
      const eTokens = nameTokens(eName);
      const overlap = qTokens.filter((t) => eTokens.some((e) => e.includes(t) || t.includes(e)));
      if (overlap.length >= 2) score += 200;
      else if (overlap.length === 1) score += 80;
    }
  }

  return score;
}

/** Find currently-inside entries that match a scan or search query. */
export function matchInsideEntries(
  entries: AccessLogWithDetails[],
  query: CheckoutMatchQuery,
): AccessLogWithDetails[] {
  const id = query.personIdNumber ? normalizeSaId(query.personIdNumber) : "";
  const plate = query.registration ? normalizePlate(query.registration) : "";
  const name = query.personFullName?.trim() ?? "";

  if (!id && !plate && !name) return [];

  const scored = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.map(({ entry }) => entry);
}

/** Manual search box — name, ID digits, or plate fragment. */
export function matchInsideEntriesFromSearch(
  entries: AccessLogWithDetails[],
  raw: string,
): AccessLogWithDetails[] {
  const q = raw.trim();
  if (!q) return [];

  const digits = normalizeSaId(q);
  if (digits.length >= 6) {
    const byId = matchInsideEntries(entries, { personIdNumber: digits });
    if (byId.length) return byId;
  }

  const plateLike = normalizePlate(q);
  if (/^[A-Z0-9]{2,}$/i.test(plateLike)) {
    const byPlate = matchInsideEntries(entries, { registration: plateLike });
    if (byPlate.length) return byPlate;
  }

  return matchInsideEntries(entries, { personFullName: q });
}
