import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";
import { PageHero } from "@/components/page-hero";

export function AnalyticsHero({
  periodLabel,
  total,
  topLoc,
  topCat,
  peakHour,
  insightKey,
  eyebrow = "Analytics",
}: {
  periodLabel: string;
  total: number;
  topLoc: string | null;
  topCat: string | null;
  peakHour: string | null;
  /** Remount key when date range changes — drives fade animation. */
  insightKey: string;
  eyebrow?: string;
}) {
  const insights = [
    topLoc ? { label: "Hotspot", value: topLoc } : null,
    topCat ? { label: "Lead type", value: topCat } : null,
    peakHour ? { label: "Peak hour", value: peakHour } : null,
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  return (
    <PageHero
      eyebrow={eyebrow}
      badge={periodLabel}
      total={total}
      totalLabel={total === 1 ? "Incident" : "Incidents"}
      emptyMessage="No incidents in this period — adjust the date range or clear filters."
      insights={insights}
      insightKey={insightKey}
      testId="analytics-hero"
      titleTestId="text-analytics-title"
      totalTestId="analytics-hero-total"
    />
  );
}

export type AnalyticsKpiItem = {
  id: string;
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  icon?: ReactNode;
  live?: boolean;
  testId?: string;
};

export function AnalyticsKpiStrip({ items }: { items: AnalyticsKpiItem[] }) {
  return (
    <div
      className="analytics-kpi-strip grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 rounded-xl border border-border/80 bg-card/80 overflow-hidden divide-x divide-y sm:divide-y-0 divide-border/60"
      data-testid="kpi-cards"
    >
      {items.map((item) => (
        <div key={item.id} className="px-4 py-3.5 min-w-0">
          <div className="flex items-center gap-1.5 text-muted-foreground mb-1.5">
            {item.live ? (
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
            ) : (
              item.icon
            )}
            <span className="text-[10px] font-semibold uppercase tracking-wide truncate">
              {item.label}
            </span>
          </div>
          <p
            className="text-xl font-bold tabular-nums tracking-tight truncate"
            data-testid={item.testId}
          >
            {item.value}
          </p>
          {item.sub ? (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.sub}</div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AnalyticsChartPanel({
  title,
  icon,
  filtered,
  actions,
  highlighted,
  children,
  className,
  contentRef,
}: {
  title: string;
  icon?: ReactNode;
  filtered?: boolean;
  actions?: ReactNode;
  highlighted?: boolean;
  children: ReactNode;
  className?: string;
  contentRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      className={cn(
        "rounded-xl border bg-card/60 backdrop-blur-[2px] overflow-hidden transition-shadow",
        highlighted ? "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.25)]" : "border-border/80",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          {icon ? <span className="text-primary shrink-0">{icon}</span> : null}
          <h3 className="text-sm font-semibold truncate">
            {title}
            {filtered ? (
              <span className="text-xs font-normal text-primary ml-1.5">(filtered)</span>
            ) : null}
          </h3>
        </div>
        {actions ? <div className="flex items-center gap-2 shrink-0">{actions}</div> : null}
      </div>
      <div ref={contentRef} className="px-3 pb-3.5 pt-1">
        {children}
      </div>
    </div>
  );
}

export function AnalyticsChartEmpty({ message = "No incidents in this period" }: { message?: string }) {
  return (
    <div className="h-[180px] flex flex-col items-center justify-center gap-1 text-sm text-muted-foreground rounded-lg border border-dashed border-border/70 bg-muted/20">
      <p>{message}</p>
    </div>
  );
}

export function AnalyticsSegmented({
  options,
  value,
  onChange,
  testId,
}: {
  options: Array<{ value: string; label: ReactNode; testId?: string }>;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <div
      className="inline-flex items-center rounded-lg border border-border/80 bg-muted/30 p-0.5 text-xs"
      data-testid={testId}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          data-testid={opt.testId}
          className={cn(
            "px-2.5 py-1.5 rounded-md transition-colors flex items-center gap-1",
            value === opt.value
              ? "bg-primary text-primary-foreground font-medium shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
