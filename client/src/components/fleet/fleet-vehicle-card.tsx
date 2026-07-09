import { ChevronRight, Gauge, User } from "lucide-react";
import type { TrackerDeviceSummary } from "@/components/operations-dashboard";
import {
  formatFreshnessAgo,
  freshnessClassLight,
  getFreshnessTier,
  getVehicleMotionStatus,
  MOTION_STATUS,
  vehicleDisplayName,
} from "@/lib/fleet-intelligence";
import { cn } from "@/lib/utils";

type FleetVehicleCardProps = {
  device: TrackerDeviceSummary;
  onClick: () => void;
};

export function FleetVehicleCard({ device, onClick }: FleetVehicleCardProps) {
  const motion = getVehicleMotionStatus(device.lastSeenAt, device.lastSpeedKph);
  const motionCfg = MOTION_STATUS[motion];
  const title = vehicleDisplayName(device);
  const isMoving = motion === "moving";

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-xl border bg-card/80 p-4 text-left transition-all",
        "hover:border-primary/40 hover:bg-card hover:shadow-md hover:shadow-primary/5",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50",
      )}
      data-testid={`fleet-card-${device.id}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold truncate">{title}</h3>
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[9px] font-bold uppercase px-2 py-0.5 rounded-full border shrink-0",
                motionCfg.pill,
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", motionCfg.dot)} />
              {motionCfg.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 truncate">
            {device.vehicleRegistration || `IMEI …${device.imei.slice(-6)}`}
          </p>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground/50 group-hover:text-primary shrink-0 mt-0.5 transition-colors" />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span className={cn("tabular-nums", freshnessClassLight(getFreshnessTier(device.lastSeenAt)))}>
          {formatFreshnessAgo(device.lastSeenAt)}
        </span>
        {isMoving && device.lastSpeedKph != null && (
          <span className="inline-flex items-center gap-1 text-emerald-400 font-medium tabular-nums">
            <Gauge className="h-3.5 w-3.5" />
            {Math.round(device.lastSpeedKph)} km/h
          </span>
        )}
        {device.assignedUserName && (
          <span className="inline-flex items-center gap-1 text-muted-foreground truncate max-w-full">
            <User className="h-3.5 w-3.5 shrink-0" />
            {device.assignedUserName}
          </span>
        )}
      </div>
    </button>
  );
}
