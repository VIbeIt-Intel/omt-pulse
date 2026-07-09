import { Car, CirclePause, Radio, WifiOff, AlertTriangle } from "lucide-react";
import type { TrackerDeviceSummary } from "@/components/operations-dashboard";
import { getVehicleMotionStatus, MOTION_STATUS } from "@/lib/fleet-intelligence";
import { cn } from "@/lib/utils";

type FleetOverviewProps = {
  devices: TrackerDeviceSummary[];
  alertsLast24h?: number;
};

export function FleetOverview({ devices, alertsLast24h = 0 }: FleetOverviewProps) {
  const counts = { moving: 0, idle: 0, offline: 0 };
  for (const d of devices) {
    counts[getVehicleMotionStatus(d.lastSeenAt, d.lastSpeedKph)]++;
  }

  const items = [
    { key: "total" as const, label: "Total vehicles", value: devices.length, icon: Car, accent: "text-foreground" },
    { key: "moving" as const, label: "Moving", value: counts.moving, icon: Radio, accent: "text-emerald-400" },
    { key: "idle" as const, label: "Idle", value: counts.idle, icon: CirclePause, accent: "text-amber-400" },
    { key: "offline" as const, label: "Offline", value: counts.offline, icon: WifiOff, accent: "text-slate-400" },
    { key: "alerts" as const, label: "Alerts (24h)", value: alertsLast24h, icon: AlertTriangle, accent: alertsLast24h > 0 ? "text-red-400" : "text-muted-foreground" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-2 sm:gap-3" data-testid="fleet-overview">
      {items.map(({ key, label, value, icon: Icon, accent }) => (
        <div
          key={key}
          className="rounded-xl border bg-card/80 px-3 py-3 sm:px-4 sm:py-3.5 min-w-0"
        >
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground truncate">
              {label}
            </span>
            {key !== "total" && key !== "alerts" && (
              <span className={cn("h-2 w-2 rounded-full shrink-0", MOTION_STATUS[key].dot)} />
            )}
            {key === "total" && <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />}
            {key === "alerts" && <Icon className={cn("h-3.5 w-3.5 shrink-0", accent)} />}
          </div>
          <p className={cn("text-2xl font-bold tabular-nums leading-none", key === "total" ? accent : accent)}>
            {value}
          </p>
        </div>
      ))}
    </div>
  );
}
