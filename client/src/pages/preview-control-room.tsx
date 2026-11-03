import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import OccurrenceBook from "@/pages/occurrence-book";
import LiveMonitorPage from "@/pages/live-monitor";
import type { IncidentWithMeta } from "@/lib/incident-display";
import type { Category } from "@shared/schema";
import type { LiveIncidentMapItem } from "@/components/live-incidents-map";
import { OperationsDashboard, type DashboardUserSummary, type TrackerDeviceSummary } from "@/components/operations-dashboard";
import { SidebarProvider } from "@/components/ui/sidebar";
import { useControlRoomLang } from "@/hooks/use-control-room-lang";
import { readControlRoomLang } from "@/lib/control-room-i18n";
import { queryClient } from "@/lib/queryClient";

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function member(
  id: string,
  firstName: string,
  lastName: string,
  minutes: number,
  lat: number,
  lng: number,
): DashboardUserSummary {
  return {
    id,
    firstName,
    lastName,
    role: "reporter",
    avatarUrl: null,
    incidentCount: 0,
    isLive: false,
    liveIncidentId: null,
    lastSeenAt: minutesAgo(minutes),
    lastLat: lat,
    lastLng: lng,
    lastPositionAt: minutesAgo(minutes),
  };
}

const users: DashboardUserSummary[] = [
  {
    id: "nico",
    firstName: "Nico",
    lastName: "Venter",
    role: "reporter",
    avatarUrl: null,
    incidentCount: 2,
    isLive: false,
    liveIncidentId: null,
    lastSeenAt: minutesAgo(0.4),
    lastLat: -25.86,
    lastLng: 28.19,
    lastPositionAt: minutesAgo(0.4),
  },
  member("anri", "Anri", "Botha", 1.5, -25.851, 28.201),
  member("pieter", "Pieter", "du Plessis", 12, -25.868, 28.176),
  member("johan", "Johan", "Nel", 18, -25.843, 28.214),
  member("susan", "Susan", "Kruger", 22, -25.872, 28.188),
  member("willem", "Willem", "Pretorius", 40, -25.837, 28.169),
  member("lene", "Lene", "van Wyk", 55, -25.879, 28.207),
  member("kobus", "Kobus", "Steyn", 70, -25.846, 28.163),
  {
    id: "martin",
    firstName: "Martin",
    lastName: "Engels",
    role: "reporter",
    avatarUrl: null,
    incidentCount: 1,
    isLive: false,
    liveIncidentId: null,
    lastSeenAt: minutesAgo(31),
    lastLat: -25.84,
    lastLng: 28.22,
    lastPositionAt: minutesAgo(31),
  },
];

const trackers: TrackerDeviceSummary[] = [
  {
    id: 1,
    imei: "860000000000001",
    label: "Ford Figo",
    vehicleMake: "Ford",
    vehicleModel: "Figo",
    vehicleRegistration: "CT50HGP",
    vehiclePhotoUrl: null,
    assignedUserId: "nico",
    assignedUserName: "Nico Venter",
    notes: null,
    commandId: 1,
    commandName: "Boere Burgersdorp",
    lastLat: -25.86,
    lastLng: 28.19,
    lastSpeedKph: 0,
    lastHeading: 90,
    lastIgnitionOn: false,
    lastMileageKm: 56.2,
    lastBatteryPercent: 82,
    todayOdometerDistanceKm: 56.2,
    todayGpsDistanceKm: 56.2,
    todayDistanceKm: 56.2,
    lastTripDistanceKm: 12,
    lastGpsValid: true,
    lastPositionAt: new Date(Date.now() - 2_000).toISOString(),
    lastSeenAt: new Date(Date.now() - 2_000).toISOString(),
  },
  {
    id: 2,
    imei: "860000000000002",
    label: "Mobile Tracking Device",
    vehicleMake: null,
    vehicleModel: null,
    vehicleRegistration: null,
    vehiclePhotoUrl: null,
    assignedUserId: null,
    assignedUserName: null,
    notes: null,
    commandId: 1,
    commandName: "Boere Burgersdorp",
    lastLat: null,
    lastLng: null,
    lastSpeedKph: 0,
    lastHeading: null,
    lastIgnitionOn: null,
    lastMileageKm: null,
    lastBatteryPercent: 14,
    todayOdometerDistanceKm: null,
    todayGpsDistanceKm: null,
    todayDistanceKm: null,
    lastTripDistanceKm: null,
    lastGpsValid: false,
    lastPositionAt: minutesAgo(21 * 24 * 60),
    lastSeenAt: minutesAgo(21 * 24 * 60),
  },
];

