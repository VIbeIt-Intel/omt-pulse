import type { ReactNode } from "react";
import { Check } from "lucide-react";
import {
  FLEET_ALERT_SEVERITY_LABELS,
  getFleetAlertSeverity,
  getFleetAlertTypeCode,
  type FleetAlertSeverity,
  type FleetAlertType,
} from "@shared/fleet-alerts";
import { cn } from "@/lib/utils";

const SEVERITY_CHIP: Record<FleetAlertSeverity, string> = {
  high: "border-red-500/30 bg-red-500/10 text-red-400",
  medium: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  info: "border-slate-500/30 bg-slate-500/10 text-slate-300",
};

const TYPE_CHIP: Partial<Record<FleetAlertType, string>> & { default: string } = {
  speeding: "border-red-800/50 bg-red-950/40 text-red-300",
  idle: "border-amber-800/50 bg-amber-950/40 text-amber-300",
  offline: "border-slate-700/50 bg-slate-900/60 text-slate-300",
  geofence_enter: "border-blue-800/50 bg-blue-950/40 text-blue-300",
  geofence_leave: "border-orange-800/50 bg-orange-950/40 text-orange-300",
  default: "border-border/70 bg-muted/50 text-muted-foreground",
};

function MetaChip({
  children,
  className,
  testId,
}: {
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        className,
      )}
      data-testid={testId}
    >
      {children}
    </span>
  );
}

export function AlertMetaBadges({
  category,
  alertType,
  className,
}: {
  category: string;
  alertType?: string | null;
  className?: string;
}) {
  const typeCode = getFleetAlertTypeCode(alertType);
  const severity = getFleetAlertSeverity(alertType);
  const typeChipClass =
    (alertType && TYPE_CHIP[alertType as FleetAlertType]) || TYPE_CHIP.default;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)}>
      <MetaChip
        className="border-border/70 bg-muted/40 text-muted-foreground"
        testId="alert-meta-category"
      >
        {category}
      </MetaChip>
      {typeCode && (
        <MetaChip className={typeChipClass} testId="alert-meta-type">
          {typeCode}
        </MetaChip>
      )}
      {severity && (
        <MetaChip className={SEVERITY_CHIP[severity]} testId="alert-meta-severity">
          {FLEET_ALERT_SEVERITY_LABELS[severity]}
        </MetaChip>
      )}
    </div>
  );
}

export function AcknowledgedPill({
  acknowledgedAt,
  formatWhen,
  className,
}: {
  acknowledgedAt?: string | Date | null;
  formatWhen: (iso: string) => string;
  className?: string;
}) {
  const when =
    acknowledgedAt != null
      ? formatWhen(
          typeof acknowledgedAt === "string"
            ? acknowledgedAt
            : acknowledgedAt.toISOString(),
        )
      : null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400/90",
        className,
      )}
      data-testid="alert-ack-pill"
    >
      <Check className="h-3 w-3 shrink-0 opacity-90" strokeWidth={2.5} />
      <span>Ack&apos;d{when ? ` · ${when}` : ""}</span>
    </span>
  );
}
