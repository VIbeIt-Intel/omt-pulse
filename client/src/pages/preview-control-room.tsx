import { useEffect } from "react";
import { AppSidebar } from "@/components/app-sidebar";
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
    lastSeenAt: minutesAgo(9),
    lastLat: -25.86,
    lastLng: 28.19,
    lastPositionAt: minutesAgo(9),
  },
  member("anri", "Anri", "Botha", 4, -25.851, 28.201),
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

/** Dev-only look at the Wagtoring control room. */
export default function PreviewControlRoom() {
  const { setLang } = useControlRoomLang();
  queryClient.setQueryData(["/api/me/commands"], wagtoringCommands);
  useEffect(() => {
    const previous = readControlRoomLang();
    setLang("af");
    return () => setLang(previous);
    // Show the Afrikaans Wagtoring name for this preview only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SidebarProvider style={{ "--sidebar-width": "16rem", "--sidebar-width-icon": "3rem" } as React.CSSProperties}>
    <div className="flex h-screen w-full bg-[#0f1419]">
      <AppSidebar
        user={{ id: "nico", firstName: "Nico", lastName: "Venter", email: "nico@example.com", role: "administrator" }}
        onLogout={() => {}}
      />
      <div className="min-w-0 flex-1">
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
        onOpenLiveMonitor={() => {}}
        onOpenOccurrence={() => {}}
        onOpenFleet={() => {}}
        onPanic={() => {}}
        preview={{ users, trackers, groupName: "Boere Burgersdorp" }}
      />
      </div>
    </div>
    </SidebarProvider>
  );
}
