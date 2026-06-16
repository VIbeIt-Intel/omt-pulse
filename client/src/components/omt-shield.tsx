import { cn } from "@/lib/utils";
import shieldBadge from "@/assets/omt-shield-badge.png";

interface OmtShieldProps {
  className?: string;
  /** hero = dashboard masthead; mark = sidebar/login compact crop */
  variant?: "hero" | "mark";
}

/**
 * Wide 3D PNG (shield centred on black). We crop/zoom into the shield and use
 * mix-blend-screen so the black matte disappears on light and dark UI.
 */
export function OmtShield({ className, variant = "mark" }: OmtShieldProps) {
  const croppedImg = (
    <img
      src={shieldBadge}
      alt="OMT Pulse"
      draggable={false}
      className={cn(
        "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2",
        "h-full w-auto min-w-[240%] max-w-none object-cover object-center",
        "select-none pointer-events-none mix-blend-screen",
        "brightness-[1.03] contrast-[1.06] saturate-[1.08]",
      )}
    />
  );

  if (variant === "hero") {
    return (
      <div
        className={cn("relative flex items-center justify-center", className)}
        data-testid="omt-shield-hero"
      >
        <div
          className="pointer-events-none absolute h-32 w-32 rounded-full bg-primary/20 blur-3xl dark:bg-primary/30"
          aria-hidden
        />
        <div
          className={cn(
            "relative overflow-hidden",
            "h-[5.75rem] w-[5.75rem] sm:h-[6.5rem] sm:w-[6.5rem]",
            "rounded-[1.35rem]",
            "ring-1 ring-primary/15 dark:ring-primary/25",
            "shadow-[0_12px_40px_-8px_rgba(0,77,46,0.45)]",
            "dark:shadow-[0_12px_44px_-6px_rgba(0,122,71,0.35)]",
          )}
        >
          {croppedImg}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative shrink-0 overflow-hidden rounded-xl", className ?? "h-10 w-10")}
      data-testid="omt-shield-mark"
    >
      {croppedImg}
    </div>
  );
}
