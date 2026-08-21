import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SecuritySurveyDetail } from "@/lib/security-survey-types";
import { apiUrl } from "@/lib/api-base";
import { mediaSrc } from "@/lib/authed-media";
import intelafriLogo from "@assets/IntelAfri_Logo_13_January_2025_2_1778851888379.png";
import {
  computeSurveyRiskSummary,
  generateSurveyRecommendations,
  riskGaugeFraction,
  RISK_RATING_COLORS,
  SEVERITY_RGB,
  type SurveyRiskSummary,
} from "@/lib/security-survey-risk";

function fmtTs(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function safeFilePart(s: string): string {
  return s.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 48);
}

async function loadImageAsDataUrl(src: string): Promise<string | null> {
  try {
    if (src.startsWith("data:")) return src;
    const path = mediaSrc(src);
    const fetchUrl =
      path.startsWith("blob:") || /^https?:\/\//i.test(path) ? path : apiUrl(path);
    const resp = await fetch(fetchUrl, { credentials: "include" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function severityLabel(s: string | null | undefined): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** RGB fill/text for survey severity cells in the checklist PDF. */
function severityCellStyle(
  severity: string | null | undefined,
): { fillColor: [number, number, number]; textColor: [number, number, number] } | null {
  if (!severity) return null;
  const style = SEVERITY_RGB[severity.toLowerCase()];
  if (!style) return null;
  return { fillColor: style.fill, textColor: style.text };
}

/** RGB fill/text for YES/NO/N/A answer cells in the checklist PDF. */
function answerCellStyle(
  answer: string | null | undefined,
): { fillColor: [number, number, number]; textColor: [number, number, number] } | null {
  if (!answer) return null;
  switch (answer.toLowerCase()) {
    case "yes":
      return { fillColor: [22, 163, 74], textColor: [255, 255, 255] };
    case "no":
      return { fillColor: [220, 38, 38], textColor: [255, 255, 255] };
    case "na":
    case "n/a":
      return { fillColor: [148, 163, 184], textColor: [15, 23, 42] };
    default:
      return null;
  }
}

function formatAddressLine(survey: SecuritySurveyDetail): string {
  const addr = survey.locationAddress?.trim();
  const lat = survey.locationLatitude;
  const lng = survey.locationLongitude;
  const coords =
    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? `${lat.toFixed(5)}, ${lng.toFixed(5)}`
      : null;
  if (addr && coords) return `${addr} (${coords})`;
  if (addr) return addr;
  if (coords) return coords;
  return "—";
}

/** Shared vertical rhythm for all major section headings (mm). */
const SECTION_SPACE_BEFORE = 10;
const SECTION_SPACE_AFTER = 6;
const SECTION_HEADING_SIZE = 11;
const PAGE_CONTENT_BOTTOM = 275;

/**
 * Draw a section heading with consistent space above/below.
 * Callers pass `y` at the bottom of the previous block (no extra gap needed).
 */
function drawSectionHeading(
  doc: jsPDF,
  margin: number,
  y: number,
  title: string,
  minBodyMm = 28,
): number {
  if (y + SECTION_SPACE_BEFORE + minBodyMm > PAGE_CONTENT_BOTTOM) {
    doc.addPage();
    y = 16;
  } else {
    y += SECTION_SPACE_BEFORE;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(SECTION_HEADING_SIZE);
  doc.setTextColor(15, 23, 42);
  doc.text(title, margin, y);
  doc.setTextColor(0);
  return y + SECTION_SPACE_AFTER;
}

/** Draw colour-coded risk score bar (heading drawn separately via drawSectionHeading). */
function drawRiskGauge(
  doc: jsPDF,
  margin: number,
  y: number,
  risk: SurveyRiskSummary,
): number {
  const pageW = doc.internal.pageSize.getWidth();
  const contentW = pageW - margin * 2;
  const barH = 7;
  const barY = y + 8;
  const [r, g, b] = risk.color;
  const fillW = Math.max(2, contentW * riskGaugeFraction(risk.score));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(r, g, b);
  doc.text(risk.label.toUpperCase(), margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(51, 65, 85);
  doc.text(`Total score: ${risk.score}`, margin + 72, y);

  // Track
  doc.setFillColor(226, 232, 240);
  doc.roundedRect(margin, barY, contentW, barH, 1.2, 1.2, "F");

  // Filled portion
  doc.setFillColor(r, g, b);
  doc.roundedRect(margin, barY, fillW, barH, 1.2, 1.2, "F");

  // Zone tick marks (15 / 35 / 60 on a 0–80 scale)
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.2);
  for (const tick of [15, 35, 60]) {
    const x = margin + contentW * (tick / 80);
    doc.line(x, barY - 0.5, x, barY + barH + 0.5);
  }

  // Zone legend
  const legendY = barY + barH + 5;
  doc.setFontSize(7);
  const zones: Array<{ key: keyof typeof RISK_RATING_COLORS; range: string }> = [
    { key: "low", range: "0–15" },
    { key: "medium", range: "16–35" },
    { key: "high", range: "36–60" },
    { key: "critical", range: "61+" },
  ];
  let lx = margin;
  for (const z of zones) {
    const c = RISK_RATING_COLORS[z.key].rgb;
    doc.setFillColor(c[0], c[1], c[2]);
    doc.roundedRect(lx, legendY - 2.2, 3.2, 3.2, 0.4, 0.4, "F");
    doc.setTextColor(71, 85, 105);
    doc.setFont("helvetica", "normal");
    const label = `${RISK_RATING_COLORS[z.key].label.replace(" Risk", "")} ${z.range}`;
    doc.text(label, lx + 4.2, legendY);
    lx += doc.getTextWidth(label) + 8;
  }

  doc.setTextColor(0);
  return legendY + 6;
}

export type SurveyPdfResult = {
  blob: Blob;
  base64: string;
  filename: string;
};

/** Build a site survey PDF (client-side). */
export async function buildSecuritySurveyReportPdf(
  survey: SecuritySurveyDetail,
): Promise<SurveyPdfResult> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 14;
  let y = 14;

  const risk = computeSurveyRiskSummary(survey.findings);
  const autoRecs = generateSurveyRecommendations(survey.findings);

  const [logoData, sitePhotoData] = await Promise.all([
    loadImageAsDataUrl(intelafriLogo),
    survey.locationPhotoUrl ? loadImageAsDataUrl(survey.locationPhotoUrl) : Promise.resolve(null),
  ]);

  // Header: logo alone on its own row, then title + meta below
  const logoW = 32;
  const logoH = 14;
  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", margin, y, logoW, logoH);
      y += logoH + 8;
    } catch {
      /* ignore logo failures */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("OMT Site Survey Report", margin, y);
  y += 8;

  const clientName = survey.clientNameOverride || survey.organizationName || "Client";
  const siteName = survey.locationName || "Site";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(15, 23, 42);
  doc.text(`${clientName} — ${siteName}`, margin, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(80);
  doc.text(
    `${survey.surveyorName} · ${String(survey.status).replace(/_/g, " ")} · Survey #${survey.id}`,
    margin,
    y,
  );
  doc.setTextColor(0);

  y = drawSectionHeading(doc, margin, y, "Overall Risk Rating", 36);
  y = drawRiskGauge(doc, margin, y, risk);

  const addressLine = formatAddressLine(survey);
  const hasMapCoords =
    survey.locationLatitude != null &&
    survey.locationLongitude != null &&
    Number.isFinite(survey.locationLatitude) &&
    Number.isFinite(survey.locationLongitude);
  const mapsUrl = hasMapCoords
    ? `https://www.google.com/maps?q=${survey.locationLatitude},${survey.locationLongitude}`
    : null;

  const severitiesForRows: Array<string | null> = [];
  const answersForRows: Array<string | null> = [];

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["Field", "Value"]],
    body: [
      ["Client", clientName],
      ["Site", siteName],
      ["Address", addressLine],
      ["Overall risk", `${risk.label} (score ${risk.score})`],
      ["Template", survey.templateName || "—"],
      ["Started", fmtTs(survey.startedAt)],
      ["Completed", fmtTs(survey.completedAt)],
      ["Progress", `${survey.findings.length}/${survey.items.length} items`],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255 },
    didParseCell: (data) => {
      if (data.section === "body" && data.column.index === 1 && data.row.index === 3) {
        data.cell.styles.textColor = risk.color;
        data.cell.styles.fontStyle = "bold";
      }
      if (
        mapsUrl &&
        data.section === "body" &&
        data.column.index === 1 &&
        data.row.index === 2
      ) {
        data.cell.styles.textColor = [37, 99, 235];
      }
    },
    didDrawCell: (data) => {
      if (
        !mapsUrl ||
        data.section !== "body" ||
        data.column.index !== 1 ||
        data.row.index !== 2
      ) {
        return;
      }
      doc.link(data.cell.x, data.cell.y, data.cell.width, data.cell.height, {
        url: mapsUrl,
      });
    },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  if (sitePhotoData) {
    // Fuller width under the Field/Value summary (A4 content ≈ 182mm).
    const sitePhotoW = 120;
    const sitePhotoH = 90;
    const photoTopGap = 8;
    if (y + photoTopGap + sitePhotoH > PAGE_CONTENT_BOTTOM) {
      doc.addPage();
      y = 16;
    } else {
      y += photoTopGap;
    }
    try {
      const format = sitePhotoData.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(sitePhotoData, format, margin, y, sitePhotoW, sitePhotoH);
      y += sitePhotoH;
    } catch {
      /* keep y at photo start */
    }
  }

  y = drawSectionHeading(doc, margin, y, "Checklist", 40);

  const findingByItem = new Map(
    survey.findings
      .filter((f) => f.templateItemId != null)
      .map((f) => [f.templateItemId!, f]),
  );

  const rows = survey.items.map((item, i) => {
    const f = findingByItem.get(item.id);
    const sev = f?.severity ?? null;
    severitiesForRows.push(typeof sev === "string" ? sev : null);
    const ans = f ? String(f.answer) : null;
    answersForRows.push(ans);
    return [
      String(i + 1),
      item.category,
      item.prompt,
      ans ? ans.toUpperCase() : "—",
      f ? severityLabel(f.severity) : "—",
      f?.notes?.trim() || "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["#", "Category", "Checkpoint", "Answer", "Severity", "Notes"]],
    body: rows,
    styles: { fontSize: 7.5, cellPadding: 1.4, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 28 },
      2: { cellWidth: 55 },
      3: { cellWidth: 16 },
      4: { cellWidth: 20 },
      5: { cellWidth: 45 },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (data.column.index === 3) {
        const style = answerCellStyle(answersForRows[data.row.index]);
        if (!style) return;
        data.cell.styles.fillColor = style.fillColor;
        data.cell.styles.textColor = style.textColor;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "center";
        return;
      }
      if (data.column.index === 4) {
        const style = severityCellStyle(severitiesForRows[data.row.index]);
        if (!style) return;
        data.cell.styles.fillColor = style.fillColor;
        data.cell.styles.textColor = style.textColor;
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.halign = "center";
      }
    },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  const photoFindings = survey.findings.filter((f) => f.photos.length > 0);
  if (photoFindings.length > 0) {
    y = drawSectionHeading(doc, margin, y, "Evidence photos", 40);

    for (const f of photoFindings) {
      for (const photo of f.photos.slice(0, 4)) {
        const dataUrl = await loadImageAsDataUrl(photo.objectUrl);
        if (!dataUrl) continue;
        if (y > 230) {
          doc.addPage();
          y = 16;
        }
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        doc.setTextColor(80);
        doc.text(`${f.category}: ${f.prompt.slice(0, 80)}`, margin, y);
        doc.setTextColor(0);
        y += 4;
        try {
          const format = dataUrl.includes("image/png") ? "PNG" : "JPEG";
          doc.addImage(dataUrl, format, margin, y, 80, 50);
          y += 54;
        } catch {
          y += 2;
        }
      }
    }
  }

  // Recommendations at end of report (auto from High/Critical + optional surveyor notes)
  y = drawSectionHeading(doc, margin, y, "Recommendations", 36);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    "Priority actions generated from High and Critical findings. Address Critical items first.",
    margin,
    y,
  );
  y += 7;
  doc.setTextColor(0);

  if (autoRecs.length === 0 && !survey.recommendations?.trim()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(
      "No High or Critical findings requiring immediate action were recorded on this survey.",
      margin,
      y,
    );
    y += 6;
  } else {
    for (let i = 0; i < autoRecs.length; i++) {
      const rec = autoRecs[i]!;
      const sevStyle = SEVERITY_RGB[rec.severity] ?? SEVERITY_RGB.high;
      const bullet = `${i + 1}. [${rec.severity.toUpperCase()} · ${rec.category}] ${rec.text}`;
      const lines = doc.splitTextToSize(bullet, 180) as string[];
      const blockH = lines.length * 4.2 + 3.5;
      if (y + blockH > PAGE_CONTENT_BOTTOM) {
        doc.addPage();
        y = 16;
      }
      doc.setFillColor(sevStyle.fill[0], sevStyle.fill[1], sevStyle.fill[2]);
      doc.roundedRect(margin, y - 2.5, 2.2, 2.2, 0.3, 0.3, "F");
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      doc.text(lines, margin + 4, y);
      y += blockH;
    }

    if (survey.recommendations?.trim()) {
      if (y > 250) {
        doc.addPage();
        y = 16;
      } else {
        y += 4;
      }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(51, 65, 85);
      doc.text("Additional surveyor recommendations", margin, y);
      y += 5;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(15, 23, 42);
      const lines = doc.splitTextToSize(survey.recommendations.trim(), 180) as string[];
      if (y + lines.length * 4.2 > PAGE_CONTENT_BOTTOM) {
        doc.addPage();
        y = 16;
      }
      doc.text(lines, margin, y);
      y += lines.length * 4.2 + 4;
    }
  }

  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(`Generated ${new Date().toLocaleString()} · OMT Pulse / IntelAfri`, margin, 285);

  const filename = `OMT-Site-Survey-${survey.id}-${safeFilePart(siteName)}.pdf`;
  const blob = doc.output("blob");
  const dataUri = doc.output("datauristring");
  const base64 = dataUri.includes(",") ? dataUri.split(",")[1]! : dataUri;

  return { blob, base64, filename };
}

export async function downloadSecuritySurveyReportPdf(
  survey: SecuritySurveyDetail,
): Promise<void> {
  const { blob, filename } = await buildSecuritySurveyReportPdf(survey);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Base64 (no data: prefix) for email attachment via /email-pdf. */
export async function buildSecuritySurveyReportPdfBase64(
  survey: SecuritySurveyDetail,
): Promise<{ base64: string; filename: string }> {
  const { base64, filename } = await buildSecuritySurveyReportPdf(survey);
  return { base64, filename };
}
