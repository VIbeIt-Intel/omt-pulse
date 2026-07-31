import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageHeroInsight = {
  label: string;
  value: ReactNode;
};

export function PageHero({
  eyebrow,
  badge,
  total,
  totalLabel,
  title,
  description,
  emptyMessage,
  insights = [],
  actions,
  leading,
  insightKey,
  testId = "page-hero",
  titleTestId,
  totalTestId,
  className,
  compact = false,
}: {
  eyebrow: string;
  /** Small chip on the right of the eyebrow row (period, mode, etc.). */
  badge?: ReactNode;
  /** Large lead metric. Prefer this for operational counts. */
  total?: number | null;
  totalLabel?: string;
  /** Lead title when there is no numeric total. */
  title?: ReactNode;
  /** Supporting line under the lead. */
  description?: ReactNode;
  /** Shown instead of metrics when total === 0. */
  emptyMessage?: ReactNode;
  insights?: PageHeroInsight[];
  /** Right-side actions (buttons). */
  actions?: ReactNode;
  /** Optional control before the eyebrow (back button, sidebar trigger). */
  leading?: ReactNode;
  insightKey?: string;
  testId?: string;
  titleTestId?: string;
  totalTestId?: string;
  className?: string;
  compact?: boolean;
}) {
  const showEmpty = total === 0 && emptyMessage != null;
  const hasLeadMetric = total != null && !showEmpty;
  const hasTitleLead = !hasLeadMetric && !showEmpty && title != null;

  return (
    <div
      key={insightKey}
      className={cn(
        "page-hero analytics-hero relative overflow-hidden rounded-xl border border-primary/30",
        className,
      )}
      data-testid={testId}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(105deg, hsl(155 100% 19% / 0.35) 0%, hsl(var(--card)) 42%, hsl(155 40% 12% / 0.45) 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute left-0 top-0 bottom-0 w-[3px] bg-primary"
        aria-hidden
      />
      <div
        className={cn(
          "relative",
          compact ? "px-3.5 py-2.5 sm:px-4 sm:py-3" : "px-5 py-5 sm:px-7 sm:py-6",
        )}
      >
        <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5", compact ? "mb-1.5" : "mb-3")}>
          <div className="flex items-center gap-2 min-w-0">
            {leading}
            <p
              className={cn(
                "font-semibold uppercase tracking-[0.08em] text-primary truncate",
                compact ? "text-xs sm:text-sm" : "text-base sm:text-lg",
              )}
              data-testid={titleTestId}
            >
              {eyebrow}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {badge != null && badge !== false ? (
              <span className="inline-flex items-center rounded-md border border-primary/25 bg-background/40 px-2.5 py-1 text-xs font-medium text-muted-foreground tabular-nums">
                {badge}
              </span>
            ) : null}
            {actions}
          </div>
        </div>

        {showEmpty ? (
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl leading-relaxed">
            {emptyMessage}
          </p>
        ) : (
          <div className={cn("flex flex-col", compact ? "gap-2 lg:gap-3" : "gap-4 lg:flex-row lg:items-end lg:gap-10")}>
            {hasLeadMetric ? (
              <div className={cn("shrink-0", compact ? "min-w-[4rem]" : "min-w-[5.5rem]")}>
                <p
                  className={cn(
                    "font-semibold tracking-tight tabular-nums text-foreground/90 leading-none",
                    compact ? "text-xl" : "text-2xl sm:text-3xl",
                  )}
                  data-testid={totalTestId}
                >
                  {total}
                </p>
                {totalLabel ? (
                  <p
                    className={cn(
                      "font-medium uppercase tracking-[0.1em] text-muted-foreground",
                      compact ? "mt-1 text-[10px]" : "mt-1.5 text-xs",
                    )}
                  >
                    {totalLabel}
                  </p>
                ) : null}
              </div>
            ) : null}

            {hasTitleLead ? (
              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "font-semibold tracking-tight text-foreground leading-tight",
                    compact ? "text-base" : "text-xl sm:text-2xl",
                  )}
                >
                  {title}
                </p>
                {description ? (
                  <p
                    className={cn(
                      "text-muted-foreground leading-snug max-w-2xl",
                      compact ? "mt-0.5 text-xs" : "mt-1 text-sm",
                    )}
                  >
                    {description}
                  </p>
                ) : null}
              </div>
            ) : null}

            {!hasTitleLead && description && hasLeadMetric ? (
              <p className={cn("text-muted-foreground lg:hidden", compact ? "text-xs" : "text-sm")}>
                {description}
              </p>
            ) : null}

            {insights.length > 0 ? (
              <div
                className={cn(
                  "flex-1 grid",
                  compact ? "gap-2 sm:gap-3" : "gap-3 sm:gap-5",
                  insights.length === 1
                    ? "grid-cols-1"
                    : insights.length === 2
                      ? "grid-cols-2"
                      : "grid-cols-1 sm:grid-cols-3",
                  hasLeadMetric || hasTitleLead
                    ? "lg:border-l lg:border-border/70 lg:pl-8"
                    : null,
                )}
              >
                {insights.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <p
                      className={cn(
                        "font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-0.5",
                        compact ? "text-[10px]" : "text-[11px] mb-1",
                      )}
                    >
                      {item.label}
                    </p>
                    <p
                      className={cn(
                        "font-semibold tracking-tight text-foreground truncate",
                        compact ? "text-xs sm:text-sm" : "text-sm sm:text-base",
                      )}
                      title={typeof item.value === "string" ? item.value : undefined}
                    >
                      {item.value}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
