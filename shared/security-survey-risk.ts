/** Site survey risk scoring (list API, PDF, report display). */

export type SurveyRiskRating = "low" | "medium" | "high" | "critical";

export type SurveyRiskFindingLike = {
  category?: string | null;
  prompt?: string | null;
  answer?: string | null;
  severity?: string | null;
  notes?: string | null;
};

export type SurveyRiskSummary = {
  score: number;
  rating: SurveyRiskRating;
  label: string;
  /** RGB fill for gauge / badges */
  color: [number, number, number];
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
};

const SEVERITY_POINTS: Record<string, number> = {
  critical: 10,
  high: 7,
  medium: 4,
  low: 2,
};

/** Gauge / rating colours: Green Low, Orange Medium, Red High, Dark Red Critical */
export const RISK_RATING_COLORS: Record<
  SurveyRiskRating,
  { rgb: [number, number, number]; label: string }
> = {
  low: { rgb: [22, 163, 74], label: "Low Risk" },
  medium: { rgb: [249, 115, 22], label: "Medium Risk" },
  high: { rgb: [220, 38, 38], label: "High Risk" },
  critical: { rgb: [127, 29, 29], label: "Critical Risk" },
};

/** Severity cell colours aligned with the risk gauge scheme. */
export const SEVERITY_RGB: Record<
  string,
  { fill: [number, number, number]; text: [number, number, number] }
> = {
  critical: { fill: [127, 29, 29], text: [255, 255, 255] },
  high: { fill: [220, 38, 38], text: [255, 255, 255] },
  medium: { fill: [249, 115, 22], text: [255, 255, 255] },
  low: { fill: [22, 163, 74], text: [255, 255, 255] },
};

export function severityPoints(severity: string | null | undefined): number {
  if (!severity) return 0;
  return SEVERITY_POINTS[severity.toLowerCase()] ?? 0;
}

export function ratingFromScore(score: number): SurveyRiskRating {
  if (score >= 61) return "critical";
  if (score >= 36) return "high";
  if (score >= 16) return "medium";
  return "low";
}

/** Visual fill fraction for the gauge bar (critical band starts ~76% of the track). */
export function riskGaugeFraction(score: number): number {
  const capped = Math.min(Math.max(score, 0), 80);
  return capped / 80;
}

export function computeSurveyRiskSummary(
  findings: SurveyRiskFindingLike[],
): SurveyRiskSummary {
  let score = 0;
  let criticalCount = 0;
  let highCount = 0;
  let mediumCount = 0;
  let lowCount = 0;

  for (const f of findings) {
    const sev = f.severity?.toLowerCase() ?? null;
    // YES with no severity = no issue (0). Only findings with a severity contribute.
    if (!sev) continue;
    score += severityPoints(sev);
    if (sev === "critical") criticalCount += 1;
    else if (sev === "high") highCount += 1;
    else if (sev === "medium") mediumCount += 1;
    else if (sev === "low") lowCount += 1;
  }

  const rating = ratingFromScore(score);
  const meta = RISK_RATING_COLORS[rating];
  return {
    score,
    rating,
    label: meta.label,
    color: meta.rgb,
    criticalCount,
    highCount,
    mediumCount,
    lowCount,
  };
}
