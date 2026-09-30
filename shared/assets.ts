/** Company property tracked on the Assets board (tablets, plant, cases). */
export const ASSET_TYPES = ["tablet", "generator", "toolbox", "equipment", "other"] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  tablet: "Tablet",
  generator: "Generator",
  toolbox: "Toolbox",
  equipment: "Equipment",
  other: "Other",
};

export function isAssetType(value: string): value is AssetType {
  return (ASSET_TYPES as readonly string[]).includes(value);
}

/** Sent by the asset tracker app. Not a user session. */
export const ASSET_TRACKER_TOKEN_HEADER = "x-omt-asset-token";
