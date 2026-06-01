import type { Category } from "@shared/schema";

/** Platform-managed response modes (Panic SOS, Live GPS tracking). */
export function isSystemResponseMode(cat: Pick<Category, "isSystem">): boolean {
  return cat.isSystem === true;
}

/** Types admins configure and users pick when logging a normal incident. */
export function isManualIncidentType(cat: Pick<Category, "isSystem">): boolean {
  return !isSystemResponseMode(cat);
}

/** Types offered when closing panic/live — real classifications plus optional "keep as Panic". */
export function isCloseReclassifyType(cat: Pick<Category, "name">): boolean {
  return cat.name.toLowerCase() !== "live incident";
}

export const SYSTEM_MODE_DESCRIPTIONS: Record<string, string> = {
  Panic: "SOS alert — triggered by the panic button",
  "Live Incident": "GPS tracking — triggered when starting a live incident",
};

/** Dedupe system categories (one row per command) for admin display. */
export function uniqueSystemResponseModes(categories: Category[]): Category[] {
  const seen = new Map<string, Category>();
  for (const cat of categories) {
    if (!isSystemResponseMode(cat)) continue;
    if (!seen.has(cat.name)) seen.set(cat.name, cat);
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
