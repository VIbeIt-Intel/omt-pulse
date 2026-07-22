import type { Incident, Category, Location } from "@shared/schema";

export type IncidentWithMeta = Incident & {
  attachmentCount: number;
  reporterFirstName?: string | null;
  reporterLastName?: string | null;
  closedByName?: string | null;
};

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

/** Destination set during a live incident (excludes placeholder locationName). */
export function liveIncidentDestination(
  incident: Pick<Incident, "destinationName" | "destinationLat" | "destinationLng">,
): { name: string; lat: number | null; lng: number | null } | null {
  const name = incident.destinationName?.trim();
  if (!name || name === "Live Incident") return null;
  const lat = incident.destinationLat != null ? Number(incident.destinationLat) : null;
  const lng = incident.destinationLng != null ? Number(incident.destinationLng) : null;
  return { name, lat, lng };
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
  if (incident.latitude != null && incident.longitude != null) {
    return { lat: incident.latitude, lng: incident.longitude };
  }
  if (incident.locationId != null) {
    const loc = locations.find((l) => l.id === incident.locationId);
    if (loc?.latitude != null && loc?.longitude != null) {
      return { lat: loc.latitude, lng: loc.longitude };
    }
  }
  if (incident.liveStartLat != null && incident.liveStartLng != null) {
    return { lat: incident.liveStartLat, lng: incident.liveStartLng };
  }
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
