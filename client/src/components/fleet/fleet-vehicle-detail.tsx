import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Camera,
  ChevronRight,
  Download,
  Gauge,
  MapPin,
  Radio,
  Route,
  Save,
  Timer,
  Activity,
  X,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FleetHistoryMap } from "@/components/fleet-history-map";
import { FleetVehiclePhoto } from "@/components/fleet/fleet-vehicle-photo";
import { FleetAlertsPanel } from "@/components/fleet/fleet-alerts-panel";
import { FleetAlertRulesForm } from "@/components/fleet/fleet-alert-rules-form";
import { GeoLocationSheet, type GeoMapView } from "@/components/incident-location-sheet";
import type { TrackerDeviceSummary } from "@/components/operations-dashboard";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { prepareAndUploadFile } from "@/lib/upload-media";
import { downloadFleetTripCsv, downloadFleetTripExcel } from "@/lib/fleet-trip-export";
import {
  computeTripDayStats,
  formatDurationMinutes,
  formatFreshnessAgo,
  formatMileageKm,
  freshnessClassLight,
  getFreshnessTier,
  getVehicleMotionStatus,
  headingLabel,
  ignitionLabel,
  MOTION_STATUS,
  vehicleDisplayName,
} from "@/lib/fleet-intelligence";
import { cn } from "@/lib/utils";

type OrgUser = { id: string; firstName: string; lastName: string; role: string };
type Command = { id: number; name: string; isCentral: boolean };

type PositionRow = {
  id: number;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  ignitionOn: boolean | null;
  mileageKm: number | null;
  gpsValid: boolean;
  recordedAt: string;
};

type HistoryResponse = {
  count: number;
  maxSpeedKph: number | null;
  positions: PositionRow[];
};

type DayBucket = { key: string; label: string; positions: PositionRow[] };

type FleetVehicleDetailProps = {
  device: TrackerDeviceSummary;
  users: OrgUser[];
  commands: Command[];
  onBack: () => void;
};