const wagtoringCommands = {
  commands: [{ id: 1, name: "Boere Burgersdorp", isCentral: false }],
  activeCommandId: 1,
  canSeeAll: false,
  otherCommands: [],
};

function sampleIncident(
  id: number,
  categoryName: string,
  lat: number,
  lng: number,
  severity: string,
): LiveIncidentMapItem {
  return {
    id,
    userId: "martin",
    responderLat: lat,
    responderLng: lng,
    latitude: lat,
    longitude: lng,
    destinationLat: lat,
    destinationLng: lng,
    destinationName: "Boere Burgersdorp",
    locationName: "Boere Burgersdorp",
    liveStartedAt: new Date().toISOString(),
    responderFirstName: "Martin",
    responderLastName: "Engels",
    categoryName,
    categoryColor: null,
    severity,
    isEscalated: false,
    responderArrivedAt: null,
    responderPositionUpdatedAt: new Date().toISOString(),
    responders: [],
  };
}

const sampleLive: LiveIncidentMapItem[] = [
  sampleIncident(1, "Vuur", -25.855, 28.185, "orange"),
  sampleIncident(2, "Vuur", -25.862, 28.198, "orange"),
  sampleIncident(3, "Vuur", -25.848, 28.176, "red"),
  sampleIncident(4, "Vuur", -25.871, 28.205, "orange"),
  sampleIncident(5, "Panic", -25.859, 28.191, "red"),
  sampleIncident(6, "Inbraak", -25.866, 28.172, "orange"),
  sampleIncident(7, "Vee en Wilde Diere", -25.844, 28.21, "yellow"),
];

const bookCategories: Category[] = [
  { id: 1, organizationId: "preview", name: "Vuur", description: null, color: "#ea580c", icon: "flame", isOther: false, isSystem: false, severity: "orange", commandId: 1 },
  { id: 2, organizationId: "preview", name: "Panic", description: null, color: "#dc2626", icon: "siren", isOther: false, isSystem: true, severity: "red", commandId: 1 },
  { id: 3, organizationId: "preview", name: "Inbraak", description: null, color: "#52525b", icon: "shield", isOther: false, isSystem: false, severity: "orange", commandId: 1 },
  { id: 4, organizationId: "preview", name: "Vee en Wilde Diere", description: null, color: "#b45309", icon: "paw", isOther: false, isSystem: false, severity: "yellow", commandId: 1 },
];

function bookIncident(item: LiveIncidentMapItem): IncidentWithMeta {
  const now = new Date();
  const categoryId = bookCategories.find((category) => category.name === item.categoryName)?.id ?? null;
  return {
    id: item.id,
    organizationId: "preview",
    userId: item.userId,
    incidentDate: now.toISOString().slice(0, 10),
    incidentTime: now.toTimeString().slice(0, 5),
    locationId: null,
    locationName: item.locationName,
    latitude: item.latitude,
    longitude: item.longitude,
    customMapId: null,
    customMapX: null,
    customMapY: null,
    categoryId,
    otherCategoryNote: null,
    description: item.categoryName,
    customFields: null,
    importBatchId: null,
    isLive: true,
    isEscalated: false,
    liveStartedAt: now,
    responderLat: item.responderLat,
    responderLng: item.responderLng,
    responderPositionUpdatedAt: now,
    responderArrivedAt: null,
    liveStartLat: item.latitude,
    liveStartLng: item.longitude,
    destinationName: item.destinationName,
    destinationLat: item.destinationLat,
    destinationLng: item.destinationLng,
    liveEndedAt: null,
    liveClosedManually: null,
    liveConvertLat: null,
    liveConvertLng: null,
    liveEndLat: null,
    liveEndLng: null,
    severity: item.severity,
    panicAcknowledgedAt: null,
    panicAcknowledgedByUserId: null,
    panicClosedAt: null,
    closedByUserId: null,
    commandId: 1,
    createdAt: now,
    attachmentCount: 0,
    reporterFirstName: "Martin",
    reporterLastName: "Engels",
  };
}

