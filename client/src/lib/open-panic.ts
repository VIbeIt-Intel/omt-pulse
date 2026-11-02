/** A live incident that is still an open panic. No age cutoff. */
export type LivePanicRow = {
  id: number;
  userId: string | null;
  categoryName?: string | null;
  panicClosedAt?: string | Date | null;
  responderFirstName?: string | null;
  responderLastName?: string | null;
};

export function isOpenPanic(row: LivePanicRow): boolean {
  if (row.panicClosedAt) return false;
  const name = (row.categoryName ?? "").toLowerCase();
  return name.includes("panic") || name.includes("paniek");
}
