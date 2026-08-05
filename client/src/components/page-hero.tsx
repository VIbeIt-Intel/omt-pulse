import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type PageHeroInsight = {
  label: string;
  value: ReactNode;
};

/**
 * Shared page header. Desktop keeps the full control-room hero; phones get a
 * dense single-row layout so the feed/content starts higher on screen.
 */
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
  /** Extra-tight padding (rarely needed — phones are already compact). */
  compact?: boolean;
}) {
  const showEmpty = total === 0 && emptyMessage != null;
  const hasLeadMetric = total != null && !showEmpty;
  const hasTitleLead = !hasLeadMetric && !showEmpty && title != null;
  const insightCols =
    insights.length <= 1
      ? "grid-cols-1"
      : insights.length === 2
        ? "grid-cols-2"
        : "grid-cols-3";

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
          // Phones: tight. md+: original control-room spacing (unless compact).
          compact
            ? "px-3.5 py-2.5 sm:px-4 sm:py-3"
            : "px-3.5 py-2.5 md:px-7 md:py-6",
        )}
      >
        <div
          className={cn(
            "flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5",
            compact ? "mb-1.5" : "mb-1.5 md:mb-3",
          )}
        >
          <div className="flex items-center gap-2 min-w-0">
            {leading}
            <p
              className={cn(
                "font-semibold uppercase tracking-[0.08em] text-primary truncate",
                compact ? "text-xs sm:text-sm" : "text-sm md:text-lg",
              )}
              data-testid={titleTestId}
            >
              {eyebrow}
            </p>
            {badge != null && badge !== false ? (
              <span className="shrink-0 inline-flex items-center rounded-md border border-primary/25 bg-background/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground tabular-nums md:px-2.5 md:py-1 md:text-xs">
                {badge}
              </span>
            ) : null}
          </div>
          {actions ? (
            <div
              className={cn(
                "flex flex-wrap items-center justify-end gap-1.5 shrink-0 max-w-full",
                // Shrink page-provided buttons on phones without touching desktop.
                "[&_button]:h-8 [&_button]:px-2.5 [&_button]:text-xs",
                "md:[&_button]:h-9 md:[&_button]:px-3 md:[&_button]:text-sm",
              )}
            >
              {actions}
            </div>
          ) : null}
        </div>

        {showEmpty ? (
          <p className="text-sm md:text-lg text-muted-foreground max-w-2xl leading-snug md:leading-relaxed line-clamp-2 md:line-clamp-none">
            {emptyMessage}
          </p>
        ) : (
          <div
            className={cn(
              "flex flex-col gap-2",
              compact
                ? "lg:gap-3"
                : "md:gap-4 md:flex-row md:items-end md:gap-10",
            )}
          >
            {(hasLeadMetric || hasTitleLead) && (
              <div
                className={cn(
                  "flex items-end gap-3 min-w-0",
                  hasLeadMetric && insights.length > 0 ? "md:contents" : null,
                )}
              >
                {hasLeadMetric ? (
                  <div className={cn("shrink-0", compact ? "min-w-[3.5rem]" : "min-w-[3.5rem] md:min-w-[5.5rem]")}>
                    <p
                      className={cn(
                        "font-semibold tracking-tight tabular-nums text-foreground/90 leading-none",
                        compact ? "text-xl" : "text-2xl md:text-3xl",
                      )}
                      data-testid={totalTestId}
                    >
                      {total}
                    </p>
                    {totalLabel ? (
                      <p
                        className={cn(
                          "font-medium uppercase tracking-[0.1em] text-muted-foreground",
                          compact ? "mt-0.5 text-[10px]" : "mt-0.5 text-[10px] md:mt-1.5 md:text-xs",
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
                        compact ? "text-base" : "text-base md:text-2xl",
                      )}
                    >
                      {title}
                    </p>
                    {description ? (
                      <p
                        className={cn(
                          "text-muted-foreground leading-snug max-w-2xl line-clamp-2 md:line-clamp-none",
                          compact ? "mt-0.5 text-xs" : "mt-0.5 text-xs md:mt-1 md:text-sm",
                        )}
                      >
                        {description}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {/* On phones, tuck insights beside the lead count in one band. */}
                {hasLeadMetric && insights.length > 0 ? (
                  <div className={cn("flex-1 min-w-0 grid gap-2 md:hidden", insightCols)}>
                    {insights.map((item) => (
                      <div key={`m-${item.label}`} className="min-w-0">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-0.5">
                          {item.label}
                        </p>
                        <p
                          className="text-xs font-semibold tracking-tight text-foreground truncate"
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

            {!hasTitleLead && description && hasLeadMetric ? (
              <p className="hidden md:block text-sm text-muted-foreground lg:hidden">
                {description}
              </p>
            ) : null}

            {insights.length > 0 ? (
              <div
                className={cn(
                  "flex-1 grid",
                  // Phones already show insights beside the lead when a total exists.
                  hasLeadMetric ? "hidden md:grid" : insightCols,
                  compact ? "gap-2 sm:gap-3" : "gap-3 sm:gap-5",
                  insightCols,
                  hasLeadMetric || hasTitleLead
                    ? "md:border-l md:border-border/70 md:pl-8"
                    : null,
                )}
              >
                {insights.map((item) => (
                  <div key={item.label} className="min-w-0">
                    <p
                      className={cn(
                        "font-semibold uppercase tracking-[0.1em] text-muted-foreground mb-0.5",
                        compact ? "text-[10px]" : "text-[10px] md:text-[11px] md:mb-1",
                      )}
                    >
                      {item.label}
                    </p>
                    <p
                      className={cn(
                        "font-semibold tracking-tight text-foreground truncate",
                        compact ? "text-xs sm:text-sm" : "text-sm md:text-base",
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
