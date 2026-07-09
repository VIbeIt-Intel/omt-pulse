import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ResolvedFleetAlertRules } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Save } from "lucide-react";

type FleetAlertDefaultsSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function FleetAlertDefaultsSheet({ open, onOpenChange }: FleetAlertDefaultsSheetProps) {
  const { toast } = useToast();
  const rulesKey = ["/api/fleet-alerts/rules/defaults"];

  const { data: rules, isLoading } = useQuery<ResolvedFleetAlertRules>({
    queryKey: rulesKey,
    enabled: open,
  });

  const [form, setForm] = useState<ResolvedFleetAlertRules | null>(null);

  useEffect(() => {
    if (rules) setForm(rules);
  }, [rules]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!form) return;
      await apiRequest("PATCH", "/api/fleet-alerts/rules/defaults", form);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: rulesKey });
      toast({ title: "Org alert defaults saved" });
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Fleet alert defaults</SheetTitle>
          <SheetDescription>
            Org-wide thresholds used when a vehicle has no per-vehicle override.
          </SheetDescription>
        </SheetHeader>

        {isLoading || !form ? (
          <p className="text-sm text-muted-foreground mt-6">Loading…</p>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="grid gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="def-speed">Speed limit (km/h)</Label>
                <Input
                  id="def-speed"
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
                <Label htmlFor="def-idle">Idle threshold (min)</Label>
                <Input
                  id="def-idle"
                  type="number"
                  min={1}
                  value={form.idleMinutes}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, idleMinutes: Number(e.target.value) || 30 })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="def-offline">Offline threshold (min)</Label>
                <Input
                  id="def-offline"
                  type="number"
                  min={1}
                  value={form.offlineMinutes}
                  onChange={(e) =>
                    setForm((f) => f && { ...f, offlineMinutes: Number(e.target.value) || 30 })
                  }
                />
              </div>
            </div>

            <div className="space-y-3 pt-2 border-t border-border/60">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Default geofence</p>
                  <p className="text-xs text-muted-foreground">Used when a vehicle has no geofence override</p>
                </div>
                <Switch
                  checked={form.geofenceEnabled}
                  onCheckedChange={(v) => setForm((f) => f && { ...f, geofenceEnabled: v })}
                />
              </div>
              {form.geofenceEnabled && (
                <div className="grid gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="def-geo-lat">Centre latitude</Label>
                    <Input
                      id="def-geo-lat"
                      type="number"
                      step="any"
                      value={form.geofenceLat ?? ""}
                      onChange={(e) =>
                        setForm((f) => f && {
                          ...f,
                          geofenceLat: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="def-geo-lng">Centre longitude</Label>
                    <Input
                      id="def-geo-lng"
                      type="number"
                      step="any"
                      value={form.geofenceLng ?? ""}
                      onChange={(e) =>
                        setForm((f) => f && {
                          ...f,
                          geofenceLng: e.target.value ? Number(e.target.value) : null,
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="def-geo-radius">Radius (m)</Label>
                    <Input
                      id="def-geo-radius"
                      type="number"
                      min={50}
                      value={form.geofenceRadiusM}
                      onChange={(e) =>
                        setForm((f) => f && {
                          ...f,
                          geofenceRadiusM: Number(e.target.value) || 2000,
                        })
                      }
                    />
                  </div>
                </div>
              )}
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
            >
              <Save className="h-4 w-4 mr-1" />
              Save defaults
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
