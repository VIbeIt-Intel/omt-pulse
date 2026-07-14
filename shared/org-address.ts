/** Join South-African-style address parts into a single display/storage line. */
export function formatOrgAddress(parts: {
  street?: string | null;
  suburb?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
}): string {
  return [parts.street, parts.suburb, parts.city, parts.province, parts.postalCode]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean)
    .join(", ");
}
