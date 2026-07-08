import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LiveIncidentsMap,
  SA_MAP_DEFAULT,
  PREMISE_COVERAGE_RADIUS_M,
  type LiveIncidentMapItem,
  type OnlineUserMapMarker,
  type PremiseMapMarker,
  type TrackerMapMarker,
} from "@/components/live-incidents-map";
import { cn } from "@/lib/utils";
import { Building2, Car, ChevronDown, MapPin, Users } from "lucide-react";
import { Link } from "wouter";
import {
  getVehicleMotionStatus,
  getFreshnessTier,
  formatFreshnessAgo,
  freshnessClassDark,
  MOTION_STATUS,
  isTrackerOnline,
  vehicleDisplayName,
  ignitionLabel,
} from "@/lib/fleet-intelligence";
import type { DashboardUserSummary, TrackerDeviceSummary } from "@/components/operations-dashboard";

export type MapLayerMode = "all" | "incidents" | "team-fleet";

type ResponderFilter = "all" | "responding" | "available";

const ONLINE_WINDOW_MS = 30 * 60 * 1000;

function formatGpsAge(ts: string | null | undefined): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  return `${Math.round(secs / 3600)}h ago`;
}

function isUserOnline(lastSeenAt: string | Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < ONLINE_WINDOW_MS;
}

function hasMapPosition(user: DashboardUserSummary): boolean {
  if (user.isLive) return false;
  if (user.lastLat == null || user.lastLng == null) return false;
  if (!isUserOnline(user.lastSeenAt)) return false;
  if (user.lastPositionAt) {
    const age = Date.now() - new Date(user.lastPositionAt).getTime();
    if (age > ONLINE_WINDOW_MS) return false;
  }
  return true;
}

function hasTrackerCoordinates(device: TrackerDeviceSummary): boolean {
  return device.lastLat != null && device.lastLng != null;
}

function responderStatus(user: DashboardUserSummary): "responding" | "available" | "off-duty" {
  if (user.isLive) return "responding";
  if (isUserOnline(user.lastSeenAt)) return "available";
  return "off-duty";
}

function formatLastSeen(ts: string | Date | null | undefined): string {
  if (!ts) return "Last seen: no recent activity";
  const age = formatGpsAge(typeof ts === "string" ? ts : ts.toISOString());
  return age ? `Last seen: ${age}` : "Last seen: just now";
}

function getUserPresenceHint(
  user: DashboardUserSummary,
  incidents: LiveIncidentMapItem[],
): string {
  if (user.isLive && user.liveIncidentId) {
    const inc = incidents.find((i) => i.id === user.liveIncidentId);
    if (inc) {
      const loc = inc.destinationName || inc.locationName;
      if (loc) return `On scene · ${loc}`;
      return "On active incident";
    }
    return "Responding now";
  }
  if (isUserOnline(user.lastSeenAt)) return "Online now";
  return formatLastSeen(user.lastSeenAt);
}

function CollapsibleSection({
  title,
  icon: Icon,
  accentClass,
  borderClass,
  count,
  open,
  onToggle,
  headerExtra,
  manageHref,
  testId,
  children,
}: {
  title: string;
  icon: typeof Users;
  accentClass: string;
  borderClass: string;
  count?: string;
  open: boolean;
  onToggle: () => void;
  headerExtra?: ReactNode;
  manageHref?: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn("flex flex-col min-h-0 border-b", open ? "flex-1" : "shrink-0", borderClass)}
      data-testid={testId}
    >
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "shrink-0 w-full px-3 py-2.5 flex items-center gap-2 text-left transition-colors",
          open ? accentClass : "hover:bg-slate-800/50",
        )}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" />
        <span className="text-[10px] font-bold uppercase tracking-[0.14em] flex-1">{title}</span>
        {count != null && <span className="text-[10px] text-slate-500 tabular-nums">{count}</span>}
        {manageHref && (
          <Link
            href={manageHref}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] text-blue-400 hover:underline px-1"
          >
            Manage
          </Link>
        )}
        <ChevronDown
          className={cn("h-4 w-4 text-slate-500 transition-transform shrink-0", open && "rotate-180")}
        />
      </button>
      {headerExtra}
      {open && <div className="flex-1 min-h-0 overflow-hidden flex flex-col">{children}</div>}
    </section>
  );
}

