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

export type SeverityGroupKey = "high" | "medium" | "low" | "general" | "other";

export const SEVERITY_GROUP_ORDER: SeverityGroupKey[] = ["high", "medium", "low", "general", "other"];

export const SEVERITY_GROUP_LABELS: Record<SeverityGroupKey, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  general: "General",
  other: "Other",
};

export const SEVERITY_GROUP_HINTS: Record<SeverityGroupKey, string> = {
  high: "Administrators & supervisors notified",
  medium: "Administrators & supervisors notified",
  low: "Administrators & supervisors notified",
  general: "Administrators & supervisors notified",
  other: "Administrators & supervisors notified",
};

export function getSeverityGroupKey(cat: Pick<Category, "severity" | "isOther">): SeverityGroupKey {
  if (cat.isOther) return "other";
  if (cat.severity === "red") return "high";
  if (cat.severity === "orange") return "medium";
  if (cat.severity === "yellow") return "low";
  return "general";
}

export type SeverityGroup = {
  key: SeverityGroupKey;
  label: string;
  hint: string;
  types: Category[];
};

const sortByName = (a: Category, b: Category) => a.name.localeCompare(b.name);

/** Group manual incident types by alert severity — matches the log-incident type picker. */
export function groupManualIncidentTypes(categories: Category[]): SeverityGroup[] {
  const manual = categories.filter(isManualIncidentType);
  return SEVERITY_GROUP_ORDER.map((key) => ({
    key,
    label: SEVERITY_GROUP_LABELS[key],
    hint: SEVERITY_GROUP_HINTS[key],
    types: manual.filter((c) => getSeverityGroupKey(c) === key).sort(sortByName),
  })).filter((g) => g.types.length > 0);
}

/** Manual types excluding "Other" — for standard type pickers. */
export function getEligibleManualTypes(categories: Category[]): Category[] {
  return categories.filter((c) => isManualIncidentType(c) && !c.isOther);
}

/** Manual "Other" types only. */
export function getOtherManualTypes(categories: Category[]): Category[] {
  return categories.filter((c) => isManualIncidentType(c) && c.isOther).sort(sortByName);
}

/** Dedupe system categories (one row per command) for admin display. */
export function uniqueSystemResponseModes(categories: Category[]): Category[] {
  const seen = new Map<string, Category>();
  for (const cat of categories) {
    if (!isSystemResponseMode(cat)) continue;
    if (!seen.has(cat.name)) seen.set(cat.name, cat);
  }
  return Array.from(seen.values()).sort((a, b) => a.name.localeCompare(b.name));
}
