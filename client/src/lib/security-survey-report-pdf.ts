import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { SecuritySurveyDetail } from "@/lib/security-survey-types";
import { apiUrl } from "@/lib/api-base";
import { mediaSrc } from "@/lib/authed-media";
import intelafriLogo from "@assets/IntelAfri_Logo_13_January_2025_2_1778851888379.png";

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
  switch (severity.toLowerCase()) {
    case "critical":
      return { fillColor: [220, 38, 38], textColor: [255, 255, 255] };
    case "high":
      return { fillColor: [249, 115, 22], textColor: [255, 255, 255] };
    case "medium":
      return { fillColor: [251, 191, 36], textColor: [0, 0, 0] };
    case "low":
      return { fillColor: [5, 150, 105], textColor: [255, 255, 255] };
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
  let y = 12;

  const [logoData, sitePhotoData] = await Promise.all([
    loadImageAsDataUrl(intelafriLogo),
    survey.locationPhotoUrl ? loadImageAsDataUrl(survey.locationPhotoUrl) : Promise.resolve(null),
  ]);

  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", margin, y, 28, 12);
    } catch {
      /* ignore logo failures */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("OMT Site Survey Report", margin + 32, y + 8);
  y += 18;

  const clientName = survey.clientNameOverride || survey.organizationName || "Client";
  const siteName = survey.locationName || "Site";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
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
  y += 8;

  const sitePhotoW = 42;
  const sitePhotoH = 32;
  const tableRightInset = sitePhotoData ? sitePhotoW + 6 : 0;

  if (sitePhotoData) {
    try {
      const format = sitePhotoData.includes("image/png") ? "PNG" : "JPEG";
      doc.addImage(
        sitePhotoData,
        format,
        210 - margin - sitePhotoW,
        y,
        sitePhotoW,
        sitePhotoH,
      );
    } catch {
      /* ignore site photo failures */
    }
  }

  const severitiesForRows: Array<string | null> = [];

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin + tableRightInset },
    theme: "grid",
    head: [["Field", "Value"]],
    body: [
      ["Client", clientName],
      ["Site", siteName],
      ["Address", formatAddressLine(survey)],
      ["Template", survey.templateName || "—"],
      ["Started", fmtTs(survey.startedAt)],
      ["Completed", fmtTs(survey.completedAt)],
      ["Progress", `${survey.findings.length}/${survey.items.length} items`],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255 },
  });

  y = Math.max(
    (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY,
    sitePhotoData ? y + sitePhotoH : 0,
  ) + 8;

  const findingByItem = new Map(
    survey.findings
      .filter((f) => f.templateItemId != null)
      .map((f) => [f.templateItemId!, f]),
  );

  const rows = survey.items.map((item, i) => {
    const f = findingByItem.get(item.id);
    const sev = f?.severity ?? null;
    severitiesForRows.push(typeof sev === "string" ? sev : null);
    return [
      String(i + 1),
      item.category,
      item.prompt,
      f ? String(f.answer).toUpperCase() : "—",
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
      if (data.section !== "body" || data.column.index !== 4) return;
      const raw = severitiesForRows[data.row.index];
      const style = severityCellStyle(raw);
      if (!style) return;
      data.cell.styles.fillColor = style.fillColor;
      data.cell.styles.textColor = style.textColor;
      data.cell.styles.fontStyle = "bold";
      data.cell.styles.halign = "center";
    },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  if (survey.recommendations?.trim()) {
    if (y > 250) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Recommendations", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(survey.recommendations.trim(), 180);
    doc.text(lines, margin, y);
    y += lines.length * 4.2 + 6;
  }

  const photoFindings = survey.findings.filter((f) => f.photos.length > 0);
  if (photoFindings.length > 0) {
    if (y > 240) {
      doc.addPage();
      y = 16;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Evidence photos", margin, y);
    y += 6;

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
