import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ResolvedFleetAlertRules } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { FleetGeofenceMapPicker } from "@/components/fleet/fleet-geofence-map-picker";
import { Save } from "lucide-react";

type FleetAlertRulesFormProps = {
  deviceId: number;
  useDeviceLatLng?: { lat: number | null; lng: number | null };
};

export function FleetAlertRulesForm({ deviceId, useDeviceLatLng }: FleetAlertRulesFormProps) {
  const { toast } = useToast();
  const rulesKey = [`/api/fleet-alerts/rules/${deviceId}`];

  const { data: rules, isLoading } = useQuery<ResolvedFleetAlertRules>({
    queryKey: rulesKey,
  });

  const [form, setForm] = useState<ResolvedFleetAlertRules | null>(null);

  useEffect(() => {
    if (rules) setForm(rules);
  }, [rules]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return;
      await apiRequest("PATCH", `/api/fleet-alerts/rules/${deviceId}`, form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey });
      toast({ title: "Alert rules saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading || !form) {
    return <p className="text-sm text-muted-foreground">Loading alert rules…</p>;
  }

  return (
    <div className="space-y-4 rounded-lg border p-4 bg-card/50">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold">Alert rules</p>
          <p className="text-xs text-muted-foreground">Overrides org defaults for this vehicle</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="alerts-enabled" className="text-xs text-muted-foreground">
            Enabled
          </Label>
          <Switch
            id="alerts-enabled"
            checked={form.alertsEnabled}
            onCheckedChange={(v) => setForm((f) => f && { ...f, alertsEnabled: v })}
          />
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="speed-limit">Speed limit (km/h)</Label>
          <Input
            id="speed-limit"
            type="number"
            min={1}
            max={300}
            value={form.speedLimitKph}
            onChange={(e) =>
              setForm((f) => f && { ...f, speedLimitKph: Number(e.target.value) || 120 })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="idle-min">Idle threshold (min)</Label>
          <Input
            id="idle-min"
            type="number"
            min={1}
            value={form.idleMinutes}
            onChange={(e) =>
              setForm((f) => f && { ...f, idleMinutes: Number(e.target.value) || 30 })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="offline-min">Offline threshold (min)</Label>
          <Input
            id="offline-min"
            type="number"
            min={1}
            value={form.offlineMinutes}
            onChange={(e) =>
              setForm((f) => f && { ...f, offlineMinutes: Number(e.target.value) || 30 })
            }
          />
        </div>
      </div>

      <div className="space-y-3 pt-1 border-t border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Geofence</p>
            <p className="text-xs text-muted-foreground">Alert on enter / leave</p>
          </div>
          <Switch
            checked={form.geofenceEnabled}
            onCheckedChange={(v) => setForm((f) => f && { ...f, geofenceEnabled: v })}
          />
        </div>
        {form.geofenceEnabled && (
          <FleetGeofenceMapPicker
            value={{
              lat: form.geofenceLat,
              lng: form.geofenceLng,
              radiusM: form.geofenceRadiusM,
            }}
            onChange={(geo) =>
              setForm((f) =>
                f
                  ? {
                      ...f,
                      geofenceLat: geo.lat,
                      geofenceLng: geo.lng,
                      geofenceRadiusM: geo.radiusM,
                    }
                  : f,
              )
            }
            vehicleLatLng={
              useDeviceLatLng?.lat != null && useDeviceLatLng?.lng != null
                ? { lat: useDeviceLatLng.lat, lng: useDeviceLatLng.lng }
                : null
            }
            height="280px"
          />
        )}
      </div>

      <Button
        type="button"
        size="sm"
        disabled={saveMutation.isPending}
        onClick={() => saveMutation.mutate()}
      >
        <Save className="h-4 w-4 mr-1" />
        Save alert rules
      </Button>
    </div>
  );
}
