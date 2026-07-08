import type { PremiseMapMarker } from "@/components/live-incidents-map";
import {
  distanceFromPremiseM,
  isWithinPremiseRadius,
  PREMISE_COVERAGE_RADIUS_M,
} from "@shared/premises-geofence";

export type PremiseZonePerson = {
  id: string;
  name: string;
  role?: string;
  allocated: boolean;
  inside: boolean;
  distanceM: number | null;
  kind: "team";
};

export type PremiseZoneVehicle = {
  id: number;
  label: string;
  registration?: string | null;
  inside: boolean;
  distanceM: number | null;
  driverName?: string | null;
};

export type PremiseZoneRoster = {
  allocatedInside: PremiseZonePerson[];
  allocatedOutside: PremiseZonePerson[];
  visitorsInside: PremiseZonePerson[];
  fleetInside: PremiseZoneVehicle[];
  fleetOutside: PremiseZoneVehicle[];
};

type TeamLike = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
  lastLat: number | null;
  lastLng: number | null;
};

type TrackerLike = {
  id: number;
  label: string;
  registration?: string | null;
  lat: number;
  lng: number;
  driverName?: string | null;
};

export function getAllocatedUserIdsForPremise(
  premise: PremiseMapMarker,
  locationAssignments: Array<{ userId: string; locationId: number }>,
  commandAssignments: Array<{ userId: string; commandId: number }>,
): Set<string> {
  const ids = new Set<string>();
  if (premise.locationId != null) {
    for (const a of locationAssignments) {
      if (a.locationId === premise.locationId) ids.add(a.userId);
    }
  }
  if (premise.commandId != null) {
    for (const a of commandAssignments) {
      if (a.commandId === premise.commandId) ids.add(a.userId);
    }
  }
  return ids;
}

export function buildPremiseZoneRoster(
  premise: PremiseMapMarker,
  team: TeamLike[],
  trackers: TrackerLike[],
  locationAssignments: Array<{ userId: string; locationId: number }>,
  commandAssignments: Array<{ userId: string; commandId: number }>,
): PremiseZoneRoster {
  const allocatedIds = getAllocatedUserIdsForPremise(premise, locationAssignments, commandAssignments);
  const allocatedInside: PremiseZonePerson[] = [];
  const allocatedOutside: PremiseZonePerson[] = [];
  const visitorsInside: PremiseZonePerson[] = [];

  for (const user of team) {
    const hasPos = user.lastLat != null && user.lastLng != null;
    const inside = hasPos
      ? isWithinPremiseRadius(user.lastLat!, user.lastLng!, premise.lat, premise.lng)
      : false;
    const distanceM = hasPos
      ? Math.round(distanceFromPremiseM(user.lastLat!, user.lastLng!, premise.lat, premise.lng))
      : null;
    const person: PremiseZonePerson = {
      id: user.id,
      name: `${user.firstName} ${user.lastName}`.trim(),
      role: user.role,
      allocated: allocatedIds.has(user.id),
      inside,
      distanceM,
      kind: "team",
    };
    if (!hasPos) continue;
    if (allocatedIds.has(user.id)) {
      if (inside) allocatedInside.push(person);
      else allocatedOutside.push(person);
    } else if (inside) {
      visitorsInside.push(person);
    }
  }

  const fleetInside: PremiseZoneVehicle[] = [];
  const fleetOutside: PremiseZoneVehicle[] = [];
  for (const tracker of trackers) {
    const inside = isWithinPremiseRadius(tracker.lat, tracker.lng, premise.lat, premise.lng);
    const distanceM = Math.round(distanceFromPremiseM(tracker.lat, tracker.lng, premise.lat, premise.lng));
    const row: PremiseZoneVehicle = {
      id: tracker.id,
      label: tracker.label,
      registration: tracker.registration,
      inside,
      distanceM,
      driverName: tracker.driverName,
    };
    if (inside) fleetInside.push(row);
    else fleetOutside.push(row);
  }

  allocatedInside.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  allocatedOutside.sort((a, b) => (a.distanceM ?? 0) - (b.distanceM ?? 0));
  fleetInside.sort((a, b) => a.distanceM - b.distanceM);

  return {
    allocatedInside,
    allocatedOutside,
    visitorsInside,
    fleetInside,
    fleetOutside,
  };
}

export function formatZoneDistance(distanceM: number | null): string {
  if (distanceM == null) return "No GPS";
  if (distanceM < 1000) return `${distanceM} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

export { PREMISE_COVERAGE_RADIUS_M };
