import type { Incident, Category, Location } from "@shared/schema";

export type IncidentWithMeta = Incident & {
  attachmentCount: number;
  /** Text notes count from /api/incidents — counted as evidence alongside attachments. */
  evidenceNoteCount?: number;
  reporterFirstName?: string | null;
  reporterLastName?: string | null;
  closedByName?: string | null;
};

const PLACEHOLDER_LOCATION_NAMES = new Set([
  "live incident",
  "gps tracking",
  "current location",
]);

function isPlaceholderLocationName(name: string | null | undefined): boolean {
  const trimmed = name?.trim() ?? "";
  if (!trimmed) return true;
  return PLACEHOLDER_LOCATION_NAMES.has(trimmed.toLowerCase());
}

function formatCoordLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function finiteCoords(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) < 0.0001 && Math.abs(ln) < 0.0001) return null;
  return { lat: la, lng: ln };
}

type JoinerNavIncident = Pick<
  Incident,
  | "destinationLat"
  | "destinationLng"
  | "destinationName"
  | "liveStartLat"
  | "liveStartLng"
  | "latitude"
  | "longitude"
> & {
  categoryName?: string | null;
  responderLat?: number | string | null;
  responderLng?: number | string | null;
  responderFirstName?: string | null;
  responderLastName?: string | null;
};

function finiteCoordPair(
  lat: number | string | null | undefined,
  lng: number | string | null | undefined,
): { lat: number; lng: number } | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  return { lat: la, lng: ln };
}

/**
 * Navigation target for a joiner on /live-incident.
 * Uses the creator's saved destination when present; for panic incidents also
 * falls back to the panicker's live GPS / start coords so joiners are not stuck
 * on "waiting for destination" while the live list cache catches up.
 */
export function resolveJoinerNavDestination(
  incident: JoinerNavIncident,
): { lat: number; lng: number; name: string } | null {
  const explicit = finiteCoordPair(incident.destinationLat, incident.destinationLng);
  if (explicit) {
    const name = incident.destinationName?.trim() || "Incident Location";
    return { ...explicit, name };
  }

  const isPanic = (incident.categoryName ?? "").toLowerCase().includes("panic");
  if (!isPanic) return null;

  const panickerName =
    `${incident.responderFirstName ?? ""} ${incident.responderLastName ?? ""}`.trim() || "Panicker";

  const responder = finiteCoordPair(incident.responderLat, incident.responderLng);
  if (responder) {
    return {
      ...responder,
      name: incident.destinationName?.trim() || `🆘 ${panickerName}`,
    };
  }

  const start = finiteCoordPair(incident.liveStartLat, incident.liveStartLng);
  if (start) {
    return { ...start, name: incident.destinationName?.trim() || `🆘 ${panickerName}` };
  }

  const origin = finiteCoordPair(incident.latitude, incident.longitude);
  if (origin) {
    return { ...origin, name: incident.destinationName?.trim() || `🆘 ${panickerName}` };
  }

  return null;
}

/**
 * Live navigation target for joiners — prefers the panicker's current GPS on
 * panic incidents so Direct / fallback guidance tracks a moving target.
 */
export function resolveLiveNavTarget(
  incident: JoinerNavIncident,
): { lat: number; lng: number; name: string } | null {
  const base = resolveJoinerNavDestination(incident);
  if (!base) return null;

  const isPanic = (incident.categoryName ?? "").toLowerCase().includes("panic");
  if (isPanic) {
    const live = finiteCoordPair(incident.responderLat, incident.responderLng);
    if (live) {
      return { ...live, name: base.name };
    }
  }
  return base;
}

/** Destination set during a live incident (excludes placeholder names). */
export function liveIncidentDestination(
  incident: Pick<Incident, "destinationName" | "destinationLat" | "destinationLng">,
): { name: string; lat: number | null; lng: number | null } | null {
  const coords = finiteCoords(incident.destinationLat, incident.destinationLng);
  const rawName = incident.destinationName?.trim() ?? "";
  const name = !isPlaceholderLocationName(rawName)
    ? rawName
    : coords
      ? formatCoordLabel(coords.lat, coords.lng)
      : "";
  if (!name) return null;
  return {
    name,
    lat: coords?.lat ?? (incident.destinationLat != null ? Number(incident.destinationLat) : null),
    lng: coords?.lng ?? (incident.destinationLng != null ? Number(incident.destinationLng) : null),
  };
}

