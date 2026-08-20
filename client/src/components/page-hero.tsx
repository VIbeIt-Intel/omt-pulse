import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Bell,
  BookOpen,
  Car,
  ClipboardList,
  Footprints,
  LayoutGrid,
  Network,
  Radio,
  Settings2,
  ShieldCheck,
  Upload,
  Users,
  Video,
} from "lucide-react";
import type { ReactNode } from "react";
import { FieldPageHeading } from "@/components/field-page-heading";
import { cn } from "@/lib/utils";

export type PageHeroInsight = {
  label: string;
  value: ReactNode;
};

/** Default phone icons so every page matches the Access Control field header. */
const DEFAULT_PHONE_ICONS: Record<string, LucideIcon> = {
  "Access Control": ShieldCheck,
  Patrol: Footprints,
  "Site Survey": ClipboardList,
  Cameras: Video,
  Users: Users,
  Positions: LayoutGrid,
  Fleet: Car,
  Notifications: Bell,
  "Live Monitor": Radio,
  "Occurrence Book": BookOpen,
  "My Incidents": BookOpen,
  "Field setup": Settings2,
  Groups: Network,
  "Import Data": Upload,
  Analytics: BarChart3,
};

function phoneMetaLine({
  showEmpty,
  emptyMessage,
  total,
  totalLabel,
  insights,
  description,
  title,
}: {
  showEmpty: boolean;
  emptyMessage?: ReactNode;
  total?: number | null;
  totalLabel?: string;
  insights: PageHeroInsight[];
  description?: ReactNode;
  title?: ReactNode;
}): ReactNode {
  if (showEmpty) return emptyMessage;
  const parts: string[] = [];
  if (total != null) {
    parts.push(totalLabel ? `${total} ${totalLabel.toLowerCase()}` : String(total));
  }
  for (const item of insights) {
    if (typeof item.value === "string" || typeof item.value === "number") {
      parts.push(`${item.value} ${item.label.toLowerCase()}`);
    }
  }
  if (parts.length > 0) return parts.join(" · ");
  if (typeof description === "string") return description;
  if (typeof title === "string") return title;
  return description ?? null;
}

/**
 * Shared page header.
 * - Phones: slim field heading (icon + title + badge + one meta line) — no hero card.
 * - Desktop: full control-room PageHero card.
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
  icon,
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
  /** Phone icon; falls back to a default for known page titles. */
  icon?: LucideIcon;
  insightKey?: string;
  testId?: string;
  titleTestId?: string;
  totalTestId?: string;
  className?: string;
  /** Extra-tight desktop padding. */
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
  const phoneIcon = icon ?? DEFAULT_PHONE_ICONS[eyebrow];
  const phoneMeta = phoneMetaLine({
    showEmpty,
    emptyMessage,
    total,
    totalLabel,
    insights,
    description,
    title,
  });

  return (
    <>
      <FieldPageHeading
        className={cn("md:hidden", className)}
        title={eyebrow}
        icon={phoneIcon}
        badge={badge}
        meta={phoneMeta}
        actions={actions}
        leading={leading}
        testId={`${testId}-mobile`}
        titleTestId={titleTestId}
      />

      <div
        key={insightKey}
        className={cn(
          "page-hero analytics-hero relative overflow-hidden rounded-xl border border-primary/30 hidden md:block",
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
            compact ? "px-4 py-3" : "px-7 py-6",
          )}
        >
          <div className={cn("flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5", compact ? "mb-1.5" : "mb-3")}>
            <div className="flex items-center gap-2 min-w-0">
              {leading}
              <p
                className={cn(
                  "font-semibold uppercase tracking-[0.08em] text-primary truncate",
                  compact ? "text-sm" : "text-lg",
                )}
                data-testid={titleTestId ? `${titleTestId}-desktop` : undefined}
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
            <p className="text-lg text-muted-foreground max-w-2xl leading-relaxed">
              {emptyMessage}
            </p>
          ) : (
            <div
              className={cn(
                "flex flex-col",
                compact ? "gap-2 lg:gap-3" : "gap-4 lg:flex-row lg:items-end lg:gap-10",
              )}
            >
              {hasLeadMetric ? (
                <div className={cn("shrink-0", compact ? "min-w-[4rem]" : "min-w-[5.5rem]")}>
                  <p
                    className={cn(
                      "font-semibold tracking-tight tabular-nums text-foreground/90 leading-none",
                      compact ? "text-xl" : "text-3xl",
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
                      compact ? "text-base" : "text-2xl",
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
                <p className="text-sm text-muted-foreground lg:hidden">{description}</p>
              ) : null}

              {insights.length > 0 ? (
                <div
                  className={cn(
                    "flex-1 grid",
                    compact ? "gap-2 sm:gap-3" : "gap-3 sm:gap-5",
                    insightCols,
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
                          compact ? "text-sm" : "text-base",
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
    </>
  );
}