let monitorSeeded = false;
function seedLiveMonitor() {
  if (monitorSeeded) return;
  monitorSeeded = true;
  const now = new Date();
  queryClient.setQueryData(
    ["/api/incidents/live"],
    sampleLive.map((item) => ({
      ...item,
      organizationId: "preview",
      incidentDate: now.toISOString().slice(0, 10),
      incidentTime: now.toTimeString().slice(0, 5),
      locationId: null,
      description: item.categoryName,
      customFields: null,
      importBatchId: null,
      isLive: true,
      createdAt: now.toISOString(),
      ...(item.id === 1
        ? {
            userId: "nico",
            responderFirstName: "Nico",
            responderLastName: "Venter",
            responderLat: null,
            responderLng: null,
            responderPositionUpdatedAt: null,
            ownerLastLat: -30.741,
            ownerLastLng: 30.453,
            ownerLastPositionAt: minutesAgo(8),
          }
        : {}),
      responders: item.id === 1
        ? [{
            id: 101,
            userId: "mo-steyn",
            firstName: "Mo",
            lastName: "Steyn",
            lastLat: -29.8587,
            lastLng: 31.0218,
            lastPositionAt: minutesAgo(2),
            joinedAt: minutesAgo(15),
            arrivedAt: null,
            arrivalNote: null,
            destinationLat: null,
            destinationLng: null,
            destinationName: null,
          }]
        : (item.responders ?? []),
      panicAcknowledgedAt: null,
    })),
  );
  queryClient.setQueryData(["/api/locations"], []);
  queryClient.setQueryData(["/api/auth/me"], {
    id: "nico",
    role: "administrator",
    firstName: "Nico",
    lastName: "Venter",
    email: "nico@example.com",
  });
}

let bookSeeded = false;
function seedOccurrenceBook() {
  if (bookSeeded) return;
  bookSeeded = true;
  const rows = sampleLive.map(bookIncident);
  queryClient.setQueryData(["/api/incidents"], rows);
  queryClient.setQueryData(["/api/categories"], bookCategories);
  queryClient.setQueryData(["/api/locations"], []);
  queryClient.setQueryData(["/api/custom-maps"], []);
  queryClient.setQueryData(["/api/form-fields"], []);
  queryClient.setQueryData(["/api/panic/recent"], []);
  queryClient.setQueryData(["/api/chat/conversations"], []);
  queryClient.setQueryData(["/api/incidents/live"], sampleLive);
  queryClient.setQueryData(["/api/auth/me"], {
    id: "nico",
    role: "administrator",
    firstName: "Nico",
    lastName: "Venter",
    email: "nico@example.com",
    canEditIncidents: true,
    canManageAttachments: true,
    canDeleteIncidents: true,
  });
}

/** Dev-only look at the Wagtoring control room. */
export default function PreviewControlRoom({ page = "dashboard" }: { page?: "dashboard" | "book" | "monitor" }) {
  const { setLang } = useControlRoomLang();
  queryClient.setQueryData(["/api/me/commands"], wagtoringCommands);
  if (page === "book") seedOccurrenceBook();
  if (page === "monitor") seedLiveMonitor();
  useEffect(() => {
    const previous = readControlRoomLang();
    setLang("af");
    return () => setLang(previous);
    // Show the Afrikaans Wagtoring name for this preview only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  return (
    <SidebarProvider style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" } as React.CSSProperties}>
    <div className="flex h-screen w-full bg-[#0f1419]">
      <AppSidebar
        preview
        user={{ id: "nico", firstName: "Nico", lastName: "Venter", email: "nico@example.com", role: "administrator" }}
        onLogout={() => {}}
      />
      <div className="min-w-0 flex-1">
      {page === "book" ? <OccurrenceBook /> : page === "monitor" ? <LiveMonitorPage /> : (
      <OperationsDashboard
        currentUser={{ id: "nico", firstName: "Nico", lastName: "Venter", role: "administrator" }}
        liveIncidents={sampleLive}
        panicAlerts={[]}
        dismissedPanicIds={new Set()}
        onDismissPanic={() => {}}
        locations={[]}
        period="day"
        onPeriodChange={() => {}}
        dashboardLoading={false}
        totalUnread={0}
        unreadSenders={[]}
        onOpenChat={() => {}}
        onOpenLiveMonitor={(incidentId) => {
          window.location.assign(incidentId != null ? `/preview/live-monitor?incidentId=${incidentId}` : "/preview/live-monitor");
        }}
        onOpenOccurrence={() => { window.location.assign("/preview/occurrence-book"); }}
        onOpenFleet={() => {}}
        onPanic={() => {}}
        preview={{ users, trackers, groupName: "Boere Burgersdorp" }}
      />
      )}
      </div>
    </div>
    </SidebarProvider>
  );
}
