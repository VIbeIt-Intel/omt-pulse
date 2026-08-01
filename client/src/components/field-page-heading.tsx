import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Compact page title for field phones — no oversized hero card. */
export function FieldPageHeading({
  title,
  icon: Icon,
  badge,
  meta,
  actions,
  className,
  testId = "field-page-heading",
}: {
  title: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3", className)}
      data-testid={testId}
    >
      <div className="min-w-0 flex-1 flex items-start gap-2.5">
        {Icon ? (
          <span
            className="mt-0.5 shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/35 bg-primary/15 text-primary"
            aria-hidden
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h1 className="text-lg font-semibold tracking-tight text-foreground truncate">
              {title}
            </h1>
            {badge != null && badge !== false ? (
              <span className="shrink-0 inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {badge}
              </span>
            ) : null}
          </div>
          {meta != null ? (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug">{meta}</p>
          ) : null}
        </div>
      </div>
      {actions ? <div className="shrink-0 flex flex-wrap items-center gap-1.5">{actions}</div> : null}
    </div>
  );
}
