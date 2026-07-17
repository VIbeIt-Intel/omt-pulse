import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { FleetAlertSummary } from "@shared/schema";
import { FLEET_ALERT_LABELS, type FleetAlertType } from "@shared/fleet-alerts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, ChevronDown, Clock, Gauge, Loader2, MapPin, WifiOff } from "lucide-react";

const ALERT_ICONS: Record<FleetAlertType, typeof Gauge> = {
  speeding: Gauge,
  idle: Clock,
  offline: WifiOff,
  geofence_enter: MapPin,
  geofence_leave: MapPin,
};

const ALERT_COLORS: Record<FleetAlertType, string> = {
  speeding: "text-red-400 bg-red-950/40 border-red-800/50",
  idle: "text-amber-400 bg-amber-950/40 border-amber-800/50",
  offline: "text-slate-400 bg-slate-900/60 border-slate-700/50",
  geofence_enter: "text-blue-400 bg-blue-950/40 border-blue-800/50",
  geofence_leave: "text-orange-400 bg-orange-950/40 border-orange-800/50",
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "Just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function FleetAlertRow({
  alert,
  onClick,
  onAcknowledge,
  acknowledging,
  compact,
  acknowledged,
}: {
  alert: FleetAlertSummary;
  onClick?: () => void;
  onAcknowledge?: () => void;
  acknowledging?: boolean;
  compact?: boolean;
  acknowledged?: boolean;
}) {
  const type = alert.alertType as FleetAlertType;
  const Icon = ALERT_ICONS[type] ?? AlertTriangle;
  const vehicleName = alert.vehicleLabel || alert.vehicleRegistration || `Vehicle #${alert.deviceId}`;

  const content = (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
          acknowledged
            ? "text-muted-foreground bg-muted/40 border-border/60"
            : ALERT_COLORS[type] ?? "text-muted-foreground bg-muted",
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <p className={cn("font-medium truncate", compact ? "text-sm" : "text-sm", acknowledged && "text-muted-foreground")}>
            {vehicleName}
          </p>
          <span className="text-[10px] font-semibold uppercase text-muted-foreground">
            {FLEET_ALERT_LABELS[type] ?? alert.alertType}
          </span>
          {acknowledged && (
            <span className="text-[10px] font-medium text-emerald-500/90">Acknowledged</span>
          )}
        </div>
        <p className={cn("text-xs mt-0.5 line-clamp-2", acknowledged ? "text-muted-foreground/80" : "text-muted-foreground")}>
          {alert.message}
        </p>
        <p className="text-[11px] text-muted-foreground mt-1">
          {formatWhen(alert.triggeredAt.toString())}
          {acknowledged && alert.acknowledgedAt
            ? ` · ack ${formatWhen(alert.acknowledgedAt.toString())}`
            : ""}
        </p>
      </div>
      {onAcknowledge && !acknowledged && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 h-8 px-2.5"
          disabled={acknowledging}
          onClick={(e) => {
            e.stopPropagation();
            onAcknowledge();
          }}
        >
          {acknowledging ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <>
              <Check className="h-3.5 w-3.5 mr-1" />
              Ack
            </>
          )}
        </Button>
      )}
    </div>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full text-left py-3 border-b border-border/60 last:border-0 hover:bg-muted/30 rounded-md px-1 -mx-1 transition-colors",
          acknowledged && "opacity-80",
        )}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={cn("py-3 border-b border-border/60 last:border-0", acknowledged && "opacity-80")}>
      {content}
    </div>
  );
}

type FleetAlertsPanelProps = {
  deviceId?: number;
  hours?: number;
  limit?: number;
  onSelectDevice?: (deviceId: number) => void;
  title?: string;
};

export function FleetAlertsPanel({
  deviceId,
  hours = 168,
  limit = 30,
  onSelectDevice,
  title = "Fleet alerts",
}: FleetAlertsPanelProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [ackOpen, setAckOpen] = useState(false);
  const [ackingId, setAckingId] = useState<number | null>(null);

  const queryKey = deviceId
    ? [`/api/fleet-alerts?deviceId=${deviceId}&hours=${hours}&limit=${limit}`]
    : [`/api/fleet-alerts?hours=${hours}&limit=${limit}`];

  const { data: alerts = [], isLoading } = useQuery<FleetAlertSummary[]>({
    queryKey,
    refetchInterval: 20_000,
  });

  const { activeAlerts, acknowledgedAlerts } = useMemo(() => {
    const active: FleetAlertSummary[] = [];
    const acknowledged: FleetAlertSummary[] = [];
    for (const alert of alerts) {
      if (alert.acknowledgedAt) acknowledged.push(alert);
      else active.push(alert);
    }
    return { activeAlerts: active, acknowledgedAlerts: acknowledged };
  }, [alerts]);

  const acknowledgeMutation = useMutation({
    mutationFn: async (alertId: number) => {
      setAckingId(alertId);
      const res = await apiRequest("POST", `/api/fleet-alerts/${alertId}/acknowledge`, {});
      return res.json() as Promise<FleetAlertSummary>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey });
      void qc.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey[0];
          return typeof key === "string" && key.startsWith("/api/fleet-alerts");
        },
      });
      toast({ title: "Alert acknowledged" });
    },
    onError: (e: Error) => {
      toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" });
    },
    onSettled: () => setAckingId(null),
  });

  return (
    <Card data-testid="fleet-alerts-panel">
      <CardContent className="p-4">
        <h2 className="text-sm font-semibold mb-1">{title}</h2>
        <p className="text-xs text-muted-foreground mb-3">
          {deviceId ? "Alert history for this vehicle" : "Recent alerts across the fleet"}
        </p>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : alerts.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No alerts in this period.</p>
        ) : (
          <div className="space-y-3">
            {activeAlerts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-2 text-center">No open alerts.</p>
            ) : (
              <div>
                {activeAlerts.map((alert) => (
                  <FleetAlertRow
                    key={alert.id}
                    alert={alert}
                    compact
                    acknowledging={ackingId === alert.id && acknowledgeMutation.isPending}
                    onAcknowledge={() => acknowledgeMutation.mutate(alert.id)}
                    onClick={onSelectDevice ? () => onSelectDevice(alert.deviceId) : undefined}
                  />
                ))}
              </div>
            )}

            {acknowledgedAlerts.length > 0 && (
              <Collapsible open={ackOpen} onOpenChange={setAckOpen}>
                <CollapsibleTrigger asChild>
                  <Button type="button" variant="ghost" size="sm" className="w-full justify-between h-9 px-2">
                    <span className="text-xs text-muted-foreground">
                      {acknowledgedAlerts.length} acknowledged
                    </span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", ackOpen && "rotate-180")} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="pt-1 border-t border-border/60">
                    {acknowledgedAlerts.map((alert) => (
                      <FleetAlertRow
                        key={alert.id}
                        alert={alert}
                        compact
                        acknowledged
                        onClick={onSelectDevice ? () => onSelectDevice(alert.deviceId) : undefined}
                      />
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
