import type { ReactNode, Ref } from "react";
import { cn } from "@/lib/utils";

export function AnalyticsHero({
  periodLabel,
  total,
  topLoc,
  topCat,
  peakHour,
  insightKey,
}: {
  periodLabel: string;
  total: number;
  topLoc: string | null;
  topCat: string | null;
  peakHour: string | null;
  /** Remount key when date range changes — drives fade animation. */
  insightKey: string;
}) {
  const parts: ReactNode[] = [
    <span key="n">
      <strong className="text-foreground tabular-nums">{total}</strong>
      {total === 1 ? " incident" : " incidents"}
    </span>,
  ];
  if (topLoc) {
    parts.push(
      <span key="loc">
        hottest at <strong className="text-foreground">{topLoc}</strong>
      </span>,
    );
  }
  if (topCat) {
    parts.push(
      <span key="cat">
        mostly <strong className="text-foreground">{topCat}</strong>
      </span>,
    );
  }
  if (peakHour) {
    parts.push(
      <span key="peak">
        peak <strong className="text-foreground">{peakHour}</strong>
      </span>,
    );
  }

  return (
    <div
      key={insightKey}
      className="analytics-hero relative overflow-hidden rounded-xl border border-primary/25 px-5 py-6 sm:px-7 sm:py-7"
      data-testid="analytics-hero"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 0% 0%, hsl(155 100% 28% / 0.28), transparent 55%), radial-gradient(90% 70% at 100% 100%, hsl(155 60% 20% / 0.18), transparent 50%), hsl(var(--card))",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(hsl(var(--foreground) / 0.5) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.5) 1px, transparent 1px)",
          backgroundSize: "24px 24px",
        }}
      />
      <div className="relative space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary" data-testid="text-analytics-title">
          Analytics · {periodLabel}
        </p>
        {total === 0 ? (
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl leading-snug">
            No incidents in this period — adjust the date range or clear filters.
          </p>
        ) : (
          <p className="text-lg sm:text-2xl font-semibold tracking-tight text-muted-foreground max-w-3xl leading-snug">
            {parts.map((part, i) => (
              <span key={i}>
                {i > 0 ? <span className="text-muted-foreground/50"> · </span> : null}
                {part}
              </span>
            ))}
          </p>
        )}
      </div>
    </div>
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
