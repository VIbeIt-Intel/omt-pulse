import type { EvidencePhase } from "@shared/schema";

type TimedEvidence = { evidencePhase?: string | null; createdAt: Date | string };

type IncidentTiming = {
  liveEndedAt?: Date | string | null;
  createdAt?: Date | string | null;
};

/** Resolve scene vs supplementary for legacy rows without evidence_phase. */
export function effectiveEvidencePhase(
  item: TimedEvidence,
  incident?: IncidentTiming | null,
): EvidencePhase {
  if (item.evidencePhase === "scene" || item.evidencePhase === "supplementary") {
    return item.evidencePhase;
  }
  const itemMs = new Date(item.createdAt).getTime();
  if (incident?.liveEndedAt) {
    return itemMs <= new Date(incident.liveEndedAt).getTime() ? "scene" : "supplementary";
  }
  if (incident?.createdAt) {
    const incMs = new Date(incident.createdAt).getTime();
    // Manual OB entries: treat uploads within 15 min of creation as scene evidence.
    return itemMs - incMs <= 15 * 60 * 1000 ? "scene" : "supplementary";
  }
  return "scene";
}
