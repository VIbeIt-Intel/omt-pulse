import type { Incident, Category, Location } from "@shared/schema";

export type IncidentWithMeta = Incident & {
  attachmentCount: number;
  reporterFirstName?: string | null;
  reporterLastName?: string | null;
};

export type EffectiveSeverity = "red" | "orange" | "yellow" | null;

/** Incident severity when set; otherwise falls back to the category's configured severity. */
export function resolveEffectiveSeverity(
  incident: Pick<Incident, "severity">,
  category?: Pick<Category, "severity"> | null,
): EffectiveSeverity {
  const direct = incident.severity;
  if (direct && direct !== "none") return direct as EffectiveSeverity;
  const fromCat = category?.severity;
  if (fromCat && fromCat !== "none") return fromCat as EffectiveSeverity;
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
