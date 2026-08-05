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
import { Gauge, Radio, Save, ShieldAlert, Timer } from "lucide-react";

type FleetAlertRulesFormProps = {
  deviceId: number;
  useDeviceLatLng?: { lat: number | null; lng: number | null };
};

function ThresholdField({
  id,
  label,
  hint,
  icon: Icon,
  value,
  min,
  max,
  onChange,
}: {
  id: string;
  label: string;
  hint: string;
  icon: typeof Gauge;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <Label htmlFor={id} className="text-sm font-medium">
            {label}
          </Label>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">{hint}</p>
        </div>
      </div>
      <Input
        id={id}
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-10 max-w-[10rem] font-semibold tabular-nums"
      />
    </div>
  );
}

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
    return (
      <div className="rounded-xl border border-border/70 bg-card/40 p-8 text-sm text-muted-foreground">
        Loading alert rules…
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border/70 bg-card/40">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4 border-b border-border/60 bg-muted/20 rounded-t-xl">
        <div className="flex items-start gap-3 min-w-0">
          <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-600/15 text-emerald-400 border border-emerald-500/25">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold tracking-tight">Alert rules</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Per-vehicle thresholds that override organisation defaults
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/70 px-3 py-2">
          <div className="text-right leading-tight">
            <p className="text-xs font-medium">{form.alertsEnabled ? "Enabled" : "Disabled"}</p>
            <p className="text-[10px] text-muted-foreground">
              {form.alertsEnabled ? "Alerts are active" : "No alerts will fire"}
            </p>
          </div>
          <Switch
            id="alerts-enabled"
            checked={form.alertsEnabled}
            onCheckedChange={(v) => setForm((f) => f && { ...f, alertsEnabled: v })}
          />
        </div>
      </div>

      <div className="p-5 space-y-6">
        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold">Thresholds</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When each alert type should trigger for this vehicle
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <ThresholdField
              id="speed-limit"
              label="Speed limit"
              hint="Alert when speed exceeds this (km/h)"
              icon={Gauge}
              value={form.speedLimitKph}
              min={1}
              max={300}
              onChange={(speedLimitKph) =>
                setForm((f) => f && { ...f, speedLimitKph: speedLimitKph || 120 })
              }
            />
            <ThresholdField
              id="idle-min"
              label="Idle threshold"
              hint="Alert after sitting still this long (minutes)"
              icon={Timer}
              value={form.idleMinutes}
              min={1}
              onChange={(idleMinutes) =>
                setForm((f) => f && { ...f, idleMinutes: idleMinutes || 30 })
              }
            />
            <ThresholdField
              id="offline-min"
              label="Offline threshold"
              hint="Alert when the tracker goes quiet (minutes)"
              icon={Radio}
              value={form.offlineMinutes}
              min={1}
              onChange={(offlineMinutes) =>
                setForm((f) => f && { ...f, offlineMinutes: offlineMinutes || 30 })
              }
            />
          </div>
        </section>

        <section className="rounded-xl border border-border/70 bg-background/40 overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
            <div>
              <p className="text-sm font-semibold">Geofence</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Alert when the vehicle enters or leaves this zone
              </p>
            </div>
            <div className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/80 px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                {form.geofenceEnabled ? "On" : "Off"}
              </span>
              <Switch
                checked={form.geofenceEnabled}
                onCheckedChange={(v) => setForm((f) => f && { ...f, geofenceEnabled: v })}
              />
            </div>
          </div>

          {form.geofenceEnabled ? (
            <div className="p-4">
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
                height="min(48vh, 440px)"
              />
            </div>
          ) : (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Turn geofence on to set a map zone for this vehicle.
              </p>
            </div>
          )}
        </section>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/60">
          <p className="text-[11px] text-muted-foreground">
            Changes apply after you save. Org defaults still cover unset vehicles.
          </p>
          <Button
            type="button"
            disabled={saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            className="min-w-[10rem]"
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? "Saving…" : "Save alert rules"}
          </Button>
        </div>
      </div>
    </div>
  );
}