/**
 * Occurrence Book / list label for where an incident happened.
 * Prefers named location, then live destination, then any usable GPS pair.
 */
export function resolveIncidentLocationLabel(
  incident: Incident,
  locations: Location[],
  customMapName?: string | null,
): string {
  if (incident.customMapId != null) {
    return customMapName?.trim() || "Custom Map";
  }
  if (incident.customMapX != null || incident.customMapY != null) {
    return "Map removed";
  }

  if (!isPlaceholderLocationName(incident.locationName)) {
    return incident.locationName!.trim();
  }

  if (incident.locationId != null) {
    const loc = locations.find((l) => l.id === incident.locationId);
    if (loc?.name?.trim()) return loc.name.trim();
  }

  const liveDest = liveIncidentDestination(incident);
  if (liveDest) return liveDest.name;

  const coords = resolveIncidentCoords(incident, locations);
  if (coords) return formatCoordLabel(coords.lat, coords.lng);

  return "-";
}

/** True when the incident has file attachments and/or evidence notes. */
export function incidentHasEvidence(
  incident: Pick<IncidentWithMeta, "attachmentCount" | "evidenceNoteCount">,
): boolean {
  return (Number(incident.attachmentCount) || 0) + (Number(incident.evidenceNoteCount) || 0) > 0;
}

export type EffectiveSeverity = "red" | "orange" | "yellow" | null;

/** Incident severity when set; otherwise falls back to the category's configured severity.
 *  Panic SOS is always treated as red when no severity was stamped on the row. */
export function resolveEffectiveSeverity(
  incident: Pick<Incident, "severity"> & { panicClosedAt?: string | Date | null },
  category?: Pick<Category, "severity" | "name"> | null,
): EffectiveSeverity {
  const direct = incident.severity;
  if (direct && direct !== "none") return direct as EffectiveSeverity;
  const fromCat = category?.severity;
  if (fromCat && fromCat !== "none") return fromCat as EffectiveSeverity;
  const catName = category?.name?.toLowerCase() ?? "";
  if (catName === "panic" || incident.panicClosedAt) return "red";
  return null;
}

export function getReporterDisplayName(incident: IncidentWithMeta): string | null {
  const name = `${incident.reporterFirstName ?? ""} ${incident.reporterLastName ?? ""}`.trim();
  return name || null;
}

export function resolveIncidentCoords(
  incident: Incident,
  locations: Location[],
): { lat: number; lng: number } | null {
  const direct = finiteCoords(incident.latitude, incident.longitude);
  if (direct) return direct;

  if (incident.locationId != null) {
    const loc = locations.find((l) => l.id === incident.locationId);
    const fromLoc = finiteCoords(loc?.latitude, loc?.longitude);
    if (fromLoc) return fromLoc;
  }

  const destination = finiteCoords(incident.destinationLat, incident.destinationLng);
  if (destination) return destination;

  const liveStart = finiteCoords(incident.liveStartLat, incident.liveStartLng);
  if (liveStart) return liveStart;

  const liveEnd = finiteCoords(
    (incident as Incident & { liveEndLat?: number | null }).liveEndLat,
    (incident as Incident & { liveEndLng?: number | null }).liveEndLng,
  );
  if (liveEnd) return liveEnd;

  const liveConvert = finiteCoords(incident.liveConvertLat, incident.liveConvertLng);
  if (liveConvert) return liveConvert;

  return null;
}

export function incidentHasCustomMapPin(incident: Incident): boolean {
  return incident.customMapId != null && incident.customMapX != null && incident.customMapY != null;
}

export function incidentHasViewableLocation(
  incident: Incident,
  locations: Location[],
): boolean {
  return incidentHasCustomMapPin(incident) || resolveIncidentCoords(incident, locations) !== null;
}
