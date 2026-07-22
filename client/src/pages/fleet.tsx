import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
import { Car, ChevronRight, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { FleetOverview } from "@/components/fleet/fleet-overview";
import { FleetAlertsPanel } from "@/components/fleet/fleet-alerts-panel";
import { FleetAlertDefaultsSheet } from "@/components/fleet/fleet-alert-defaults-sheet";
import { FleetVehicleCard } from "@/components/fleet/fleet-vehicle-card";
import { FleetVehicleDetail } from "@/components/fleet/fleet-vehicle-detail";
import type { TrackerDeviceSummary } from "@/components/operations-dashboard";
import { getVehicleMotionStatus } from "@/lib/fleet-intelligence";
import { PageHero } from "@/components/page-hero";

type OrgUser = { id: string; firstName: string; lastName: string; role: string };
type Command = { id: number; name: string; isCentral: boolean };

export default function FleetPage() {
  const search = useSearch();
  const [, setLocation] = useLocation();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const deviceParam = params.get("device");

  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [defaultsOpen, setDefaultsOpen] = useState(false);

  const { data: me } = useQuery<{ role: string }>({ queryKey: ["/api/auth/me"] });
  const isAdmin = me?.role === "administrator";

  const { data: devices = [], isLoading } = useQuery<TrackerDeviceSummary[]>({
    queryKey: ["/api/trackers"],
    refetchInterval: 20_000,
  });

  const { data: users = [] } = useQuery<OrgUser[]>({ queryKey: ["/api/trackers/assignees"] });
  const { data: commands = [] } = useQuery<Command[]>({ queryKey: ["/api/commands"] });

  const { data: alertCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ["/api/fleet-alerts/counts?hours=24"],
    refetchInterval: 20_000,
  });

  const alertsLast24h = useMemo(
    () => Object.values(alertCounts).reduce((sum, n) => sum + n, 0),
    [alertCounts],
  );

  function alertCountForDevice(deviceId: number): number {
    return alertCounts[String(deviceId)] ?? alertCounts[deviceId] ?? 0;
  }

  const selected = devices.find((d) => d.id === selectedId) ?? null;

  useEffect(() => {
    if (deviceParam) {
      const id = parseInt(deviceParam, 10);
      if (Number.isFinite(id)) setSelectedId(id);
    } else {
      setSelectedId(null);
    }
  }, [deviceParam]);

  const sortedDevices = useMemo(() => {
    const order = { moving: 0, idle: 1, offline: 2 };
    return [...devices].sort((a, b) => {
      const sa = order[getVehicleMotionStatus(a.lastSeenAt, a.lastSpeedKph)];
      const sb = order[getVehicleMotionStatus(b.lastSeenAt, b.lastSpeedKph)];
      if (sa !== sb) return sa - sb;
      return a.id - b.id;
    });
  }, [devices]);

  function openVehicle(id: number) {
    setSelectedId(id);
    setLocation(`/fleet?device=${id}`);
  }

  function backToList() {
    setSelectedId(null);
    setLocation("/fleet");
  }

  const motionCounts = useMemo(() => {
    const counts = { moving: 0, idle: 0, offline: 0 };
    for (const d of devices) {
      counts[getVehicleMotionStatus(d.lastSeenAt, d.lastSpeedKph)] += 1;
    }
    return counts;
  }, [devices]);

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="fleet-page">
      <div className="max-w-5xl mx-auto p-4 sm:p-6 space-y-5">
        <PageHero
          eyebrow="Fleet"
          badge={selected ? "Vehicle detail" : "Fleet board"}
          total={devices.length}
          totalLabel={devices.length === 1 ? "Vehicle" : "Vehicles"}
          actions={
            <>
              {!selected && isAdmin && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setDefaultsOpen(true)}>
                  <Settings2 className="h-4 w-4 mr-1" />
                  Alert defaults
                </Button>
              )}
              <Link href="/dashboard">
                <Button variant="outline" size="sm" className="h-8">
                  Control Room <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </>
          }
          insights={
            selected
              ? [
                  { label: "Selected", value: selected.vehicleRegistration?.trim() || `IMEI …${selected.imei.slice(-6)}` },
                  { label: "Alerts 24h", value: String(alertCountForDevice(selected.id)) },
                ]
              : [
                  { label: "Moving", value: String(motionCounts.moving) },
                  { label: "Idle", value: String(motionCounts.idle) },
                  { label: "Offline", value: String(motionCounts.offline) },
                ]
          }
        />

        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-20 rounded-xl" />
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-28 rounded-xl" />
              ))}
            </div>
          </div>
        ) : devices.length === 0 ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">
            No trackers registered yet. Devices auto-register when they connect on port 7711.
          </Card>
        ) : selected ? (
          <FleetVehicleDetail
            device={selected}
            users={users}
            commands={commands}
            onBack={backToList}
          />
        ) : (
          <div className="space-y-5">
            <FleetOverview devices={devices} alertsLast24h={alertsLast24h} />
            <FleetAlertsPanel hours={24} limit={20} onSelectDevice={openVehicle} title="Recent alerts" />
            <div>
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                Vehicles
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sortedDevices.map((d) => (
                  <FleetVehicleCard
                    key={d.id}
                    device={d}
                    alertCount={alertCountForDevice(d.id)}
                    onClick={() => openVehicle(d.id)}
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
      <FleetAlertDefaultsSheet open={defaultsOpen} onOpenChange={setDefaultsOpen} />
    </div>
  );
}
