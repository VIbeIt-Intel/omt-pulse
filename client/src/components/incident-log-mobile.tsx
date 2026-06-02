import type { Incident, Category } from "@shared/schema";
import { getIconSvg } from "@/lib/incident-icons";
import { resolveEffectiveSeverity, getReporterDisplayName, type IncidentWithMeta } from "@/lib/incident-display";
import { ChevronRight } from "lucide-react";

export type IncidentWithCount = IncidentWithMeta;

export function formatIncidentDateGroup(dateStr: string): string {
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (dateStr === todayStr) return "Today";
  if (dateStr === yesterdayStr) return "Yesterday";
  const d = new Date(`${dateStr}T12:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
}

export function sortIncidentsNewestFirst<T extends Incident>(incidents: T[]): T[] {
  return [...incidents].sort((a, b) => {
    if (a.incidentDate !== b.incidentDate) return a.incidentDate > b.incidentDate ? -1 : 1;
    const timeCmp = (b.incidentTime ?? "").localeCompare(a.incidentTime ?? "");
    if (timeCmp !== 0) return timeCmp;
    return b.id - a.id;
  });
}

export function groupIncidentsByDate<T extends Incident>(incidents: T[]): { date: string; label: string; items: T[] }[] {
  const sorted = sortIncidentsNewestFirst(incidents);
  const groups: { date: string; label: string; items: T[] }[] = [];
  for (const inc of sorted) {
    const last = groups[groups.length - 1];
    if (last?.date === inc.incidentDate) {
      last.items.push(inc);
    } else {
      groups.push({ date: inc.incidentDate, label: formatIncidentDateGroup(inc.incidentDate), items: [inc] });
    }
  }
  return groups;
}

function SeverityDot({ severity }: { severity: string | null | undefined }) {
  if (!severity || severity === "none") return null;
  const cls =
    severity === "red"
      ? "bg-red-500"
      : severity === "orange"
        ? "bg-orange-500"
        : "bg-yellow-400";
  return <span className={`h-2 w-2 shrink-0 rounded-full ${cls}`} aria-hidden="true" />;
}

function CategorySwatch({ category }: { category?: Category }) {
  return (
    <div
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full shadow-sm"
      style={{ backgroundColor: category?.color ?? "#6B7280" }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: getIconSvg(category?.icon) }}
      />
    </div>
  );
}

function LiveBadges({ incident }: { incident: Incident }) {
  if (incident.isLive) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-green-500/25 bg-green-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green-600 dark:text-green-400"
        data-testid={`badge-live-${incident.id}`}
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-green-500" />
        Live
      </span>
    );
  }
  if ((incident as Incident & { panicClosedAt?: string | null }).panicClosedAt) {
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/25 bg-red-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-red-600 dark:text-red-400"
        data-testid={`badge-panic-${incident.id}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
        Panic
      </span>
    );
  }
  return null;
}

export function IncidentLogMobileList({
  incidents,
  incidentNumberMap,
  categories,
  getCategoryName,
  getLocationDisplay,
  showCategory,
  showLocation,
  showDateTime,
  onSelect,
}: {
  incidents: IncidentWithCount[];
  incidentNumberMap: Map<number, string>;
  categories: Category[];
  getCategoryName: (inc: Incident) => string;
  getLocationDisplay: (inc: Incident) => { type: string; label: string };
  showCategory: boolean;
  showLocation: boolean;
  showDateTime: boolean;
  onSelect: (inc: IncidentWithCount) => void;
}) {
  const groups = groupIncidentsByDate(incidents);

  return (
    <div className="md:hidden">
      {groups.map((group) => (
        <section key={group.date}>
          <div className="sticky top-0 z-10 border-b border-border/60 bg-background/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{group.label}</p>
          </div>
          <div className="divide-y divide-border/50">
            {group.items.map((incident) => {
              const cat = categories.find((c) => c.id === incident.categoryId);
              const severity = resolveEffectiveSeverity(incident, cat);
              const reporter = getReporterDisplayName(incident);
              const incNum = incidentNumberMap.get(incident.id) ?? String(incident.id);
              const loc = getLocationDisplay(incident);
              const hasEvidence = incident.attachmentCount > 0;
              const meta = [
                !showCategory || !showDateTime ? null : incNum,
                showDateTime ? incident.incidentTime : null,
                reporter,
                showLocation && loc.label !== "-" ? loc.label : null,
                hasEvidence ? "Evidence: Yes" : null,
              ]
                .filter(Boolean)
                .join(" · ");

              return (
                <button
                  key={incident.id}
                  type="button"
                  className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/40 active:bg-muted/60"
                  onClick={() => onSelect(incident)}
                  data-testid={`row-incident-${incident.id}`}
                >
                  {showCategory ? (
                    <CategorySwatch category={cat} />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      #
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium leading-snug">
                        {showCategory ? getCategoryName(incident) : incNum}
                      </span>
                      <LiveBadges incident={incident} />
                      <SeverityDot severity={severity} />
                    </div>
                    {meta ? (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{meta}</p>
                    ) : null}
                    {showCategory && showDateTime ? (
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{incNum}</p>
                    ) : null}
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
