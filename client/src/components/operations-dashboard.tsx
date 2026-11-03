import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { type LiveIncidentMapItem } from "@/components/live-incidents-map";
import { ControlRoomMap } from "@/components/control-room-map";
import { cn } from "@/lib/utils";
import { apiRequest } from "@/lib/queryClient";
import {
  Flame,
  PawPrint,
  Radio,
  ShieldAlert,
  Siren,
  MessageSquare,
  ChevronRight,
  MapPin,
  Crosshair,
  Clock,
  Users,
  ExternalLink,
  CheckCircle2,
  BellRing,
  Building2,
  Car,
  ChevronLeft,
  Gauge,
  KeyRound,
  Network,
  Route as RouteIcon,
  Signal,
  Paperclip,
  ClipboardList,
  UserRound,
  Sun,
  Moon,
  type LucideIcon,
} from "lucide-react";
import {
  formatMileageKm,
  getVehicleMotionStatus,
  freshnessClassDark,
  preferredTodayDistanceKm,
  trackerSignalSummary,
  MOTION_STATUS,
  vehicleDisplayName,
} from "@/lib/fleet-intelligence";
import { useControlRoomLang } from "@/hooks/use-control-room-lang";
import { useTheme } from "@/components/theme-provider";
import type { ControlRoomCopy } from "@/lib/control-room-i18n";
import { GeoMapPreview } from "@/components/incident-location-sheet";
import { FleetBatteryMeter } from "@/components/fleet/fleet-battery-meter";
import { FleetVehiclePhoto } from "@/components/fleet/fleet-vehicle-photo";
import { ExpandablePhoto } from "@/components/photo-lightbox";
import { AttachmentsDialog, IncidentDialog } from "@/components/incident-dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Period = "day" | "week";

export type DashboardUserSummary = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  avatarUrl: string | null;
  incidentCount: number;
  isLive: boolean;
  liveIncidentId: number | null;
  lastSeenAt: string | Date | null;
  lastLat: number | null;
  lastLng: number | null;
  lastPositionAt: string | Date | null;
};

type DashboardData = {
  totalIncidents: number;
  liveCount: number;
  chartData: Array<{ label: string; count: number }>;
  users: DashboardUserSummary[];
};

export type TrackerDeviceSummary = {
  id: number;
  imei: string;
  label: string | null;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleRegistration: string | null;
  vehiclePhotoUrl: string | null;
  simPhone?: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  notes: string | null;
  commandId: number | null;
  commandName: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastSpeedKph: number | null;
  lastHeading: number | null;
  lastIgnitionOn: boolean | null;
  lastMileageKm: number | null;
  lastBatteryPercent?: number | null;
  todayOdometerDistanceKm: number | null;
  todayGpsDistanceKm?: number | null;
  todayDistanceKm?: number | null;
  lastTripDistanceKm: number | null;
  lastGpsValid: boolean | null;
  lastPositionAt: string | null;
  lastSeenAt: string | null;
};

type LiveQueueItem = LiveIncidentMapItem & {
  locationId?: number | null;
};

type OccurrenceRow = {
  id: number;
  incidentDate: string;
  incidentTime: string;
  createdAt: string | Date;
  isLive: boolean;
  categoryName: string | null;
  locationName: string | null;
  severity: string | null;
  reporterFirstName: string | null;
  reporterLastName: string | null;
  panicClosedAt?: string | Date | null;
  attachmentCount?: number;
};

type AlertKind = "fire" | "panic" | "crime" | "livestock";

/** Open vuur, paniek, misdaad, and roaming livestock. Livestock is its own button, not misdaad. */
function alertKindOf(categoryName: string | null | undefined): AlertKind | null {
  const name = (categoryName ?? "").trim().toLowerCase();
  if (!name) return null;
  if (name.includes("panic") || name.includes("paniek")) return "panic";
  if (name.includes("vuur") || name.includes("fire") || name.includes("brand")) return "fire";
  if (name.includes("wilde") || name.includes("rondloop")) return "livestock";
  if (
    name.includes("misdaad")
    || name.includes("crime")
    || name.includes("verdagte")
    || name.includes("inbraak")
    || name.includes("veediefstal")
    || name.includes("burglar")
    || name.includes("theft")
  ) return "crime";
  return null;
}

/** True when the incident started as a panic alert (including later reclassified types e.g. Fire). */
function isPanicOriginated(inc: OccurrenceRow): boolean {
  if ((inc.categoryName ?? "").toLowerCase().includes("panic")) return true;
  return inc.panicClosedAt != null && inc.panicClosedAt !== "";
}

function formatSignalAge(ts: string | null | undefined, copy: ControlRoomCopy): string {
  if (!ts) return copy.noSignal;
  const secs = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (secs < 8) return copy.justNow;
  if (secs < 60) return copy.secondsAgo(secs);
  if (secs < 3600) return copy.minutesAgo(Math.floor(secs / 60));
  if (secs < 86400) return copy.hoursAgo(Math.floor(secs / 3600));
  return copy.daysAgo(Math.floor(secs / 86400));
}

function formatGpsAge(ts: string | null | undefined, copy: ControlRoomCopy): string | null {
  if (!ts) return null;
  const secs = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
  if (secs < 60) return copy.secondsAgo(secs);
  if (secs < 3600) return copy.minutesAgo(Math.round(secs / 60));
  return copy.hoursAgo(Math.round(secs / 3600));
}

function formatStarterName(inc: LiveQueueItem): string | null {
  const name = [inc.responderFirstName, inc.responderLastName].filter(Boolean).join(" ").trim();
  return name || null;
}

