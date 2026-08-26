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

/** Shared pitch: one multi-purpose site device for capture, patrol, and warehouse control. */
const MULTI_PURPOSE_DEVICE =
  "Equip the site with a multi-purpose device (tablet/phone running OMT Pulse) that captures visitor/driver licences and IDs, supports digital patrol rounds, and handles pallet/stock control — one tool for gate, patrol, and warehouse, not paper logbooks.";

/**
 * Map a High/Critical finding to a professional, actionable recommendation.
 * Access / guard / warehouse themes insist on a multi-purpose capture + patrol device.
 */
export function recommendationForFinding(f: SurveyRiskFindingLike): string {
  const prompt = (f.prompt ?? "").trim();
  const notes = (f.notes ?? "").trim();
  const hay = `${prompt} ${notes}`.toLowerCase();
  const cat = (f.category ?? "").toLowerCase();

  // --- Multi-purpose device themes (dedupe to one shared line where possible) ---
  if (/visitor|vehicle\s*log|truck\s*\/?\s*visitor|contractor\s*log|licence|license|id\s*capture|driver.?s?\s*licen/.test(hay)) {
    return MULTI_PURPOSE_DEVICE;
  }
  if (/logbook/.test(hay) && (/post|gate|guard|visitor|vehicle|seal/.test(hay) || cat.includes("guard") || cat.includes("access"))) {
    return MULTI_PURPOSE_DEVICE;
  }
  if (/pallet|seal\s*control|stock\s*control|warehouse\s*control|goods\s*in|dispatch/.test(hay) || (cat.includes("warehouse") && /control|log|record|seal|pallet/.test(hay))) {
    return "Deploy a multi-purpose OMT device for pallet and seal control at receiving/dispatch, with the same unit used for licence capture at the gate and digital patrols on site.";
  }
  if (/credential|keys?|access\s*card|roller-?shutter\s*remote|remotes/.test(hay)) {
    return "Move credential, key, and remote issue/return onto a multi-purpose site device (licence capture + digital issue log) so access media are accounted for in real time — same device also covers patrol and pallet control.";
  }
  if (/access point|staffed|reception|access-controlled|entrance/.test(hay) && (cat.includes("access") || cat.includes("guard"))) {
    return "Staff the main access point with a multi-purpose device for licence/ID capture and digital visitor-vehicle logging; use the same unit for patrol check-ins and pallet control across the site.";
  }
  if (/guard.*(manned|post|house)|manned as scheduled|gate\s*\/\s*guard|patrol/.test(hay) || (cat.includes("guard") && /post|manned|attend|duty|round/.test(hay))) {
    return "Put a multi-purpose device on the guard post for licence capture and digital attendance, and use it for scheduled patrol rounds plus pallet/seal checks — one device, not separate paper processes.";
  }
  if (cat.includes("access") && /control|visitor|vehicle|gate|entry|credential|key|card/.test(hay)) {
    return MULTI_PURPOSE_DEVICE;
  }
  if (cat.includes("guard") && !/radio|panic/.test(hay)) {
    return "Standardise the guard force on a multi-purpose OMT device for gate licence capture, digital patrols, and warehouse pallet/seal control.";
  }

  // --- Site systems / physical (not device pitch) ---
  if (/nvr|time\s*sync|recording\s*\/?\s*nvr|retention/.test(hay)) {
    return "Restore NVR time sync and confirm recording retention so footage remains usable for investigations.";
  }
  if (/live\s*view|control\s*room/.test(hay)) {
    return "Enable remote live viewing from the control room and verify operators can review critical camera feeds in real time.";
  }
  if (/radio|panic\s*device/.test(hay)) {
    return "Ensure radios and panic devices are functional, charged, and tested at the start of each shift; pair with the multi-purpose OMT device for digital incident and patrol logging.";
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
  if (/loading-?bay|dock\s*door/.test(hay)) {
    return "Secure loading-bay and dock doors when not actively in use; use the site multi-purpose device to log bay open/close and pallet movements.";
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
    return "Secure high-value or bonded stock separately and control entry with the multi-purpose site device (licence/ID capture + digital access log), with the same unit used for patrol and pallet checks.";
  }

  if (cat.includes("perimeter")) {
    return "Remediate identified perimeter weaknesses and verify the boundary is secure on follow-up inspection.";
  }
  if (cat.includes("access")) {
    return MULTI_PURPOSE_DEVICE;
  }
  if (cat.includes("cctv")) {
    return "Restore CCTV recording, coverage, and live-view capability so the site can be monitored effectively.";
  }
  if (cat.includes("guard")) {
    return "Standardise the guard force on a multi-purpose OMT device for gate licence capture, digital patrols, and warehouse pallet/seal control.";
  }
  if (cat.includes("warehouse")) {
    return "Deploy a multi-purpose OMT device for pallet and seal control at receiving/dispatch, with the same unit used for licence capture at the gate and digital patrols on site.";
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

export type RecommendationBuckets = {
  critical: GeneratedRecommendation[];
  high: GeneratedRecommendation[];
  /** Default High items to show before "show more" / PDF ellipsis. */
  highPreviewLimit: number;
};

/** Default cap for High recommendations shown up front (Critical always fully listed). */
export const HIGH_RECS_PREVIEW_LIMIT = 4;

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

/** Split auto-recs for compact UI / PDF (Critical first; High may be truncated). */
export function bucketSurveyRecommendations(
  findings: SurveyRiskFindingLike[],
  highPreviewLimit = HIGH_RECS_PREVIEW_LIMIT,
): RecommendationBuckets {
  const all = generateSurveyRecommendations(findings);
  return {
    critical: all.filter((r) => r.severity === "critical"),
    high: all.filter((r) => r.severity === "high"),
    highPreviewLimit,
  };
}

/** Short one-line label for dense lists (prefer recommendation text, not the checkpoint prompt). */
export function shortRecommendationLabel(rec: GeneratedRecommendation, maxLen = 96): string {
  const raw = (rec.text || rec.prompt).replace(/\?+$/, "").trim();
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1).trimEnd()}…`;
}
