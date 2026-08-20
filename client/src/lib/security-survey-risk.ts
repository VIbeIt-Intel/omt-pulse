/** Site survey risk scoring and recommendation helpers (PDF / report display). */

export {
  RISK_RATING_COLORS,
  SEVERITY_RGB,
  computeSurveyRiskSummary,
  ratingFromScore,
  riskGaugeFraction,
  severityPoints,
  type SurveyRiskFindingLike,
  type SurveyRiskRating,
  type SurveyRiskSummary,
} from "@shared/security-survey-risk";

import type { SurveyRiskFindingLike } from "@shared/security-survey-risk";

function sentenceCase(s: string): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Map a High/Critical finding to a professional, actionable recommendation.
 * Prefers checkpoint wording; falls back to category-aware defaults.
 */
export function recommendationForFinding(f: SurveyRiskFindingLike): string {
  const prompt = (f.prompt ?? "").trim();
  const notes = (f.notes ?? "").trim();
  const hay = `${prompt} ${notes}`.toLowerCase();
  const cat = (f.category ?? "").toLowerCase();

  if (/visitor|vehicle\s*log|truck\s*\/?\s*visitor|contractor\s*log/.test(hay)) {
    return "Install and enforce a visitor and vehicle logbook at the main access point, with every arrival and departure recorded.";
  }
  if (/nvr|time\s*sync|recording\s*\/?\s*nvr|retention/.test(hay)) {
    return "Restore NVR time sync and confirm recording retention so footage remains usable for investigations.";
  }
  if (/live\s*view|control\s*room/.test(hay)) {
    return "Enable remote live viewing from the control room and verify operators can review critical camera feeds in real time.";
  }
  if (/guard.*(manned|post|house)|manned as scheduled|gate\s*\/\s*guard/.test(hay)) {
    return "Ensure the guard post is manned as scheduled and attendance is verified against the duty roster.";
  }
  if (/radio|panic\s*device/.test(hay)) {
    return "Ensure radios and panic devices are functional, charged, and tested at the start of each shift.";
  }
  if (/logbook/.test(hay) && (/post|gate|guard/.test(hay) || cat.includes("guard"))) {
    return "Keep the post/gate logbook current with vehicle, visitor, seal, and incident entries at the time of occurrence.";
  }
  if (/fence|wall|breach|climb\s*point/.test(hay)) {
    return "Repair perimeter fence/wall breaches and climb points to restore a continuous secure boundary.";
  }
  if (/gate/.test(hay) && (/secure|lock|control|condition|perimeter|vehicle|pedestrian/.test(hay) || cat.includes("perimeter"))) {
    return "Secure perimeter gates so they remain lockable and controlled during and after operating hours.";
  }
  if (/vegetation|line of sight|scrap\s*cleared/.test(hay)) {
    return "Clear vegetation and scrap along the perimeter to restore line of sight for patrols and CCTV.";
  }
  if (/access point|staffed|reception|access-controlled|entrance/.test(hay) && cat.includes("access")) {
    return "Staff or electronically control the main access point during all operating hours.";
  }
  if (/credential|keys?|access\s*card|roller-?shutter\s*remote|remotes/.test(hay)) {
    return "Account for all keys, access cards, and remotes; remove unissued credentials from circulation.";
  }
  if (/loading-?bay|dock\s*door/.test(hay)) {
    return "Secure loading-bay and dock doors when not actively in use.";
  }
  if (/lighting|lit after dark|adequately lit/.test(hay) || cat.includes("lighting")) {
    if (/lighting|lit|dark|aisle|bay|parking|yard|perimeter/.test(hay)) {
      return "Restore perimeter and high-risk area lighting so approaches and assets remain visible after dark.";
    }
  }
  if (/cctv|camera/.test(hay) && (/cover|approach|asset|gate|loading|blind/.test(hay) || cat.includes("cctv"))) {
    return "Improve CCTV coverage of critical approaches, gates, and high-value assets; eliminate blind spots.";
  }
  if (/intruder\s*alarm|alarm\s*armed|reporting\s*correctly|warehouse\s*zones/.test(hay)) {
    return "Test and arm the intruder alarm correctly; confirm reliable reporting to the monitoring centre.";
  }
  if (/panic|duress/.test(hay)) {
    return "Test panic/duress buttons where installed and ensure staff know the activation procedure.";
  }
  if (/extinguisher/.test(hay)) {
    return "Ensure fire extinguishers are present, charged, in date, and unobstructed.";
  }
  if (/emergency\s*exit|escape\s*route|exit\s*signage/.test(hay)) {
    return "Keep emergency exits clear and exit signage visible at all times.";
  }
  if (/fire\s*detection|hose\s*reel|sprinkler/.test(hay)) {
    return "Service fire detection, hose reel, and sprinkler equipment so it remains serviceable.";
  }
  if (/housekeeping|concealment|trip\s*hazard/.test(hay)) {
    return "Improve housekeeping to remove concealment spaces, trip hazards, and obstructions to cameras or exits.";
  }
  if (/immediate\s*security\s*risk|escalat/.test(hay)) {
    return "Escalate immediate security risks to site management and implement interim controls until remediated.";
  }
  if (/high-?value|bonded\s*stock/.test(hay)) {
    return "Secure high-value or bonded stock areas separately from general warehousing with controlled access.";
  }

  if (cat.includes("perimeter")) {
    return "Remediate identified perimeter weaknesses and verify the boundary is secure on follow-up inspection.";
  }
  if (cat.includes("access")) {
    return "Strengthen access control at the affected point and verify compliance on the next site visit.";
  }
  if (cat.includes("cctv")) {
    return "Restore CCTV recording, coverage, and live-view capability so the site can be monitored effectively.";
  }
  if (cat.includes("guard")) {
    return "Ensure guard posts are manned as scheduled and radios/panic devices remain functional.";
  }
  if (cat.includes("alarm")) {
    return "Verify alarm and duress systems are tested, armed correctly, and reporting as required.";
  }
  if (cat.includes("fire")) {
    return "Bring fire safety equipment and escape routes back to a serviceable, compliant standard.";
  }
  if (cat.includes("lighting")) {
    return "Restore adequate lighting in perimeter and high-risk areas after dark.";
  }

  const base = prompt
    ? `Address the finding: ${sentenceCase(prompt.replace(/\?+$/, ""))}.`
    : "Address the identified security deficiency and verify remediation on follow-up.";
  if (notes) {
    return `${base} Surveyor note: ${sentenceCase(notes)}.`;
  }
  return base;
}

export type GeneratedRecommendation = {
  severity: string;
  category: string;
  text: string;
  prompt: string;
};

/** Auto-recommendations from High and Critical findings only (Critical first). */
export function generateSurveyRecommendations(
  findings: SurveyRiskFindingLike[],
): GeneratedRecommendation[] {
  const priority = (s: string | null | undefined) => {
    const v = (s ?? "").toLowerCase();
    if (v === "critical") return 0;
    if (v === "high") return 1;
    return 9;
  };

  const seen = new Set<string>();
  const out: GeneratedRecommendation[] = [];

  const sorted = [...findings]
    .filter((f) => {
      const s = f.severity?.toLowerCase();
      return s === "critical" || s === "high";
    })
    .sort((a, b) => priority(a.severity) - priority(b.severity));

  for (const f of sorted) {
    const text = recommendationForFinding(f);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      severity: String(f.severity ?? "").toLowerCase(),
      category: f.category?.trim() || "General",
      text,
      prompt: f.prompt?.trim() || "",
    });
  }

  return out;
}
