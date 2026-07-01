import type { AccessEntryCategory } from "@shared/schema";

export const ACCESS_CATEGORY_LABELS: Record<AccessEntryCategory, string> = {
  visitor: "Visitor",
  contractor: "Contractor",
  delivery: "Delivery",
  official_vehicle: "Official Vehicle",
  other: "Other",
};

export const DESTINATION_TYPE_OPTIONS = [
  { value: "building", label: "Building" },
  { value: "office", label: "Office" },
  { value: "warehouse", label: "Warehouse" },
  { value: "plant", label: "Plant / Yard" },
  { value: "other", label: "Other" },
] as const;