function formatMapCoordinates(lat: number | null, lng: number | null): string | null {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function alertChipClass(kind: AlertKind | null): string {
  if (kind === "fire") return "bg-orange-600 text-white";
  if (kind === "panic") return "bg-red-600 text-white";
  if (kind === "crime") return "bg-zinc-800 text-white";
  if (kind === "livestock") return "bg-amber-700 text-white";
  return "bg-slate-600 text-white";
}

function severityPillClass(severity: string | null): string {
  if (severity === "red") return "bg-red-600 text-white";
  if (severity === "orange") return "bg-orange-600 text-white";
  if (severity === "yellow") return "bg-amber-500 text-white";
  return "bg-slate-600 text-white";
}

const OPS_FACILITY_STORAGE_KEY = "ops-selected-facility";
/** Control room treats members as visible only if seen within this window. */
const TEAM_VISIBLE_MS = 3 * 60 * 1000;
const TEAM_STALE_ACTIVITY_MS = 4 * 60 * 60 * 1000;
const WAKE_QUIET_MS = 60 * 60 * 1000;
const WAKE_COOLDOWN_MS = 15 * 60 * 1000;

function teamLastActivityAt(user: DashboardUserSummary): Date | null {
  const stamps = [user.lastSeenAt, user.lastPositionAt]
    .filter((v): v is string | Date => v != null && v !== "")
    .map((v) => new Date(v).getTime())
    .filter((t) => Number.isFinite(t));
  if (stamps.length === 0) return null;
  return new Date(Math.max(...stamps));
}

function formatTeamLastActivity(lastAt: Date | null, copy: ControlRoomCopy): string {
  if (!lastAt) return copy.noActivity;
  const secs = Math.max(0, Math.round((Date.now() - lastAt.getTime()) / 1000));
  if (secs < 60) return copy.justNow;
  if (secs < 3600) return copy.minutesAgo(Math.round(secs / 60));
  if (secs < 86400) return copy.hoursAgo(Math.round(secs / 3600));
  return copy.daysAgo(Math.round(secs / 86400));
}

function canWakeMember(user: DashboardUserSummary, now: number): boolean {
  if (user.isLive) return false;
  const lastAt = teamLastActivityAt(user);
  if (!lastAt) return true;
  return now - lastAt.getTime() >= WAKE_QUIET_MS;
}

function isTeamActivityStale(user: DashboardUserSummary): boolean {
  if (user.isLive) return false;
  const lastAt = teamLastActivityAt(user);
  if (!lastAt) return true;
  return Date.now() - lastAt.getTime() > TEAM_STALE_ACTIVITY_MS;
}

function isTeamMemberVisible(lastSeenAt: string | Date | null | undefined): boolean {
  if (!lastSeenAt) return false;
  return Date.now() - new Date(lastSeenAt).getTime() < TEAM_VISIBLE_MS;
}

function teamMemberStatus(user: DashboardUserSummary): "responding" | "available" | "off-duty" {
  if (user.isLive) return "responding";
  if (isTeamMemberVisible(user.lastSeenAt)) return "available";
  return "off-duty";
}

function teamStatusLabel(status: ReturnType<typeof teamMemberStatus>, copy: ControlRoomCopy): string {
  if (status === "responding") return copy.liveNow;
  if (status === "available") return copy.onSystem;
  return copy.notOnline;
}

function teamSeenMs(user: DashboardUserSummary): number {
  if (!user.lastSeenAt) return 0;
  const seen = new Date(user.lastSeenAt).getTime();
  return Number.isFinite(seen) ? seen : 0;
}

/** On the system first, then whoever was on it most recently. */
function compareTeamPresence(a: DashboardUserSummary, b: DashboardUserSummary): number {
  const rank = (user: DashboardUserSummary) => {
    const status = teamMemberStatus(user);
    if (status === "responding") return 0;
    if (status === "available") return 1;
    return 2;
  };
  const byStatus = rank(a) - rank(b);
  if (byStatus !== 0) return byStatus;
  return teamSeenMs(b) - teamSeenMs(a);
}

function teamLastOnSystemLabel(user: DashboardUserSummary, copy: ControlRoomCopy): string | null {
  const seen = user.lastSeenAt ? new Date(user.lastSeenAt) : null;
  const when = formatTeamLastActivity(seen && Number.isFinite(seen.getTime()) ? seen : null, copy);
  if (when === copy.noActivity) return null;
  return when;
}

/** Chip line: on the system right now, or not online with when they last were. */
function teamPresenceLine(user: DashboardUserSummary, copy: ControlRoomCopy): string {
  const status = teamMemberStatus(user);
  if (status === "responding" || status === "available") return teamStatusLabel(status, copy);
  const when = teamLastOnSystemLabel(user, copy);
  if (!when) return copy.notOnline;
  return `${copy.notOnline} · ${when}`;
}

function teamStatusPillClass(status: ReturnType<typeof teamMemberStatus>): string {
  if (status === "responding") {
    return "bg-orange-500/15 text-orange-300 ring-1 ring-inset ring-orange-500/25";
  }
  if (status === "available") {
    return "bg-emerald-500/12 text-emerald-300 ring-1 ring-inset ring-emerald-500/25";
  }
  return "bg-red-500/15 text-red-300 ring-1 ring-inset ring-red-500/35";
}

function mapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function formatTeamPositionAt(value: string | Date | null | undefined, copy: ControlRoomCopy): string {
  if (!value) return copy.unknownTime;
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return copy.unknownTime;
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function userIdsAtLocation(
  assignments: Array<{ userId: string; locationId: number }>,
  locationId: number,
): Set<string> {
  return new Set(assignments.filter((a) => a.locationId === locationId).map((a) => a.userId));
}

function filterTeamForFacility(
  users: DashboardUserSummary[],
  assignments: Array<{ userId: string; locationId: number }>,
  locationId: number | null,
): DashboardUserSummary[] {
  if (locationId == null) return users;
  const atSite = userIdsAtLocation(assignments, locationId);
  return users.filter((u) => atSite.has(u.id));
}

function filterTrackersForFacility(
  trackers: TrackerDeviceSummary[],
  assignments: Array<{ userId: string; locationId: number }>,
  location: Location | undefined,
  locationId: number | null,
): TrackerDeviceSummary[] {
  if (locationId == null || !location) return trackers;
  const atSite = userIdsAtLocation(assignments, locationId);
  return trackers.filter(
    (t) =>
      (location.commandId != null && t.commandId === location.commandId)
      || (t.assignedUserId != null && atSite.has(t.assignedUserId)),
  );
}

function userIdsInCommand(
  assignments: Array<{ userId: string; commandId: number }>,
  commandId: number,
): Set<string> {
  return new Set(assignments.filter((a) => a.commandId === commandId).map((a) => a.userId));
}

function filterTeamForCommand(
  users: DashboardUserSummary[],
  assignments: Array<{ userId: string; commandId: number }>,
  activeCommandId: number | "all" | null,
  accessibleCommandIds: number[],
): DashboardUserSummary[] {
  if (activeCommandId === "all" || activeCommandId == null) {
    if (accessibleCommandIds.length === 0) return users;
    const inAny = new Set(
      assignments
        .filter((a) => accessibleCommandIds.includes(a.commandId))
        .map((a) => a.userId),
    );
    return users.filter((u) => inAny.has(u.id));
  }
  const atCommand = userIdsInCommand(assignments, activeCommandId);
  return users.filter((u) => atCommand.has(u.id));
}

type Props = {
  currentUser?: { id: string; firstName: string; lastName: string; role: string };
  liveIncidents: LiveQueueItem[];
  panicAlerts: PanicAlert[];
  dismissedPanicIds: Set<number>;
  onDismissPanic: (id: number) => void;
  locations: Location[];
  period: Period;
  onPeriodChange: (p: Period) => void;
  dashboardData?: DashboardData;
  dashboardLoading: boolean;
  totalUnread: number;
  unreadSenders: string[];
  onOpenChat: () => void;
  onOpenLiveMonitor: (incidentId?: number) => void;
  onOpenOccurrence: (incidentId?: number, bookPeriod?: Period) => void;
  onOpenFleet?: (deviceId?: number) => void;
  onPanic: () => void;
  /** Local sample data so the Team and Fleet cards can be viewed without signing in. */
  preview?: {
    users: DashboardUserSummary[];
    trackers: TrackerDeviceSummary[];
    groupName?: string;
  };
};

type OpsSectionTone = "blue" | "orange" | "slate" | "emerald" | "indigo" | "cyan" | "violet";

const OPS_SECTION_TONE: Record<
  OpsSectionTone,
  { bar: string; icon: string; title: string; border: string }
> = {
  blue: {
    bar: "bg-blue-950/55",
    border: "border-blue-500/35",
    icon: "bg-blue-600 text-white shadow-sm shadow-blue-900/50",
    title: "text-blue-50",
  },
  indigo: {
    bar: "bg-indigo-950/55",
    border: "border-indigo-500/40",
    icon: "bg-indigo-600 text-white shadow-sm shadow-indigo-900/50",
    title: "text-indigo-50",
  },
  cyan: {
    bar: "bg-cyan-950/50",
    border: "border-cyan-500/40",
    icon: "bg-cyan-600 text-white shadow-sm shadow-cyan-900/50",
    title: "text-cyan-50",
  },
  violet: {
    bar: "bg-violet-950/50",
    border: "border-violet-500/40",
    icon: "bg-violet-600 text-white shadow-sm shadow-violet-900/50",
    title: "text-violet-50",
  },
  orange: {
    bar: "bg-orange-950/50",
    border: "border-orange-500/35",
    icon: "bg-orange-600 text-white shadow-sm shadow-orange-900/50",
    title: "text-orange-50",
  },
  slate: {
    bar: "bg-slate-800/90",
    border: "border-slate-500/40",
    icon: "bg-slate-500 text-white shadow-sm shadow-slate-900/50",
    title: "text-slate-50",
  },
  emerald: {
    bar: "bg-emerald-950/45",
    border: "border-emerald-500/35",
    icon: "bg-emerald-600 text-white shadow-sm shadow-emerald-900/50",
    title: "text-emerald-50",
  },
};

function OpsSectionHeader({
  title,
  icon: Icon,
  tone,
  right,
  testId,
}: {
  title: string;
  icon: LucideIcon;
  tone: OpsSectionTone;
  right?: ReactNode;
  testId?: string;
}) {
  const s = OPS_SECTION_TONE[tone];
  return (
    <div
      className={cn(
        "shrink-0 px-3 py-2.5 border-b border-l-[4px] flex items-center justify-between gap-2",
        s.bar,
        s.border,
      )}
      data-testid={testId}
    >
      <p className={cn("text-xs font-extrabold uppercase tracking-[0.14em] flex items-center gap-2", s.title)}>
        <span className={cn("inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md", s.icon)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {title}
      </p>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}

function OpsSubSectionHeader({
  title,
  icon: Icon,
  tone,
  count,
  right,
}: {
  title: string;
  icon: LucideIcon;
  tone: OpsSectionTone;
  count?: number;
  right?: ReactNode;
}) {
  const s = OPS_SECTION_TONE[tone];
  return (
    <div
      className={cn(
        "shrink-0 px-3 py-2.5 border-b border-l-[3px] flex items-center justify-between gap-2",
        s.bar,
        s.border,
      )}
    >
      <p className={cn("text-xs font-bold uppercase tracking-[0.12em] flex items-center gap-2", s.title)}>
        <Icon className="h-4 w-4 shrink-0 opacity-90" />
        {title}
      </p>
      <div className="flex items-center gap-2 shrink-0">
        {right}
        {count != null && (
          <span className={cn("text-[11px] font-semibold tabular-nums", s.title, "opacity-80")}>{count}</span>
        )}
      </div>
    </div>
  );
}

export function OperationsDashboard({
  currentUser,
  liveIncidents,
  panicAlerts,
  dismissedPanicIds,
  onDismissPanic,
  locations,
  dashboardData,
  dashboardLoading,
  totalUnread,
  onOpenChat,
  onOpenLiveMonitor,
  onOpenOccurrence,
  onOpenFleet,
  onPanic,
  preview,
}: Props) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { lang, toggle, t } = useControlRoomLang();
  const { theme, setTheme } = useTheme();
  const light = theme === "light";
  const [monitorTab] = useState<"team" | "fleet">("team");
  const [mapAlert, setMapAlert] = useState<AlertKind | null>(null);
  const [highlightId, setHighlightId] = useState<number | null>(null);
  const [liveMapType, setLiveMapType] = useState<"roadmap" | "hybrid">("roadmap");
  const [clock, setClock] = useState(() => new Date());
  const [lastRefresh, setLastRefresh] = useState(() => new Date());
  const [selectedTeamMember, setSelectedTeamMember] = useState<DashboardUserSummary | null>(null);
  const [attachmentsPreview, setAttachmentsPreview] = useState<{
    id: number;
    subject: string;
    bookPeriod?: Period;
  } | null>(null);
  /** Team row → focus that person on the Live Incidents overview map. */
  const [mapFocusUserId, setMapFocusUserId] = useState<string | null>(null);
  const [showAllMembers, setShowAllMembers] = useState(false);
  const [logIncidentOpen, setLogIncidentOpen] = useState(false);
  const [wakeUntil, setWakeUntil] = useState<Record<string, number>>({});
  const [ackedIds, setAckedIds] = useState<number[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem("omt-dashboard-acked") ?? "[]");
      return Array.isArray(raw) ? raw.filter((id) => typeof id === "number") : [];
    } catch {
      return [];
    }
  });
  const [closedIds, setClosedIds] = useState<number[]>([]);
  const [closeTarget, setCloseTarget] = useState<LiveQueueItem | null>(null);
  const [closeReport, setCloseReport] = useState("");
  const [rowBusyId, setRowBusyId] = useState<number | null>(null);
  const teamStripRef = useRef<HTMLDivElement>(null);
  const [teamCanScrollLeft, setTeamCanScrollLeft] = useState(false);
  const [teamCanScrollRight, setTeamCanScrollRight] = useState(false);
  const [selectedFacility, setSelectedFacility] = useState<string>(() => {
    if (typeof window === "undefined") return "all";
    return localStorage.getItem(OPS_FACILITY_STORAGE_KEY) ?? "all";
  });

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [clock]);

  const { data: dayDashboard, isLoading: dayLoading } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", "day"],
    queryFn: async () => {
      const res = await fetch("/api/dashboard?period=day", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load dashboard");
      return res.json();
    },
    enabled: !preview,
    refetchInterval: 30_000,
  });

  const { data: allIncidents = [], isLoading: incidentsLoading } = useQuery<OccurrenceRow[]>({
    queryKey: ["/api/incidents"],
    queryFn: async () => {
      const res = await fetch("/api/incidents", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load incidents");
      return res.json();
    },
    enabled: !preview,
    refetchInterval: 30_000,
  });

  const { data: trackers = [], isLoading: trackersLoading } = useQuery<TrackerDeviceSummary[]>({
    queryKey: ["/api/trackers"],
    queryFn: async () => {
      const res = await fetch("/api/trackers", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load trackers");
      return res.json();
    },
    enabled: !preview,
    refetchInterval: 20_000,
  });

  const { data: locationAssignmentsData, isLoading: assignmentsLoading } = useQuery<{
    assignments: Array<{ userId: string; locationId: number }>;
  }>({
    queryKey: ["/api/location-assignments"],
    queryFn: async () => {
      const res = await fetch("/api/location-assignments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load location assignments");
      return res.json();
    },
    enabled: !preview,
    refetchInterval: 60_000,
  });

  const { data: commandAssignmentsData, isLoading: commandAssignmentsLoading } = useQuery<{
    assignments: Array<{ userId: string; commandId: number }>;
  }>({
    queryKey: ["/api/command-assignments"],
    queryFn: async () => {
      const res = await fetch("/api/command-assignments", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load command assignments");
      return res.json();
    },
    enabled: !preview,
    refetchInterval: 60_000,
  });

  const locationAssignments = locationAssignmentsData?.assignments ?? [];
  const commandAssignments = commandAssignmentsData?.assignments ?? [];

  const { data: commandsData } = useQuery<{
    commands: Array<{ id: number; name: string; isCentral: boolean; readOnly?: boolean }>;
    activeCommandId: number | "all" | null;
    canSeeAll: boolean;
  }>({ queryKey: ["/api/me/commands"], enabled: !preview });

  const switchGroupMutation = useMutation({
    mutationFn: (commandId: number | "all") =>
      apiRequest("PATCH", "/api/me/active-command", { commandId }),
    onSuccess: () => {
      setSelectedFacility("all");
      localStorage.setItem(OPS_FACILITY_STORAGE_KEY, "all");
      queryClient.invalidateQueries({ queryKey: ["/api/me/commands"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trackers"] });
    },
  });

  const activeCommandId = commandsData?.activeCommandId ?? null;
  const accessibleCommandIds = useMemo(
    () => commandsData?.commands.map((c) => c.id) ?? [],
    [commandsData],
  );

  const groupLocations = useMemo(() => {
    if (activeCommandId === "all" || activeCommandId == null) return locations;
    return locations.filter((l) => l.commandId === activeCommandId || l.commandId == null);
  }, [locations, activeCommandId]);

  const selectedLocationId = selectedFacility === "all" ? null : Number(selectedFacility);
  const selectedLocation = useMemo(
    () => (selectedLocationId != null ? groupLocations.find((l) => l.id === selectedLocationId) : undefined),
    [groupLocations, selectedLocationId],
  );

  const handleFacilityChange = (value: string) => {
    setSelectedFacility(value);
    localStorage.setItem(OPS_FACILITY_STORAGE_KEY, value);
  };

  useEffect(() => {
    if (selectedFacility === "all") return;
    const id = Number(selectedFacility);
    if (!Number.isFinite(id) || !groupLocations.some((l) => l.id === id)) {
      setSelectedFacility("all");
      localStorage.setItem(OPS_FACILITY_STORAGE_KEY, "all");
    }
  }, [groupLocations, selectedFacility]);

  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    setLastRefresh(new Date());
  }, [liveIncidents, panicAlerts, dayDashboard, allIncidents]);

  const groupLabel = useMemo(() => {
    if (preview) return preview.groupName ?? t.allGroups;
    if (!commandsData) return "—";
    if (commandsData.activeCommandId === "all") return t.allGroups;
    const cmd = commandsData.commands.find((c) => c.id === commandsData.activeCommandId);
    return cmd ? `${cmd.name}${cmd.isCentral ? t.central : ""}` : "—";
  }, [commandsData, preview, t]);

  const visiblePanics = panicAlerts.filter(
    (a) => !dismissedPanicIds.has(a.id) && !a.panicClosedAt && !ackedIds.includes(a.id),
  );
  const kpiSource = dayDashboard ?? dashboardData;
  const kpiLoading = dayLoading || dashboardLoading;

  const todayIncidents = useMemo(() => {
    return allIncidents
      .filter((inc) => inc.incidentDate === todayStr)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [allIncidents, todayStr]);

  // Count panic-origin incidents logged today (includes closed/reclassified e.g. Fire after panic).
  // Do not use /api/panic/recent — that endpoint only returns the last 30 minutes for live banners.
  const panicsToday = useMemo(
    () => todayIncidents.filter(isPanicOriginated).length,
    [todayIncidents],
  );

  const dashboardLive = liveIncidents.filter(
    (inc) => !closedIds.includes(inc.id) && !ackedIds.includes(inc.id),
  );
  const liveCount = dashboardLive.length;
  const hasRedLive = dashboardLive.some((i) => i.severity === "red");
  const hasActive = liveCount > 0 || visiblePanics.length > 0;
  const isCritical = visiblePanics.length > 0 || hasRedLive;

  const todayClosed = useMemo(
    () => todayIncidents.filter((inc) => !inc.isLive),
    [todayIncidents],
  );

  const statusTone = isCritical ? "critical" : hasActive ? "active" : "calm";

  const queueItems = useMemo(() => {
    const sorted = [...liveIncidents].sort((a, b) => {
      const aPanic = (a.categoryName ?? "").toLowerCase().includes("panic") ? 1 : 0;
      const bPanic = (b.categoryName ?? "").toLowerCase().includes("panic") ? 1 : 0;
      if (aPanic !== bPanic) return bPanic - aPanic;
      const sev = { red: 3, orange: 2, yellow: 1, none: 0 };
      const as = sev[(a.severity ?? "none") as keyof typeof sev] ?? 0;
      const bs = sev[(b.severity ?? "none") as keyof typeof sev] ?? 0;
      return bs - as;
    });
    return sorted;
  }, [liveIncidents]);

  const alertCounts = useMemo(() => {
    const counts: Record<AlertKind, number> = { fire: 0, panic: 0, crime: 0, livestock: 0 };
    for (const inc of queueItems) {
      if (closedIds.includes(inc.id) || ackedIds.includes(inc.id)) continue;
      const kind = alertKindOf(inc.categoryName);
      if (kind) counts[kind] += 1;
    }
    return counts;
  }, [queueItems, closedIds, ackedIds]);
  const visibleQueue = useMemo(
    () => (mapAlert ? queueItems.filter((inc) => alertKindOf(inc.categoryName) === mapAlert) : queueItems)
      .filter((inc) => !closedIds.includes(inc.id) && !ackedIds.includes(inc.id)),
    [queueItems, mapAlert, closedIds, ackedIds],
  );
  const showQueue = visibleQueue.length > 0;
  const alertFilters: Array<{ kind: AlertKind; label: string; icon: LucideIcon; hot: string; glow: string }> = [
    { kind: "panic", label: t.alertPanic, icon: Siren, hot: "bg-red-600 text-white", glow: "rgba(220, 38, 38, 0.7)" },
    { kind: "fire", label: t.alertFire, icon: Flame, hot: "bg-orange-600 text-white", glow: "rgba(234, 88, 12, 0.72)" },
    { kind: "crime", label: t.alertCrime, icon: ShieldAlert, hot: "bg-zinc-100 text-zinc-900", glow: "rgba(63, 63, 70, 0.45)" },
    { kind: "livestock", label: t.alertLivestock, icon: PawPrint, hot: "bg-amber-700 text-white", glow: "rgba(180, 83, 9, 0.68)" },
  ];

  const teamUsers = kpiSource?.users ?? [];
  const commandScopedTeam = useMemo(
    () => filterTeamForCommand(teamUsers, commandAssignments, activeCommandId, accessibleCommandIds),
    [teamUsers, commandAssignments, activeCommandId, accessibleCommandIds],
  );
  const siteTeam = useMemo(
    () =>
      preview
        ? preview.users
        : filterTeamForFacility(commandScopedTeam, locationAssignments, selectedLocationId),
    [preview, commandScopedTeam, locationAssignments, selectedLocationId],
  );
  const siteTeamOrdered = useMemo(
    () => [...siteTeam].sort(compareTeamPresence),
    // Re-sort as the clock crosses the "on the system" window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [siteTeam, Math.floor(clock.getTime() / 30_000)],
  );
  const siteFleet = useMemo(
    () =>
      preview
        ? preview.trackers
        : filterTrackersForFacility(trackers, locationAssignments, selectedLocation, selectedLocationId),
    [preview, trackers, locationAssignments, selectedLocation, selectedLocationId],
  );
  const fleetStatusCounts = useMemo(() => {
    const counts = { moving: 0, idle: 0, offline: 0 };
    for (const device of siteFleet) {
      counts[getVehicleMotionStatus(device.lastSeenAt, device.lastSpeedKph)] += 1;
    }
    return counts;
  }, [siteFleet]);
  const siteMonitorLoading = preview
    ? false
    : kpiLoading || trackersLoading || assignmentsLoading || commandAssignmentsLoading;
  const mapFocusUser = useMemo(
    () => siteTeam.find((u) => u.id === mapFocusUserId) ?? null,
    [siteTeam, mapFocusUserId],
  );

  function updateTeamStripScroll() {
    const el = teamStripRef.current;
    if (!el) return;
    setTeamCanScrollLeft(el.scrollLeft > 4);
    setTeamCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }

  function scrollTeamStrip(direction: -1 | 1) {
    teamStripRef.current?.scrollBy({ left: direction * 240, behavior: "smooth" });
  }

  useEffect(() => {
    updateTeamStripScroll();
    const el = teamStripRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => updateTeamStripScroll());
    observer.observe(el);
    return () => observer.disconnect();
  }, [siteTeam.length]);

  function showEveryoneOnMap() {
    setShowAllMembers((current) => !current);
    setMapFocusUserId(null);
    setHighlightId(null);
    setSelectedTeamMember(null);
  }

  function focusTeamMemberOnMap(user: DashboardUserSummary) {
    setShowAllMembers(false);
    if (user.isLive && user.liveIncidentId != null) {
      setMapFocusUserId(null);
      setHighlightId(user.liveIncidentId);
      setSelectedTeamMember(null);
      return;
    }
    if (user.lastLat != null && user.lastLng != null) {
      setHighlightId(null);
      setMapFocusUserId(user.id);
      setSelectedTeamMember(null);
      return;
    }
    toast({
      title: t.noGpsYet,
      description: t.noGpsDescription(user.firstName),
    });
    setSelectedTeamMember(user);
  }

  async function wakeMember(user: DashboardUserSummary) {
    const name = `${user.firstName} ${user.lastName}`.trim();
    if (preview) {
      toast({ title: t.wakePreview });
      return;
    }
    try {
      const res = await apiRequest("POST", "/api/team/wake", { userId: user.id });
      const data = await res.json() as { ok?: boolean; reason?: string };
      if (data.ok) {
        setWakeUntil((current) => ({ ...current, [user.id]: Date.now() + WAKE_COOLDOWN_MS }));
        toast({ title: t.wakeSent(name) });
        return;
      }
      toast({
        title: data.reason === "no_device" ? t.wakeNoDevice(name) : t.wakeFailed,
        variant: "destructive",
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "";
      toast({
        title: message.startsWith("429") ? t.wakeCooldown : t.wakeFailed,
        variant: "destructive",
      });
    }
  }

  function incidentIsAcknowledged(inc: LiveQueueItem): boolean {
    return ackedIds.includes(inc.id);
  }

  async function acknowledgeIncident(inc: LiveQueueItem) {
    if (incidentIsAcknowledged(inc) || rowBusyId === inc.id) return;
    const remember = (id: number) => {
      setAckedIds((ids) => {
        const next = ids.includes(id) ? ids : [...ids, id];
        try { localStorage.setItem("omt-dashboard-acked", JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    };
    if (preview) {
      remember(inc.id);
      toast({ title: t.incidentAcknowledged });
      return;
    }
    setRowBusyId(inc.id);
    try {
      if (alertKindOf(inc.categoryName) === "panic") {
        if (!inc.panicAcknowledgedAt) {
          await apiRequest("POST", `/api/incidents/${inc.id}/acknowledge-panic`, {});
        }
      } else {
        await apiRequest("POST", `/api/incidents/${inc.id}/add-note`, { note: t.incidentAcknowledged });
      }
      remember(inc.id);
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      toast({ title: t.incidentAcknowledged });
    } catch {
      toast({ title: t.incidentActionFailed, variant: "destructive" });
    } finally {
      setRowBusyId(null);
    }
  }

  async function closeIncident(inc: LiveQueueItem) {
    const report = closeReport.trim();
    if (!report || rowBusyId === inc.id) return;
    if (preview) {
      setClosedIds((ids) => [...ids, inc.id]);
      setCloseTarget(null);
      setCloseReport("");
      if (highlightId === inc.id) setHighlightId(null);
      toast({ title: t.incidentClosed });
      return;
    }
    setRowBusyId(inc.id);
    try {
      await apiRequest("POST", `/api/incidents/${inc.id}/add-note`, {
        note: `${t.closeReportNote}: ${report}`,
      });
      await apiRequest("POST", `/api/incidents/${inc.id}/end-live`, {});
      setClosedIds((ids) => [...ids, inc.id]);
      setCloseTarget(null);
      setCloseReport("");
      if (highlightId === inc.id) setHighlightId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      toast({ title: t.incidentClosed });
    } catch {
      toast({ title: t.incidentActionFailed, variant: "destructive" });
    } finally {
      setRowBusyId(null);
    }
  }
  const showGroupSelector =
    !!commandsData && (commandsData.canSeeAll || commandsData.commands.length > 1);
  const activeGroupValue =
    activeCommandId === "all"
      ? "all"
      : activeCommandId == null
        ? ""
        : String(activeCommandId);

  const groupSiteSelectors = (
    <div className="flex flex-wrap items-center gap-2 justify-end">
      {showGroupSelector && (
        <Select
          value={activeGroupValue}
          onValueChange={(v) => switchGroupMutation.mutate(v === "all" ? "all" : Number(v))}
          disabled={switchGroupMutation.isPending}
        >
          <SelectTrigger
            className="w-[min(200px,38vw)] h-8 text-[11px] bg-slate-900/80 border-slate-500/50 text-slate-100"
            data-testid="ops-group-select"
          >
            <div className="flex items-center gap-1.5 truncate">
              <Network className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <SelectValue placeholder={t.selectGroup} />
            </div>
          </SelectTrigger>
          <SelectContent>
            {commandsData?.canSeeAll && <SelectItem value="all">{t.allGroups}</SelectItem>}
            {commandsData?.commands.map((cmd) => (
              <SelectItem key={cmd.id} value={String(cmd.id)}>
                {cmd.name}
                {cmd.isCentral ? t.central : ""}
                {cmd.readOnly ? t.readOnly : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {groupLocations.length > 0 && (
        <Select value={selectedFacility} onValueChange={handleFacilityChange}>
          <SelectTrigger
            className="w-[min(180px,34vw)] h-8 text-[11px] bg-slate-900/80 border-slate-500/50 text-slate-100"
            data-testid="ops-facility-select"
          >
            <div className="flex items-center gap-1.5 truncate">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-slate-400" />
              <SelectValue placeholder={t.allSites} />
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.allSites}</SelectItem>
            {groupLocations.map((loc) => (
              <SelectItem key={loc.id} value={String(loc.id)}>
                {loc.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );

  return (
    <>
    <div
      className={cn(
        "flex flex-col h-full min-h-0 overflow-y-auto overscroll-y-contain ops-scroll xl:overflow-hidden bg-[#0f1419] text-slate-100",
        light && "ops-light",
      )}
      data-testid="operations-dashboard"
    >
      {/* ── Top status bar ── */}
      <div
        className={cn(
          "shrink-0 px-4 py-2 border-b flex flex-wrap items-center gap-x-4 gap-y-2",
          statusTone === "critical" && "bg-red-950/95 border-red-900/70",
          statusTone === "active" && "bg-amber-950/85 border-amber-900/50",
          statusTone === "calm" && "bg-[#0d2818] border-emerald-900/40",
        )}
        data-testid="ops-status-bar"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          {statusTone === "calm" ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-400/90 shrink-0" />
          ) : (
            <span className="relative flex h-3 w-3 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-70" />
              <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
            </span>
          )}
          <p
            className={cn(
              "text-sm sm:text-[15px] tracking-wide",
              statusTone === "calm"
                ? "font-semibold text-emerald-100/95"
                : "font-bold text-slate-100",
            )}
          >
            {statusTone === "calm"
              ? t.allClearTitle
              : visiblePanics.length > 0
                ? t.activePanics(visiblePanics.length)
                : t.liveIncidentsCount(liveCount)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-400">
          <span className="tabular-nums font-medium" data-testid="ops-clock">
            {clock.toLocaleTimeString(lang === "af" ? "af-ZA" : undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
          <span className="text-slate-500">|</span>
          <span className="font-medium">{groupLabel}</span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400">
            {t.updated} {formatGpsAge(lastRefresh.toISOString(), t) ?? t.now}
          </span>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {totalUnread > 0 && (
            <button
              type="button"
              onClick={onOpenChat}
              className="inline-flex items-center gap-1.5 rounded-md bg-slate-800/80 border border-slate-600 px-2.5 py-1 text-xs font-semibold hover:bg-slate-700"
              data-testid="ops-strip-unread-chat"
            >
              <MessageSquare className="h-3.5 w-3.5" />
              {totalUnread}
            </button>
          )}
          <button
            type="button"
            onClick={toggle}
            data-testid="ops-lang-toggle"
            className="inline-flex h-8 items-center rounded-lg border border-slate-600 bg-slate-800/80 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-700"
          >
            {t.toggleLabel}
          </button>
          <button
            type="button"
            onClick={() => setTheme(light ? "dark" : "light")}
            data-testid="ops-theme-toggle"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-600 bg-slate-800/80 px-3 text-xs font-semibold text-slate-100 hover:bg-slate-700"
          >
            {light ? <Moon className="h-3.5 w-3.5" /> : <Sun className="h-3.5 w-3.5" />}
            {light ? t.darkBackground : t.whiteBackground}
          </button>
          <button
            type="button"
            onClick={() => setLogIncidentOpen(true)}
            title={t.logIncidentHint}
            data-testid="ops-button-log-incident"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-500"
          >
            <ClipboardList className="h-3.5 w-3.5" />
            {t.logIncident}
          </button>
          <button
            type="button"
            onClick={onPanic}
            data-testid="ops-button-panic"
            className="inline-flex h-8 items-center gap-2 rounded-lg bg-red-600 px-3 text-xs font-bold text-white hover:bg-red-500"
          >
            <Siren className="h-3.5 w-3.5" />
            {t.panicSos}
          </button>
        </div>
      </div>

      {/* ── One line of the day's numbers ── */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-slate-800/80 bg-[#111820] px-4 py-2" data-testid="ops-kpi-line">
        <button type="button" onClick={() => onOpenLiveMonitor()} className="inline-flex items-baseline gap-2" data-testid="ops-kpi-active">
          <span className={cn("text-lg font-semibold tabular-nums", liveCount > 0 ? "text-orange-300" : "text-emerald-300")}>{kpiLoading ? "…" : liveCount}</span>
          <span className="text-xs font-medium text-slate-400">{t.activeIncidents}</span>
        </button>
        <span className="text-slate-600" aria-hidden>·</span>
        <span className="inline-flex items-baseline gap-2" data-testid="ops-kpi-panics">
          <span className={cn("text-lg font-semibold tabular-nums", panicsToday > 0 ? "text-red-300" : "text-slate-100")}>{panicsToday}</span>
          <span className="text-xs font-medium text-slate-400">{t.panicsToday}</span>
        </span>
        <span className="text-slate-600" aria-hidden>·</span>
        <button type="button" onClick={() => onOpenOccurrence()} className="inline-flex items-baseline gap-2" data-testid="ops-kpi-occurrences">
          <span className="text-lg font-semibold tabular-nums text-slate-100">{kpiLoading || incidentsLoading ? "…" : (kpiSource?.totalIncidents ?? todayIncidents.length)}</span>
          <span className="text-xs font-medium text-slate-400">{t.loggedToday}</span>
        </button>
        <span className="text-slate-600" aria-hidden>·</span>
        <button
          type="button"
          onClick={() => onOpenOccurrence(undefined, "day")}
          className="inline-flex items-baseline gap-2"
          data-testid="ops-kpi-closed"
        >
          <span className="text-lg font-semibold tabular-nums text-slate-100">{incidentsLoading ? "…" : todayClosed.length}</span>
          <span className="text-xs font-medium text-slate-400">{t.closedToday}</span>
        </button>
      </div>

      <div
        className="shrink-0 grid grid-cols-2 gap-2 border-b border-slate-800/80 bg-[#111820] px-4 py-2 sm:grid-cols-4"
        data-testid="ops-alert-filters"
      >
        {alertFilters.map((item, index) => {
          const count = alertCounts[item.kind];
          const selected = mapAlert === item.kind;
          const Icon = item.icon;
          return (
            <button
              key={item.kind}
              type="button"
              aria-pressed={selected}
              onClick={() => setMapAlert((current) => (current === item.kind ? null : item.kind))}
              data-testid={`ops-alert-${item.kind}`}
              style={count > 0 ? { ["--ops-alert-glow" as string]: item.glow, ["--ops-alert-delay" as string]: `${index * 220}ms` } : undefined}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition-colors",
                count > 0 || selected ? item.hot : "border-slate-700 bg-slate-800/70 text-slate-300",
                count > 0 && "ops-alert-flash border-transparent",
                selected && "ring-2 ring-white",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="text-lg font-bold tabular-nums leading-none">{count}</span>
              <span className="min-w-0 truncate text-xs font-semibold">{item.label}</span>
            </button>
          );
        })}
      </div>

      {visiblePanics.length > 0 && (
        <div className="shrink-0 px-4 pt-2">
          <PanicBanner
            alerts={panicAlerts}
            currentUserId={currentUser?.id}
            dismissedIds={dismissedPanicIds}
            onDismiss={onDismissPanic}
            testIdSuffix="ops"
          />
        </div>
      )}

      {/* ── Site monitor: people on the map, fleet on its own tab ── */}
      <div
        className="shrink-0 border-b border-slate-800/80 bg-[#111820] flex flex-col min-h-0"
        data-testid="ops-site-monitor"
      >
        <OpsSectionHeader
          title={t.siteMonitor}
          icon={Building2}
          tone="indigo"
          testId="ops-site-monitor-header"
          right={groupSiteSelectors}
        />
        {monitorTab === "team" ? (
          <div className="relative flex items-center">
            {teamCanScrollLeft && (
              <button
                type="button"
                onClick={() => scrollTeamStrip(-1)}
                className="absolute left-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-slate-100 shadow"
                data-testid="ops-team-scroll-left"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
          <div
            ref={teamStripRef}
            onScroll={updateTeamStripScroll}
            className={cn(
              "ops-scroll flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1.5",
              teamCanScrollLeft ? "pl-11" : "pl-3",
              teamCanScrollRight ? "pr-11" : "pr-3",
            )}
            data-testid="ops-team-chips"
          >
            {siteMonitorLoading ? (
              <Skeleton className="h-10 w-40 shrink-0 bg-slate-800" />
            ) : siteTeam.length === 0 ? (
              <p className="py-2 text-xs text-slate-500">
                {selectedLocationId == null ? t.noTeamInGroup : t.noTeamOnSite}
              </p>
            ) : (
              <>
              <button
                type="button"
                onClick={showEveryoneOnMap}
                aria-pressed={showAllMembers}
                data-testid="ops-team-view-all"
                className={cn(
                  "sticky left-0 z-10 flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold",
                  showAllMembers
                    ? "border-emerald-400 bg-emerald-600 text-white"
                    : "border-slate-600 bg-slate-900 text-slate-100",
                )}
              >
                <Users className="h-3 w-3" />
                {t.viewAllMembers}
              </button>
              {siteTeamOrdered.map((user) => {
                const status = teamMemberStatus(user);
                const onSystem = status === "available" || status === "responding";
                const presenceLabel = teamStatusLabel(status, t);
                const lastOnSystem = onSystem ? null : teamLastOnSystemLabel(user, t);
                const initials = `${user.firstName?.charAt(0) ?? ""}${user.lastName?.charAt(0) ?? ""}`.toUpperCase() || "?";
                const showWake = canWakeMember(user, clock.getTime()) && (wakeUntil[user.id] ?? 0) <= clock.getTime();
                const fullName = `${user.firstName} ${user.lastName}`.trim();
                return (
                  <div
                    key={user.id}
                    className={cn(
                      "flex shrink-0 items-center rounded-full border",
                      mapFocusUserId === user.id
                        ? "border-emerald-400 bg-emerald-950/40"
                        : "border-slate-600 bg-slate-800/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => focusTeamMemberOnMap(user)}
                      data-testid={`ops-team-row-${user.id}`}
                      title={teamPresenceLine(user, t)}
                      className="flex items-center gap-1.5 rounded-full py-1 pl-1.5 pr-2 text-left hover:bg-slate-800"
                    >
                      <span className="relative shrink-0">
                        <span
                          className={cn(
                            "flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold tracking-tight text-white",
                            status === "responding"
                              ? "bg-orange-600"
                              : status === "available"
                                ? "bg-emerald-700"
                                : "bg-zinc-800",
                          )}
                        >
                          {initials}
                        </span>
                        <span
                          className="absolute -bottom-0.5 -right-0.5 flex h-2 w-2"
                          aria-hidden
                        >
                          {status === "available" && (
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                          )}
                          <span
                            className={cn(
                              "relative inline-flex h-2 w-2 rounded-full ring-2 ring-white",
                              status === "responding"
                                ? "bg-orange-400"
                                : status === "available"
                                  ? "bg-emerald-400"
                                  : "bg-slate-400",
                            )}
                          />
                        </span>
                      </span>
                      <span className="min-w-0">
                        <span className="block max-w-[8.5rem] truncate text-[11px] font-semibold leading-tight text-slate-100">
                          {user.firstName} {user.lastName}
                        </span>
                        <span
                          className={cn(
                            "block max-w-[8.5rem] truncate text-[10px] font-semibold leading-tight",
                            status === "responding"
                              ? "text-orange-300"
                              : onSystem
                                ? "text-emerald-300"
                                : "text-slate-400",
                          )}
                        >
                          {presenceLabel}
                        </span>
                        {lastOnSystem ? (
                          <span className="block max-w-[8.5rem] truncate text-[9px] font-medium leading-tight text-slate-500">
                            {lastOnSystem}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {showWake && (
                      <button
                        type="button"
                        onClick={() => wakeMember(user)}
                        aria-label={t.wakePerson(fullName)}
                        title={t.wakePerson(fullName)}
                        data-testid={`ops-team-wake-${user.id}`}
                        className="mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200"
                      >
                        <BellRing className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                );
              })}
              </>
            )}
          </div>
            {teamCanScrollRight && (
              <button
                type="button"
                onClick={() => scrollTeamStrip(1)}
                className="absolute right-1 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-slate-600 bg-slate-900 text-slate-100 shadow"
                data-testid="ops-team-scroll-right"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          <div className="flex max-h-[220px] min-h-0 flex-col overflow-hidden bg-[#131a22]">
            <OpsSubSectionHeader
              title={t.fleet}
              icon={Car}
              tone="cyan"
              count={siteFleet.length}
              right={
                onOpenFleet ? (
                  <button
                    type="button"
                    onClick={() => onOpenFleet()}
                    className="text-[10px] font-semibold uppercase tracking-wide text-cyan-400/90 hover:text-cyan-300 hover:underline"
                    data-testid="ops-fleet-view-all"
                  >
                    {t.viewFleet}
                  </button>
                ) : null
              }
            />
            {!siteMonitorLoading && siteFleet.length > 0 && (
              <div className="shrink-0 border-b border-cyan-900/15 px-3 py-2 flex items-center gap-4 text-[11px] font-semibold uppercase tracking-wide">
                <span className="inline-flex items-center gap-1 text-emerald-400/90">
                  <span className="tabular-nums text-emerald-300">{fleetStatusCounts.moving}</span> {t.moving}
                </span>
                <span className="inline-flex items-center gap-1 text-amber-400/90">
                  <span className="tabular-nums text-amber-300">{fleetStatusCounts.idle}</span> {t.idle}
                </span>
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <span className="tabular-nums text-slate-400">{fleetStatusCounts.offline}</span> {t.offline}
                </span>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain ops-scroll">
              {siteMonitorLoading ? (
                <div className="p-2 space-y-2">
                  <Skeleton className="h-8 bg-slate-800" />
                  <Skeleton className="h-8 bg-slate-800" />
                </div>
              ) : siteFleet.length === 0 ? (
                <p className="text-[11px] text-slate-600 text-center py-6 px-3">
                  {selectedLocationId == null
                    ? t.noTrackersInGroup
                    : t.noVehiclesOnSite}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5 p-2">
                  {siteFleet.map((device) => {
                    const motion = getVehicleMotionStatus(device.lastSeenAt, device.lastSpeedKph);
                    const motionCfg = MOTION_STATUS[motion];
                    const speed =
                      device.lastSpeedKph != null ? Math.round(device.lastSpeedKph) : null;
                    const todayKm = preferredTodayDistanceKm(device);
                    const signal = trackerSignalSummary(device);
                    const registration =
                      device.vehicleRegistration?.trim() || `IMEI …${device.imei.slice(-6)}`;
                    const openVehicle = onOpenFleet
                      ? () => onOpenFleet(device.id)
                      : undefined;
                    return (
                      <li key={device.id}>
                        <div
                          className={cn(
                            "flex items-center gap-3 min-w-0 rounded-lg px-3 py-3 border-l-2 border-l-transparent transition-colors",
                            openVehicle
                              ? "bg-slate-800/25 hover:bg-cyan-950/30"
                              : "bg-slate-800/25",
                          )}
                          data-testid={`ops-fleet-row-${device.id}`}
                        >
                          <FleetVehiclePhoto
                            photoUrl={device.vehiclePhotoUrl}
                            size="xs"
                            className="h-10 w-10 border-slate-700/70 bg-slate-800/40"
                          />
                          <button
                            type="button"
                            onClick={openVehicle}
                            disabled={!openVehicle}
                            className={cn(
                              "min-w-0 flex-1 flex items-center gap-2 text-left",
                              openVehicle
                                ? "cursor-pointer focus-visible:outline-none"
                                : "cursor-default",
                            )}
                          >
                            <span
                              className={cn("h-2 w-2 shrink-0 rounded-full", motionCfg.dot)}
                              title={motionCfg.label}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <p className="text-sm font-semibold text-slate-100 truncate">
                                  {vehicleDisplayName(device)}
                                </p>
                                <span
                                  className={cn(
                                    "shrink-0 text-[11px] font-bold uppercase tracking-wide",
                                    motion === "moving"
                                      ? "text-emerald-400"
                                      : motion === "idle"
                                        ? "text-amber-400"
                                        : "text-slate-500",
                                  )}
                                >
                                  {motion === "moving" ? t.moving : motion === "idle" ? t.idle : t.offline}
                                </span>
                              </div>
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-slate-400">
                                <span className="truncate max-w-[9rem] uppercase tracking-wide">
                                  {registration}
                                </span>
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-0.5 tabular-nums",
                                    motion === "moving" ? "text-emerald-400/90" : undefined,
                                  )}
                                >
                                  <Gauge className="h-3.5 w-3.5" />
                                  {speed == null ? "—" : `${speed} km/h`}
                                </span>
                                <span className="inline-flex items-center gap-0.5 tabular-nums">
                                  <RouteIcon className="h-3.5 w-3.5" />
                                  {formatMileageKm(todayKm)}
                                </span>
                                {device.lastIgnitionOn != null && (
                                  <span
                                    className={cn(
                                      "inline-flex items-center gap-0.5",
                                      device.lastIgnitionOn ? "text-amber-400/80" : undefined,
                                    )}
                                  >
                                    <KeyRound className="h-3.5 w-3.5" />
                                    {device.lastIgnitionOn ? "ACC" : t.off}
                                  </span>
                                )}
                                {device.lastBatteryPercent != null && (
                                  <FleetBatteryMeter percent={device.lastBatteryPercent} size="sm" />
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 w-[108px] text-right">
                              {signal.heartbeatOnly ? (
                                <>
                                  <p
                                    className={cn(
                                      "text-xs tabular-nums leading-tight",
                                      signal.gpsTier
                                        ? freshnessClassDark(signal.gpsTier)
                                        : "text-slate-500",
                                    )}
                                  >
                                    {t.gps} {formatSignalAge(device.lastPositionAt, t)}
                                  </p>
                                  <p className="text-[11px] text-slate-500 mt-1 leading-none">
                                    {t.signal} {formatSignalAge(device.lastSeenAt, t)}
                                  </p>
                                </>
                              ) : (
                                <p
                                  className={cn(
                                    "text-xs tabular-nums leading-tight inline-flex items-center justify-end gap-1",
                                    freshnessClassDark(signal.signalTier),
                                  )}
                                >
                                  <Signal className="h-3.5 w-3.5 opacity-70" />
                                  {formatSignalAge(device.lastSeenAt, t)}
                                </p>
                              )}
                              {device.assignedUserName && (
                                <p className="mt-1 truncate text-[11px] text-slate-400 inline-flex items-center justify-end gap-1 max-w-full">
                                  <UserRound className="h-3.5 w-3.5 shrink-0" />
                                  <span className="truncate">{device.assignedUserName}</span>
                                </p>
                              )}
                            </div>
                            {openVehicle && (
                              <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
                            )}
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Map, with the open incidents underneath ── */}
      <div className="flex flex-none xl:flex-1 xl:min-h-0 flex-col xl:overflow-hidden gap-px bg-slate-800/40">
        <div
          className={cn(
            "flex-none min-h-[min(420px,52dvh)] xl:min-h-0 min-w-0 flex flex-col bg-[#131a22] xl:flex-1",
          )}
          data-testid="ops-live-panel"
        >
          <OpsSectionHeader
            title={mapAlert ? alertFilters.find((item) => item.kind === mapAlert)?.label ?? t.liveIncidents : t.liveIncidents}
            icon={Radio}
            tone="orange"
            testId="ops-live-panel-header"
            right={
              <span className="text-[11px] font-bold text-orange-200 tabular-nums shrink-0">
                {t.activeCount(visibleQueue.length)}
              </span>
            }
          />
          <div
            className="relative flex-1 min-h-[180px] xl:min-h-[220px] bg-[#0a0e14]"
            data-testid="ops-live-overview-map"
          >
            <ControlRoomMap
              compact
              darkTheme={!light}
              showSidePanels={false}
              showSatelliteControl
              mapType={liveMapType}
              onMapTypeChange={setLiveMapType}
              incidents={visibleQueue}
              locations={
                selectedLocationId != null
                  ? groupLocations.filter((l) => l.id === selectedLocationId)
                  : groupLocations
              }
              highlightId={highlightId}
              highlightUserId={showAllMembers ? null : mapFocusUserId}
              focusUser={showAllMembers ? null : mapFocusUser}
              showAllMembers={showAllMembers}
              memberRoster={siteTeam}
              onHighlightId={setHighlightId}
              onOpenLiveMonitor={onOpenLiveMonitor}
              onIncidentMarkerClick={(id) => {
                setMapFocusUserId(null);
                setHighlightId(id);
                onOpenLiveMonitor(id);
              }}
              className="absolute inset-0"
              testId="ops-live-overview-map-canvas"
            />
          </div>
          {(showQueue || mapAlert != null) && (
          <div className="shrink-0 border-t border-slate-800/80 bg-[#131a22]">
            {!showQueue ? (
              <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                <div className="min-w-0 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500/90" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-200">
                      {mapAlert ? t.alertNone(alertFilters.find((item) => item.kind === mapAlert)?.label ?? t.incident) : t.allClear}
                    </p>
                    <p className="text-[10px] text-slate-500 truncate">
                      {t.mapHint}
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 shrink-0 text-xs gap-1 bg-slate-800 border-slate-600"
                  onClick={() => onOpenLiveMonitor()}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {t.liveMonitor}
                </Button>
              </div>
            ) : (
                <ul className="max-h-[240px] overflow-y-auto ops-scroll">
                  {visibleQueue.map((inc) => {
                    const locText =
                      inc.destinationName ||
                      inc.locationName ||
                      (inc.locationId ? locations.find((l) => l.id === inc.locationId)?.name : null) ||
                      t.locationPending;
                    const starterName = formatStarterName(inc);
                    const kind = alertKindOf(inc.categoryName);
                    const Icon = alertFilters.find((item) => item.kind === kind)?.icon ?? Radio;
                    const arrivedCount = (inc.responders ?? []).filter((r) => r.userId !== inc.userId && r.arrivedAt).length;
                    const enRouteCount = (inc.responders ?? []).filter((r) => r.userId !== inc.userId && !r.arrivedAt).length;
                    const gpsAge = formatGpsAge(inc.responderPositionUpdatedAt, t);
                    const gpsSecs = inc.responderPositionUpdatedAt
                      ? Math.max(0, Math.round((Date.now() - new Date(inc.responderPositionUpdatedAt).getTime()) / 1000))
                      : null;
                    const openedAt = inc.liveStartedAt
                      ? new Date(inc.liveStartedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
                      : "—";
                    const openedAge = formatGpsAge(inc.liveStartedAt, t);
                    const coordinates = formatMapCoordinates(
                      inc.responderLat ?? inc.latitude,
                      inc.responderLng ?? inc.longitude,
                    );
                    const severityLabel =
                      inc.severity === "red" ? t.severityRed
                      : inc.severity === "orange" ? t.severityOrange
                      : inc.severity === "yellow" ? t.severityYellow
                      : null;
                    const responseLabel = inc.responderArrivedAt || arrivedCount > 0
                      ? t.onScene
                      : enRouteCount > 0
                        ? t.respondersEnRoute(enRouteCount)
                        : t.awaitingResponse;
                    const isHighlighted = highlightId === inc.id;
                    const accent =
                      kind === "panic" || inc.severity === "red" ? "border-l-red-600"
                      : kind === "fire" || inc.severity === "orange" ? "border-l-orange-600"
                      : kind === "livestock" || inc.severity === "yellow" ? "border-l-amber-500"
                      : "border-l-zinc-500";

                    return (
                      <li key={inc.id} className="border-b border-slate-800/80">
                        <div className={cn("flex items-stretch border-l-[3px]", accent, isHighlighted && "bg-slate-700/40")}>
                          <button
                            type="button"
                            onClick={() => {
                              setHighlightId(inc.id);
                              onOpenLiveMonitor(inc.id);
                            }}
                            className="grid min-w-0 flex-1 grid-cols-1 items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-slate-800/40 sm:grid-cols-[auto_minmax(0,1.2fr)_minmax(0,1fr)_auto] sm:gap-4"
                            data-testid={`ops-queue-row-${inc.id}`}
                          >
                            <span className={cn("flex h-10 w-10 items-center justify-center rounded-lg", alertChipClass(kind))}>
                              <Icon className="h-5 w-5" />
                            </span>
                            <span className="min-w-0">
                              <span className="flex items-center gap-2">
                                <span className="truncate text-sm font-semibold text-slate-100">
                                  {inc.categoryName ?? t.incident}
                                </span>
                                {severityLabel && (
                                  <span className={cn("shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide", severityPillClass(inc.severity))}>
                                    {severityLabel}
                                  </span>
                                )}
                                {inc.isEscalated && (
                                  <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                                    {t.escalated}
                                  </span>
                                )}
                              </span>
                              <span className="mt-0.5 block truncate text-xs font-medium text-slate-300">
                                {starterName ?? t.unknownReporter}
                              </span>
                              <span className="mt-0.5 block text-[11px] font-semibold tabular-nums text-slate-400">
                                #{inc.id}
                              </span>
                            </span>
                            <span className="min-w-0 space-y-0.5">
                              <span className="flex items-center gap-1.5 truncate text-xs text-slate-200">
                                <MapPin className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                <span className="truncate">{locText}</span>
                              </span>
                              <span className="flex items-center gap-1.5 truncate font-mono text-[11px] text-slate-400">
                                <Crosshair className="h-3.5 w-3.5 shrink-0" />
                                <span className="truncate">{coordinates ?? t.locationPending}</span>
                              </span>
                            </span>
                            <span className="flex items-center gap-3 sm:justify-end">
                              <span className="min-w-0 space-y-0.5 sm:text-right">
                                <span className="flex items-center gap-1.5 text-[11px] text-slate-300 sm:justify-end">
                                  <Clock className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                                  <span className="font-semibold text-slate-100">{t.openFor}</span>
                                  <span className="tabular-nums">{openedAt !== "—" ? openedAt : ""}</span>
                                  {openedAge && <span className="text-slate-400">{openedAge}</span>}
                                </span>
                                <span className={cn(
                                  "block text-[11px] tabular-nums",
                                  gpsSecs == null ? "text-slate-400" : gpsSecs > 120 ? "text-amber-700" : "text-emerald-700",
                                )}>
                                  {t.gps} {gpsAge ?? t.noGpsYet}
                                </span>
                                <span className={cn(
                                  "flex items-center gap-1 text-[11px] font-semibold sm:justify-end",
                                  inc.responderArrivedAt || arrivedCount > 0 || enRouteCount > 0 ? "text-emerald-700" : "text-amber-700",
                                )}>
                                  <Users className="h-3.5 w-3.5 shrink-0" />
                                  {responseLabel}
                                </span>
                              </span>
                              <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                            </span>
                          </button>
                          <div className="flex shrink-0 flex-col justify-center gap-1.5 px-2 py-2">
                            {incidentIsAcknowledged(inc) ? (
                              <span className="inline-flex h-8 items-center justify-center gap-1 rounded-md bg-emerald-700 px-2.5 text-xs font-semibold text-white">
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {t.acknowledged}
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => acknowledgeIncident(inc)}
                                disabled={rowBusyId === inc.id}
                                className="h-8 rounded-md bg-emerald-700 px-2.5 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-60"
                                data-testid={`ops-queue-ack-${inc.id}`}
                              >
                                {t.acknowledge}
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => { setCloseReport(""); setCloseTarget(inc); }}
                              disabled={rowBusyId === inc.id}
                              className="h-8 rounded-md bg-red-600 px-2.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-60"
                              data-testid={`ops-queue-close-${inc.id}`}
                            >
                              {t.closeIncident}
                            </button>
                          </div>
                          <button
                            type="button"
                            title={t.attachments}
                            aria-label={t.viewAttachments(inc.categoryName ?? t.incident)}
                            className="shrink-0 px-3 text-slate-500 hover:bg-slate-800/70 hover:text-slate-200"
                            onClick={() =>
                              setAttachmentsPreview({
                                id: inc.id,
                                subject: inc.categoryName ?? t.incident,
                              })
                            }
                            data-testid={`ops-queue-attachments-${inc.id}`}
                          >
                            <Paperclip className="h-4 w-4" />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
            )}
          </div>
          )}
        </div>
      </div>
    </div>

      <Dialog
        open={closeTarget != null}
        onOpenChange={(open) => {
          if (!open && rowBusyId == null) {
            setCloseTarget(null);
            setCloseReport("");
          }
        }}
      >
        <DialogContent className="border-slate-200 bg-white text-slate-900 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t.closeIncidentTitle}</DialogTitle>
            <DialogDescription className="text-slate-600">
              {closeTarget ? `${closeTarget.categoryName ?? t.incident} #${closeTarget.id}. ` : ""}
              {t.closeIncidentBody}
            </DialogDescription>
          </DialogHeader>
          <label className="block space-y-1.5 text-sm font-semibold text-slate-900">
            {t.closeReportLabel}
            <Textarea
              value={closeReport}
              onChange={(e) => setCloseReport(e.target.value)}
              placeholder={t.closeReportPlaceholder}
              rows={5}
              autoFocus
              disabled={rowBusyId != null}
              className="mt-1.5 border-slate-300 bg-white text-base font-normal text-slate-900 placeholder:text-slate-400"
              data-testid="ops-close-report"
            />
          </label>
          <DialogFooter>
            <button
              type="button"
              className="h-9 rounded-md border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-800"
              disabled={rowBusyId != null}
              onClick={() => { setCloseTarget(null); setCloseReport(""); }}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              className="h-9 rounded-md bg-red-600 px-3 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
              disabled={!closeReport.trim() || rowBusyId != null}
              data-testid="ops-close-confirm"
              onClick={() => { if (closeTarget) void closeIncident(closeTarget); }}
            >
              {t.closeIncident}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Sheet
        open={!!selectedTeamMember}
        onOpenChange={(open) => {
          if (!open) setSelectedTeamMember(null);
        }}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-md border-slate-800 bg-[#111820] text-slate-100"
          data-testid="ops-team-member-sheet"
        >
          {selectedTeamMember ? (
            <>
              <SheetHeader className="text-left space-y-1">
                <div className="flex items-center gap-3 pr-8">
                  <ExpandablePhoto
                    photoUrl={selectedTeamMember.avatarUrl}
                    className="h-12 w-12 rounded-full ring-1 ring-slate-700"
                    title={`${selectedTeamMember.firstName} ${selectedTeamMember.lastName}`}
                    fallback={
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-sm font-semibold text-slate-200 ring-1 ring-slate-700">
                        {`${selectedTeamMember.firstName?.charAt(0) ?? ""}${selectedTeamMember.lastName?.charAt(0) ?? ""}`.toUpperCase() || "?"}
                      </div>
                    }
                  />
                  <div className="min-w-0">
                    <SheetTitle className="text-slate-50">
                      {selectedTeamMember.firstName} {selectedTeamMember.lastName}
                    </SheetTitle>
                    <SheetDescription className="text-slate-400">
                      {t.role(selectedTeamMember.role)}
                      {" · "}
                      <span
                        className={cn(
                          "font-semibold",
                          teamMemberStatus(selectedTeamMember) === "responding"
                            ? "text-orange-300"
                            : teamMemberStatus(selectedTeamMember) === "available"
                              ? "text-emerald-300"
                              : "text-slate-400",
                        )}
                      >
                        {teamStatusLabel(teamMemberStatus(selectedTeamMember), t)}
                      </span>
                    </SheetDescription>
                  </div>
                </div>
              </SheetHeader>

              <div className="mt-5 space-y-4">
                <div className="rounded-lg border border-slate-700/70 bg-slate-900/50 px-3 py-2.5 space-y-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    {t.lastActivity}
                  </p>
                  <p className="text-sm text-slate-200">
                    {formatTeamLastActivity(
                      selectedTeamMember.lastSeenAt
                        && Number.isFinite(new Date(selectedTeamMember.lastSeenAt).getTime())
                        ? new Date(selectedTeamMember.lastSeenAt)
                        : null,
                      t,
                    )}
                  </p>
                </div>

                {selectedTeamMember.lastLat != null && selectedTeamMember.lastLng != null ? (
                  <>
                    <div className="rounded-lg border border-slate-700/70 bg-slate-900/50 px-3 py-2.5 space-y-1.5">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                        {t.lastLocation}
                      </p>
                      <p className="text-sm font-mono text-slate-100 tabular-nums">
                        {formatCoords(selectedTeamMember.lastLat, selectedTeamMember.lastLng)}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatTeamPositionAt(
                          selectedTeamMember.lastPositionAt ?? selectedTeamMember.lastSeenAt,
                          t,
                        )}
                      </p>
                    </div>

                    <div className="overflow-hidden rounded-lg border border-slate-700/70">
                      <GeoMapPreview
                        lat={selectedTeamMember.lastLat}
                        lng={selectedTeamMember.lastLng}
                        label={`${selectedTeamMember.firstName} ${selectedTeamMember.lastName}`}
                        open={!!selectedTeamMember}
                        className="min-h-[240px] rounded-none border-0 bg-slate-900"
                        testId="ops-team-member-map"
                      />
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="gap-1.5"
                        onClick={() => {
                          window.open(
                            mapsUrl(selectedTeamMember.lastLat!, selectedTeamMember.lastLng!),
                            "_blank",
                            "noopener,noreferrer",
                          );
                        }}
                        data-testid="ops-team-open-maps"
                      >
                        <ExternalLink className="h-4 w-4" />
                        {t.openInMaps}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="border-slate-600 bg-transparent text-slate-200 hover:bg-slate-800"
                        onClick={async () => {
                          const text = formatCoords(
                            selectedTeamMember.lastLat!,
                            selectedTeamMember.lastLng!,
                          );
                          try {
                            await navigator.clipboard.writeText(text);
                            toast({ title: t.coordinatesCopied, description: text });
                          } catch {
                            toast({
                              title: t.couldNotCopy,
                              description: text,
                              variant: "destructive",
                            });
                          }
                        }}
                        data-testid="ops-team-copy-coords"
                      >
                        {t.copyCoordinates}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-slate-700/80 bg-slate-900/40 px-3 py-4 text-sm text-slate-400">
                    {t.noGpsForMember}
                  </div>
                )}

                {selectedTeamMember.isLive && selectedTeamMember.liveIncidentId != null ? (
                  <Button
                    type="button"
                    variant="secondary"
                    className="w-full gap-1.5"
                    onClick={() => {
                      const incidentId = selectedTeamMember.liveIncidentId!;
                      setSelectedTeamMember(null);
                      onOpenLiveMonitor(incidentId);
                    }}
                    data-testid="ops-team-open-live"
                  >
                    <Radio className="h-4 w-4" />
                    {t.openLiveIncident}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <IncidentDialog open={logIncidentOpen} onOpenChange={setLogIncidentOpen} />

      {attachmentsPreview !== null && (
        <AttachmentsDialog
          open
          onOpenChange={(open) => {
            if (!open) setAttachmentsPreview(null);
          }}
          incidentId={attachmentsPreview.id}
          title={`${attachmentsPreview.subject} · ${t.attachments}`}
          canAdd={false}
          canDelete={false}
          onOpenRecord={
            attachmentsPreview.bookPeriod
              ? () => {
                  const preview = attachmentsPreview;
                  setAttachmentsPreview(null);
                  onOpenOccurrence(preview.id, preview.bookPeriod);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