function vehicleTitle(d: TrackerDeviceSummary): string {
  return vehicleDisplayName(d);
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayKeyFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayLabelForKey(key: string): string {
  const today = dayKeyFromDate(new Date());
  const yesterday = dayKeyFromDate(new Date(Date.now() - 86_400_000));
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function groupPositionsByDay(positions: PositionRow[]): DayBucket[] {
  const map = new Map<string, PositionRow[]>();
  for (const p of positions) {
    const key = dayKeyFromDate(new Date(p.recordedAt));
    const list = map.get(key) ?? [];
    list.push(p);
    map.set(key, list);
  }
  return [...map.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, pts]) => ({
      key,
      label: dayLabelForKey(key),
      positions: pts.sort(
        (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
      ),
    }));
}

function FleetStatCard({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon: typeof Gauge;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border bg-card/80 px-3 py-2.5 min-w-0">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        <Icon className="h-3.5 w-3.5 shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className="text-lg font-bold tabular-nums leading-none">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}

export function FleetVehicleDetail({ device, users, commands, onBack }: FleetVehicleDetailProps) {
  const { toast } = useToast();
  const deviceId = device.id;
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: me } = useQuery<{ role: string }>({ queryKey: ["/api/auth/me"] });
  const canUploadPhoto = me?.role === "administrator";
  const canEditAlertRules = me?.role === "administrator";

  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [mapPin, setMapPin] = useState<GeoMapView | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [form, setForm] = useState({
    label: "",
    vehicleMake: "",
    vehicleModel: "",
    vehicleRegistration: "",
    vehiclePhotoUrl: null as string | null,
    assignedUserId: "",
    commandId: "",
    notes: "",
  });

  useEffect(() => {
    setForm({
      label: device.label ?? "",
      vehicleMake: device.vehicleMake ?? "",
      vehicleModel: device.vehicleModel ?? "",
      vehicleRegistration: device.vehicleRegistration ?? "",
      vehiclePhotoUrl: device.vehiclePhotoUrl ?? null,
      assignedUserId: device.assignedUserId ?? "",
      commandId: device.commandId != null ? String(device.commandId) : "",
      notes: device.notes ?? "",
    });
    setSelectedDayKey(null);
    setLogOpen(false);
  }, [device]);

  const { data: history, isLoading: historyLoading } = useQuery<HistoryResponse>({
    queryKey: ["/api/trackers", deviceId, "positions", "7d"],
    queryFn: async () => {
      const res = await fetch(
        `/api/trackers/${deviceId}/positions?hours=168&limit=2000`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
  });

  const dayBuckets = useMemo(
    () => groupPositionsByDay(history?.positions ?? []),
    [history?.positions],
  );

  const activeDayKey = selectedDayKey ?? dayBuckets[0]?.key ?? null;
  const activeDay = dayBuckets.find((d) => d.key === activeDayKey) ?? null;
  const activePositions = activeDay?.positions ?? [];

  const tripStats = useMemo(
    () => computeTripDayStats(activePositions),
    [activePositions],
  );

  const motion = getVehicleMotionStatus(device.lastSeenAt, device.lastSpeedKph);
  const freshness = getFreshnessTier(device.lastSeenAt);

  const exportTrip = (scope: "day" | "week", format: "xlsx" | "csv") => {
    const positions = scope === "day" ? activePositions : (history?.positions ?? []);
    if (positions.length === 0) {
      toast({ title: "Nothing to export", description: "No GPS points in this period.", variant: "destructive" });
      return;
    }
    const periodLabel = scope === "day" ? activeDay?.label ?? activeDayKey ?? "Selected day" : "Last 7 days";
    const periodKey = scope === "day" ? activeDayKey ?? "day" : "7d";
    const opts = {
      device,
      vehicleTitle: vehicleTitle(device),
      periodLabel,
      periodKey,
      positions,
    };
    if (format === "xlsx") downloadFleetTripExcel(opts);
    else downloadFleetTripCsv(opts);
    toast({ title: "Report downloaded", description: `${periodLabel} · ${positions.length} GPS points` });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/trackers/${deviceId}`, {
        label: form.label || null,
        vehicleMake: form.vehicleMake || null,
        vehicleModel: form.vehicleModel || null,
        vehicleRegistration: form.vehicleRegistration || null,
        vehiclePhotoUrl: form.vehiclePhotoUrl,
        assignedUserId: form.assignedUserId || null,
        commandId: form.commandId ? Number(form.commandId) : null,
        notes: form.notes || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/trackers"] });
      toast({ title: "Vehicle saved" });
    },
    onError: (err: Error) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  async function uploadVehiclePhoto(file: File) {
    setUploadingPhoto(true);
    try {
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "compact" });
      setForm((f) => ({ ...f, vehiclePhotoUrl: objectUrl }));
    } catch (e) {
      toast({
        title: "Photo upload failed",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setUploadingPhoto(false);
    }
  }

  const displayPhotoUrl = form.vehiclePhotoUrl;

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        All vehicles
      </Button>

      <Card className="p-4 sm:p-5 border-primary/10 bg-gradient-to-br from-card to-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <FleetVehiclePhoto photoUrl={displayPhotoUrl} size="lg" />
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-bold truncate">{vehicleTitle(device)}</h2>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  MOTION_STATUS[motion].pill,
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", MOTION_STATUS[motion].dot)} />
                {MOTION_STATUS[motion].label}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {device.vehicleRegistration || "No registration"}
              {device.assignedUserName ? ` · ${device.assignedUserName}` : ""}
            </p>
            <p className="text-[10px] text-muted-foreground font-mono">IMEI {device.imei}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <div className="rounded-lg border bg-background/80 px-3 py-2 text-center min-w-[72px]">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Speed</p>
              <p className="text-xl font-bold tabular-nums mt-0.5">
                {device.lastSpeedKph != null ? Math.round(device.lastSpeedKph) : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground">km/h</p>
            </div>
            <div className="rounded-lg border bg-background/80 px-3 py-2 text-center min-w-[88px]">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Updated</p>
              <p className={cn("text-sm font-semibold mt-1 tabular-nums", freshnessClassLight(freshness))}>
                {formatFreshnessAgo(device.lastSeenAt)}
              </p>
            </div>
            <div className="rounded-lg border bg-background/80 px-3 py-2 text-center min-w-[72px]">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Ignition</p>
              <p className="text-sm font-semibold mt-1">{ignitionLabel(device.lastIgnitionOn)}</p>
            </div>
            <div className="rounded-lg border bg-background/80 px-3 py-2 text-center min-w-[88px]">
              <p className="text-[10px] uppercase text-muted-foreground font-semibold">Odometer</p>
              <p className="text-sm font-semibold mt-1 tabular-nums">
                {device.lastMileageKm != null
                  ? formatMileageKm(device.lastMileageKm).replace(" km", "")
                  : "—"}
              </p>
              <p className="text-[9px] text-muted-foreground">km total</p>
            </div>
            {device.lastLat != null && device.lastLng != null && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-auto self-stretch py-2 text-xs"
                onClick={() =>
                  setMapPin({
                    lat: device.lastLat!,
                    lng: device.lastLng!,
                    title: `${vehicleTitle(device)} — last position`,
                  })
                }
              >
                <MapPin className="h-3.5 w-3.5 mr-1" />
                Map
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <p className="text-sm font-semibold mb-3">Vehicle metrics</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <FleetStatCard
            icon={Route}
            label="Odometer"
            value={
              device.lastMileageKm != null
                ? formatMileageKm(device.lastMileageKm).replace(" km", "")
                : "—"
            }
            sub="km total"
          />
          <FleetStatCard
            icon={Route}
            label="Today"
            value={
              device.todayOdometerDistanceKm != null
                ? formatMileageKm(device.todayOdometerDistanceKm).replace(" km", "")
                : tripStats.distanceKm != null
                  ? tripStats.distanceKm.toFixed(1)
                  : "—"
            }
            sub={
              device.todayOdometerDistanceKm != null
                ? "km (odometer)"
                : tripStats.distanceKm != null
                  ? "km (GPS)"
                  : undefined
            }
          />
          <FleetStatCard
            icon={Route}
            label="Last day"
            value={
              device.lastTripDistanceKm != null
                ? formatMileageKm(device.lastTripDistanceKm).replace(" km", "")
                : "—"
            }
            sub="km (odometer)"
          />
          <FleetStatCard
            icon={Gauge}
            label="Heading"
            value={headingLabel(device.lastHeading)}
            sub={device.lastHeading != null ? `${Math.round(device.lastHeading)}°` : undefined}
          />
        </div>
        {device.lastMileageKm == null && (
          <p className="text-[11px] text-muted-foreground mt-3">
            Odometer readings require extended GPS packets (0x22) from the tracker. Fuel level and
            engine hours are not reported by the current GT06 integration.
          </p>
        )}
      </Card>

      <Tabs defaultValue="travel" className="space-y-4">
        <TabsList>
          <TabsTrigger value="travel">Daily travel</TabsTrigger>
          <TabsTrigger value="alerts" className="gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5" />
            Alerts
          </TabsTrigger>
          <TabsTrigger value="details">Vehicle details</TabsTrigger>
        </TabsList>

        <TabsContent value="travel" className="space-y-4 mt-0">
          <Card className="overflow-hidden">
            <div className="px-4 py-3 border-b flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm font-medium">Route map</p>
              </div>
              <div className="flex items-center gap-2">
                <p className="text-xs text-muted-foreground hidden sm:inline">Last 7 days</p>
                {!historyLoading && (history?.positions?.length ?? 0) > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" className="h-8 text-xs" data-testid="fleet-export">
                        <Download className="h-3.5 w-3.5 mr-1.5" />
                        Download report
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => exportTrip("day", "xlsx")}>
                        Excel — selected day
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportTrip("day", "csv")}>
                        CSV — selected day
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportTrip("week", "xlsx")}>
                        Excel — last 7 days
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => exportTrip("week", "csv")}>
                        CSV — last 7 days
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            </div>

            {historyLoading ? (
              <div className="p-4 space-y-3">
                <Skeleton className="h-8 w-full max-w-md" />
                <Skeleton className="h-[320px]" />
              </div>
            ) : dayBuckets.length === 0 ? (
              <div className="p-6 sm:p-8 text-center space-y-2 max-w-lg mx-auto">
                <p className="text-sm text-muted-foreground">
                  {device.lastSeenAt
                    ? "Tracker is online but has not sent a GPS fix yet (common when ignition is off)."
                    : "No GPS history yet for this vehicle."}
                </p>
                {device.lastSeenAt && (
                  <p className="text-xs text-muted-foreground">
                    SMS the tracker SIM: <span className="font-mono">WHERE,000000#</span> then{" "}
                    <span className="font-mono">TIMER,30,60#</span> so it reports while parked. Or turn
                    ignition on outdoors once.
                  </p>
                )}
              </div>
            ) : (
              <>
                <div className="px-4 py-3 border-b flex gap-1.5 overflow-x-auto">
                  {dayBuckets.map((day) => (
                    <button
                      key={day.key}
                      type="button"
                      onClick={() => setSelectedDayKey(day.key)}
                      className={cn(
                        "shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                        activeDayKey === day.key
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {day.label}
                      <span className="ml-1.5 opacity-70 tabular-nums">{day.positions.length}</span>
                    </button>
                  ))}
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <FleetStatCard
                      icon={Route}
                      label="Distance"
                      value={
                        tripStats.distanceKm != null ? `${tripStats.distanceKm.toFixed(1)} km` : "—"
                      }
                    />
                    <FleetStatCard
                      icon={Gauge}
                      label="Max speed"
                      value={
                        tripStats.maxSpeedKph != null ? `${Math.round(tripStats.maxSpeedKph)}` : "—"
                      }
                      sub="km/h"
                    />
                    <FleetStatCard
                      icon={Activity}
                      label="Driving"
                      value={formatDurationMinutes(tripStats.drivingMinutes)}
                    />
                    <FleetStatCard
                      icon={Timer}
                      label="Idle"
                      value={formatDurationMinutes(tripStats.idleMinutes)}
                    />
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {tripStats.pointCount} GPS points recorded · {activeDay?.label ?? "Selected day"}
                  </p>
                  <FleetHistoryMap positions={activePositions} />
                </div>
              </>
            )}
          </Card>

          {!historyLoading && activePositions.length > 0 && (
            <Collapsible open={logOpen} onOpenChange={setLogOpen}>
              <Card className="overflow-hidden">
                <CollapsibleTrigger asChild>
                  <button
                    type="button"
                    className="w-full px-4 py-3 border-b text-left text-sm font-medium hover:bg-muted/30 transition-colors flex items-center justify-between"
                  >
                    Point log
                    <span className="text-xs font-normal text-muted-foreground ml-2">
                      {activePositions.length} points
                    </span>
                    <ChevronRight className={cn("h-4 w-4 transition-transform", logOpen && "rotate-90")} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="max-h-[280px] overflow-y-auto">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-muted/95 backdrop-blur z-10">
                        <tr className="text-left text-muted-foreground border-b">
                          <th className="px-3 py-2 font-semibold">Time</th>
                          <th className="px-3 py-2 font-semibold">Speed</th>
                          <th className="px-3 py-2 font-semibold">Heading</th>
                          <th className="px-3 py-2 font-semibold">ACC</th>
                          <th className="px-3 py-2 font-semibold">Location</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {activePositions.map((p) => (
                          <tr key={p.id} className="hover:bg-muted/40">
                            <td className="px-3 py-2 whitespace-nowrap tabular-nums font-medium">
                              {formatTime(p.recordedAt)}
                            </td>
                            <td className="px-3 py-2 tabular-nums">
                              {p.speedKph != null ? `${Math.round(p.speedKph)} km/h` : "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {headingLabel(p.heading)}
                            </td>
                            <td className="px-3 py-2">
                              <span
                                className={cn(
                                  "font-medium",
                                  p.ignitionOn ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground",
                                )}
                              >
                                {p.ignitionOn === true ? "On" : p.ignitionOn === false ? "Off" : "—"}
                              </span>
                            </td>
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                className="text-primary hover:underline font-mono text-left text-[11px]"
                                onClick={() =>
                                  setMapPin({
                                    lat: p.latitude,
                                    lng: p.longitude,
                                    title: `${vehicleTitle(device)} — ${formatTime(p.recordedAt)}`,
                                  })
                                }
                              >
                                {p.latitude.toFixed(5)}, {p.longitude.toFixed(5)}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          )}
        </TabsContent>

        <TabsContent value="alerts" className="space-y-4 mt-0">
          <FleetAlertsPanel deviceId={deviceId} hours={168} limit={50} title="Alert history" />
          {canEditAlertRules && (
            <FleetAlertRulesForm
              deviceId={deviceId}
              useDeviceLatLng={{ lat: device.lastLat ?? null, lng: device.lastLng ?? null }}
            />
          )}
        </TabsContent>

        <TabsContent value="details" className="mt-0">
          <Card className="p-4 sm:p-5 space-y-4">
            {canUploadPhoto && (
              <div className="space-y-2">
                <Label>Vehicle photo</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <FleetVehiclePhoto photoUrl={form.vehiclePhotoUrl} size="md" />
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={photoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void uploadVehiclePhoto(f);
                        e.target.value = "";
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={uploadingPhoto}
                      onClick={() => photoInputRef.current?.click()}
                    >
                      <Camera className="h-4 w-4 mr-1" />
                      {form.vehiclePhotoUrl ? "Change photo" : "Upload photo"}
                    </Button>
                    {form.vehiclePhotoUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={uploadingPhoto}
                        onClick={() => setForm((f) => ({ ...f, vehiclePhotoUrl: null }))}
                      >
                        <X className="h-4 w-4 mr-1" />
                        Remove
                      </Button>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Optional. Save the vehicle to keep photo changes.
                </p>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fleet-label">Display name</Label>
                <Input
                  id="fleet-label"
                  value={form.label}
                  onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                  placeholder="e.g. Patrol vehicle 1"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fleet-reg">Registration</Label>
                <Input
                  id="fleet-reg"
                  value={form.vehicleRegistration}
                  onChange={(e) => setForm((f) => ({ ...f, vehicleRegistration: e.target.value }))}
                  placeholder="Number plate"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fleet-make">Make</Label>
                <Input
                  id="fleet-make"
                  value={form.vehicleMake}
                  onChange={(e) => setForm((f) => ({ ...f, vehicleMake: e.target.value }))}
                  placeholder="Ford"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fleet-model">Model</Label>
                <Input
                  id="fleet-model"
                  value={form.vehicleModel}
                  onChange={(e) => setForm((f) => ({ ...f, vehicleModel: e.target.value }))}
                  placeholder="Figo"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Assigned to</Label>
                <Select
                  value={form.assignedUserId || "__none__"}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, assignedUserId: v === "__none__" ? "" : v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Unassigned</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.firstName} {u.lastName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Group</Label>
                <Select
                  value={form.commandId || "__none__"}
                  onValueChange={(v) => setForm((f) => ({ ...f, commandId: v === "__none__" ? "" : v }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="No group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No group</SelectItem>
                    {commands.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.name}
                        {c.isCentral ? " (Central)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="fleet-notes">Notes</Label>
              <Textarea
                id="fleet-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                rows={2}
                placeholder="Optional notes"
              />
            </div>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending || uploadingPhoto}
            >
              <Save className="h-4 w-4 mr-2" />
              Save vehicle
            </Button>
          </Card>
        </TabsContent>
      </Tabs>

      <GeoLocationSheet view={mapPin} onClose={() => setMapPin(null)} />
    </div>
  );
}
