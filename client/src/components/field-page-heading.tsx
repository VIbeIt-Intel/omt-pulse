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
  leading,
  className,
  testId = "field-page-heading",
  titleTestId,
}: {
  title: string;
  icon?: LucideIcon;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  /** Optional control before the icon (e.g. back button). */
  leading?: ReactNode;
  className?: string;
  testId?: string;
  titleTestId?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2.5", className)} data-testid={testId}>
      <div className="flex items-start gap-2.5 min-w-0">
        {leading}
        {Icon ? (
          <span
            className="mt-0.5 shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-primary/35 bg-primary/15 text-primary"
            aria-hidden
          >
            <Icon className="h-[18px] w-[18px]" />
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <h1
              className="text-lg font-semibold tracking-tight text-foreground truncate"
              data-testid={titleTestId}
            >
              {title}
            </h1>
            {badge != null && badge !== false ? (
              <span className="shrink-0 inline-flex items-center rounded-md border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {badge}
              </span>
            ) : null}
          </div>
          {meta != null ? (
            <p className="mt-0.5 text-xs text-muted-foreground leading-snug line-clamp-2">
              {meta}
            </p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-1.5 w-full [&_button]:h-8 [&_button]:px-2.5 [&_button]:text-xs [&_a]:inline-flex">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