type CommandWithSite = {
  id: number;
  name: string;
  primarySite?: {
    id: number;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

function buildPremises(commands: CommandWithSite[], locations: Location[]): PremiseMapMarker[] {
  const items: PremiseMapMarker[] = [];
  const seen = new Set<string>();

  for (const cmd of commands) {
    const site = cmd.primarySite;
    if (site?.latitude == null || site.longitude == null) continue;
    const key = `${site.latitude.toFixed(5)},${site.longitude.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `cmd-${cmd.id}`,
      name: site.name,
      groupName: cmd.name,
      address: site.address,
      lat: site.latitude,
      lng: site.longitude,
    });
  }

  for (const loc of locations) {
    if (loc.latitude == null || loc.longitude == null) continue;
    const key = `${loc.latitude.toFixed(5)},${loc.longitude.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      id: `loc-${loc.id}`,
      name: loc.name,
      address: loc.address,
      lat: loc.latitude,
      lng: loc.longitude,
    });
  }

  return items;
}

function premiseColorClass(index: number): string {
  const colors = [
    "border-emerald-500/40 bg-emerald-950/25",
    "border-blue-500/40 bg-blue-950/25",
    "border-violet-500/40 bg-violet-950/25",
    "border-amber-500/40 bg-amber-950/25",
    "border-pink-500/40 bg-pink-950/25",
    "border-cyan-500/40 bg-cyan-950/25",
  ];
  return colors[index % colors.length];
}

const LAYER_LABELS: Record<MapLayerMode, string> = {
  all: "All",
  incidents: "Incidents",
  "team-fleet": "Team & Fleet",
};

type ControlRoomMapProps = {
  incidents: LiveIncidentMapItem[];
  locations?: Location[];
  highlightId?: number | null;
  onHighlightId?: (id: number | null) => void;
  onIncidentMarkerClick?: (id: number) => void;
  onOpenLiveMonitor?: (incidentId?: number) => void;
  testId?: string;
  className?: string;
  /** Show fleet/team side panels (desktop live monitor). */
  showSidePanels?: boolean;
  darkTheme?: boolean;
};

export function ControlRoomMap({
  incidents,
  locations = [],
  highlightId: highlightIdProp,
  onHighlightId,
  onIncidentMarkerClick,
  onOpenLiveMonitor,
  testId = "map-control-room",
  className,
  showSidePanels = true,
  darkTheme = true,
}: ControlRoomMapProps) {
  const [layerMode, setLayerMode] = useState<MapLayerMode>("all");
  const [highlightIdInternal, setHighlightIdInternal] = useState<number | null>(null);
  const [highlightTrackerId, setHighlightTrackerId] = useState<number | null>(null);
  const [teamPanelOpen, setTeamPanelOpen] = useState(true);
  const [fleetPanelOpen, setFleetPanelOpen] = useState(true);
  const [premisesPanelOpen, setPremisesPanelOpen] = useState(true);
  const [highlightPremiseId, setHighlightPremiseId] = useState<string | null>(null);
  const [responderFilter, setResponderFilter] = useState<ResponderFilter>("all");

  const { data: commands = [] } = useQuery<CommandWithSite[]>({
    queryKey: ["/api/commands"],
  });

  const premises = useMemo(
    () => buildPremises(commands, locations),
    [commands, locations],
  );

  const highlightId = highlightIdProp ?? highlightIdInternal;
  const setHighlightId = (id: number | null) => {
    setHighlightIdInternal(id);
    onHighlightId?.(id);
  };

  const { data: dayDashboard, isLoading: teamLoading } = useQuery<{
    users: DashboardUserSummary[];
  }>({
    queryKey: ["/api/dashboard", "day"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard?period=day", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    refetchInterval: 30_000,
  });

  const { data: trackers = [], isLoading: trackersLoading } = useQuery<TrackerDeviceSummary[]>({
    queryKey: ["/api/trackers"],
    queryFn: async () => {
      const res = await fetch("/api/trackers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trackers");
      return res.json();
    },
    refetchInterval: 20_000,
  });

  const teamUsers = dayDashboard?.users ?? [];

  const filteredTeam = useMemo(() => {
    return teamUsers.filter((u) => {
      const status = responderStatus(u);
      if (responderFilter === "responding") return status === "responding";
      if (responderFilter === "available") return status === "available";
      return true;
    });
  }, [teamUsers, responderFilter]);

  const onlineMapUsers = useMemo((): OnlineUserMapMarker[] => {
    if (layerMode === "incidents") return [];
    return teamUsers
      .filter(hasMapPosition)
      .map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        lat: u.lastLat!,
        lng: u.lastLng!,
        lastPositionAt: u.lastPositionAt
          ? new Date(u.lastPositionAt).toISOString()
          : null,
      }));
  }, [teamUsers, layerMode]);

  const trackerMapMarkers = useMemo((): TrackerMapMarker[] => {
    if (layerMode === "incidents") return [];
    return trackers
      .filter(hasTrackerCoordinates)
      .map((t) => ({
        id: t.id,
        label: vehicleDisplayName(t),
        imei: t.imei,
        lat: t.lastLat!,
        lng: t.lastLng!,
        speedKph: t.lastSpeedKph,
        heading: t.lastHeading,
        ignitionOn: t.lastIgnitionOn,
        lastPositionAt: t.lastPositionAt,
        lastSeenAt: t.lastSeenAt,
        driverName: t.assignedUserName,
        registration: t.vehicleRegistration,
        motionStatus: getVehicleMotionStatus(t.lastSeenAt, t.lastSpeedKph),
      }));
  }, [trackers, layerMode]);

  const mapIncidents = layerMode === "team-fleet" ? [] : incidents;

  const liveTrackers = useMemo(
    () => trackers.filter((t) => isTrackerOnline(t.lastSeenAt) && hasTrackerCoordinates(t)),
    [trackers],
  );

  const movingCount = useMemo(
    () =>
      trackers.filter((t) => getVehicleMotionStatus(t.lastSeenAt, t.lastSpeedKph) === "moving").length,
    [trackers],
  );

  const fleetHeaderCount = useMemo(() => {
    if (movingCount > 0) return `${movingCount} moving`;
    if (liveTrackers.length > 0) return `${liveTrackers.length}/${trackers.length} live`;
    return `${trackers.length} units`;
  }, [movingCount, liveTrackers.length, trackers.length]);

  const showPanels = showSidePanels && layerMode !== "incidents";

  return (
    <div className={cn("flex flex-1 min-h-0 overflow-hidden", className)}>
      <div className="flex-1 min-w-0 relative flex flex-col bg-[#0a0e14]">
        <div className="absolute top-3 left-3 z-20 flex rounded-lg border border-slate-600/80 bg-slate-900/95 backdrop-blur-sm p-0.5 shadow-lg">
          {(["all", "incidents", "team-fleet"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setLayerMode(mode)}
              className={cn(
                "px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wide rounded-md transition-colors",
                layerMode === mode
                  ? "bg-emerald-600 text-white"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800",
              )}
              data-testid={`map-layer-${mode}`}
            >
              {LAYER_LABELS[mode]}
            </button>
          ))}
        </div>

        <LiveIncidentsMap
          incidents={mapIncidents}
          onlineUsers={onlineMapUsers}
          trackers={trackerMapMarkers}
          premises={premises}
          highlightId={highlightId}
          highlightTrackerId={highlightTrackerId}
          highlightPremiseId={highlightPremiseId}
          onIncidentMarkerClick={(id) => {
            setHighlightId(id);
            onIncidentMarkerClick?.(id);
          }}
          onTrackerMarkerClick={setHighlightTrackerId}
          onPremiseMarkerClick={setHighlightPremiseId}
          className="absolute inset-0"
          testId={testId}
          darkTheme={darkTheme}
          initialZoom={SA_MAP_DEFAULT.zoom}
          showMapControls
        />
      </div>

      {showPanels && (
        <div
          className="w-[24%] min-w-[200px] max-w-xs flex flex-col min-h-0 border-l border-slate-800/80 bg-[#131a22] shrink-0"
          data-testid="control-room-side-panel"
        >
          <CollapsibleSection
            title="Premises"
            icon={Building2}
            accentClass="bg-violet-950/30"
            borderClass="border-violet-900/25"
            count={premises.length > 0 ? String(premises.length) : undefined}
            open={premisesPanelOpen}
            onToggle={() => setPremisesPanelOpen((v) => !v)}
            manageHref="/commands"
            testId="control-room-premises-panel"
          >
            <div className="flex-1 overflow-y-auto ops-scroll max-h-40">
              {premises.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6 px-3">
                  No premises pinned yet. Add locations in Groups.
                </p>
              ) : (
                <ul className="divide-y divide-violet-900/15">
                  {premises.map((premise, index) => (
                    <li key={premise.id}>
                      <button
                        type="button"
                        onClick={() => setHighlightPremiseId(premise.id)}
                        className={cn(
                          "w-full text-left px-3 py-2.5 hover:bg-violet-950/25 transition-colors",
                          highlightPremiseId === premise.id && "bg-violet-950/35",
                        )}
                        data-testid={`premise-row-${premise.id}`}
                      >
                        <div className="flex items-start gap-2">
                          <div
                            className={cn(
                              "mt-0.5 h-7 w-7 shrink-0 rounded-md border flex items-center justify-center",
                              premiseColorClass(index),
                            )}
                          >
                            <MapPin className="h-3.5 w-3.5 text-violet-300" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 truncate">{premise.name}</p>
                            {premise.groupName && (
                              <p className="text-[10px] text-violet-400/90 font-semibold uppercase tracking-wide truncate">
                                {premise.groupName}
                              </p>
                            )}
                            {premise.address && (
                              <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2 leading-snug">
                                {premise.address}
                              </p>
                            )}
                            <p className="text-[9px] text-slate-600 mt-1">
                              {PREMISE_COVERAGE_RADIUS_M / 1000} km radius on map
                            </p>
                          </div>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Fleet"
            icon={Car}
            accentClass="bg-blue-950/30"
            borderClass="border-blue-900/25"
            count={fleetHeaderCount}
            open={fleetPanelOpen}
            onToggle={() => setFleetPanelOpen((v) => !v)}
            manageHref="/fleet"
            testId="control-room-fleet-panel"
          >
            <div className="flex-1 overflow-y-auto ops-scroll">
              {trackersLoading ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-10 bg-slate-800" />
                </div>
              ) : trackers.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-6 px-3">No GPS trackers linked.</p>
              ) : (
                <ul className="divide-y divide-blue-900/20">
                  {trackers.map((device) => {
                    const motion = getVehicleMotionStatus(device.lastSeenAt, device.lastSpeedKph);
                    const motionCfg = MOTION_STATUS[motion];
                    const hasCoords = hasTrackerCoordinates(device);
                    const isHighlighted = highlightTrackerId === device.id;
                    const speed =
                      device.lastSpeedKph != null ? Math.round(device.lastSpeedKph) : null;
                    const freshness = getFreshnessTier(device.lastSeenAt);

                    return (
                      <li key={device.id}>
                        <button
                          type="button"
                          disabled={!hasCoords}
                          onClick={() => {
                            setFleetPanelOpen(true);
                            setHighlightTrackerId(device.id);
                            setHighlightId(null);
                          }}
                          className={cn(
                            "w-full text-left px-3 py-3 transition-colors border-l-2",
                            hasCoords ? "hover:bg-blue-950/35" : "opacity-50 cursor-not-allowed",
                            isHighlighted
                              ? "bg-blue-950/55 border-l-blue-400"
                              : "border-l-transparent",
                          )}
                        >
                          <p className="text-sm font-semibold text-slate-100 truncate">
                            {vehicleDisplayName(device)}
                          </p>
                          <p className="text-[10px] text-slate-500 truncate mt-0.5">
                            {device.vehicleRegistration?.trim() || `IMEI …${device.imei.slice(-6)}`}
                          </p>
                          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[8px] font-bold uppercase",
                                motionCfg.pill,
                              )}
                            >
                              {motionCfg.label}
                            </span>
                            <span className="text-sm font-bold tabular-nums text-slate-100">
                              {speed != null ? `${speed}` : "—"}
                              <span className="text-[10px] font-medium text-slate-500 ml-0.5">km/h</span>
                            </span>
                            <span
                              className={cn(
                                "text-[10px] font-medium tabular-nums",
                                freshnessClassDark(freshness),
                              )}
                            >
                              {formatFreshnessAgo(device.lastSeenAt)}
                            </span>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CollapsibleSection>

          <CollapsibleSection
            title="Team"
            icon={Users}
            accentClass="bg-emerald-950/25"
            borderClass="border-emerald-900/20"
            count={String(teamUsers.length)}
            open={teamPanelOpen}
            onToggle={() => setTeamPanelOpen((v) => !v)}
            testId="control-room-team-panel"
            headerExtra={
              teamPanelOpen ? (
                <div className="shrink-0 px-3 pb-2 flex gap-1 border-b border-emerald-900/15">
                  {(["all", "responding", "available"] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setResponderFilter(f)}
                      className={cn(
                        "flex-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors",
                        responderFilter === f
                          ? "bg-emerald-700/80 text-white"
                          : "bg-slate-800 text-slate-500 hover:text-slate-300",
                      )}
                    >
                      {f === "all" ? "All" : f === "responding" ? "Active" : "Avail"}
                    </button>
                  ))}
                </div>
              ) : null
            }
          >
            <div className="flex-1 overflow-y-auto ops-scroll">
              {teamLoading ? (
                <div className="p-3 space-y-2">
                  <Skeleton className="h-12 bg-slate-800" />
                </div>
              ) : filteredTeam.length === 0 ? (
                <p className="text-xs text-slate-600 text-center py-8 px-3">No team members match this filter.</p>
              ) : (
                <ul className="divide-y divide-emerald-900/15">
                  {filteredTeam.map((user) => {
                    const status = responderStatus(user);
                    const statusLabel =
                      status === "responding" ? "Responding" : status === "available" ? "Available" : "Off duty";

                    return (
                      <li key={user.id} className="px-3 py-2.5 hover:bg-emerald-950/20">
                        <div className="flex items-start gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-950/40 border border-emerald-800/30 text-xs font-bold text-emerald-200">
                            {user.firstName.charAt(0)}
                            {user.lastName.charAt(0)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-200 truncate">
                              {user.firstName} {user.lastName}
                            </p>
                            <p className="text-[10px] text-slate-500 capitalize">{user.role}</p>
                            <span className="inline-flex mt-1 rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-400 border-slate-700">
                              {statusLabel}
                            </span>
                            <p className="text-[10px] text-slate-500 mt-1.5 leading-snug truncate">
                              {getUserPresenceHint(user, incidents)}
                            </p>
                            {user.isLive && user.liveIncidentId && onOpenLiveMonitor && (
                              <button
                                type="button"
                                className="block mt-1 text-[10px] text-emerald-500 hover:underline"
                                onClick={() => onOpenLiveMonitor(user.liveIncidentId!)}
                              >
                                View incident →
                              </button>
                            )}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </CollapsibleSection>
        </div>
      )}
    </div>
  );
}
