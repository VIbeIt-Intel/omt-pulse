import { cn } from "@/lib/utils";

/** Shared layout for Person / Vehicle / SAPS / Description toggles on Report Incident. */
export const incidentOptionTileBase = cn(
  "flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 px-2 py-4 w-full",
  "hover:border-primary/50 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
  "min-h-[5.5rem] h-full",
);

export const incidentOptionTileInactive = cn(
  "border-border bg-card text-muted-foreground shadow-sm",
);

export const incidentOptionTileActive = cn(
  "border-primary/60 bg-primary/10 ring-1 ring-primary/25 text-primary",
);

export function incidentOptionTileClass(active: boolean) {
  return cn(incidentOptionTileBase, active ? incidentOptionTileActive : incidentOptionTileInactive);
}

export function incidentOptionTileIconWrap(active: boolean) {
  return cn(
    "flex h-11 w-11 items-center justify-center rounded-full",
    active ? "bg-primary/15 text-primary" : "bg-primary/10 text-primary",
  );
}

export const incidentOptionTileIconClass = "h-5 w-5 shrink-0";
export const incidentOptionTileLabelClass = "text-xs font-semibold leading-tight text-center";
export const incidentOptionTileSubLabelClass =
  "block text-[11px] font-normal text-muted-foreground mt-0.5";

export const incidentOptionTileGridClass = "grid grid-cols-2 gap-2.5";

/** Person + Vehicle + SAPS tiles on one row (Report Incident). */
export const incidentOptionTileGridThreeClass = "grid grid-cols-3 gap-2.5";
