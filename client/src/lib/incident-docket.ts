import jsPDF from "jspdf";
import type {
  AttachmentWithUploader,
  Category,
  EvidenceNoteWithAuthor,
  Location,
} from "@shared/schema";
import {
  getReporterDisplayName,
  resolveEffectiveSeverity,
  resolveIncidentCoords,
  type IncidentWithMeta,
} from "@/lib/incident-display";
import { workstationAuthHeaders } from "@/lib/workstation-session";

type DocketOpts = {
  incident: IncidentWithMeta;
  incidentNumber: string;
  category?: Category | null;
  locationLabel: string;
  locations: Location[];
};

function fmtTs(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function authorName(
  first: string | null | undefined,
  last: string | null | undefined,
): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || "Unknown";
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers: workstationAuthHeaders(),
  });
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
  return res.json() as Promise<T>;
}

async function loadImageDataUrl(
  url: string,
): Promise<{ dataUrl: string; format: "JPEG" | "PNG"; w: number; h: number } | null> {
  try {
    const res = await fetch(url, { credentials: "include", cache: "no-store" });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsDataURL(blob);
    });
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("decode failed"));
      img.src = dataUrl;
    });
    const format: "JPEG" | "PNG" = blob.type.includes("png") ? "PNG" : "JPEG";
    return { dataUrl, format, ...dims };
  } catch {
    return null;
  }
}

function ensureSpace(doc: jsPDF, y: number, need: number): number {
  const pageH = doc.internal.pageSize.getHeight();
  if (y + need > pageH - 14) {
    doc.addPage();
    return 16;
  }
  return y;
}

function writeField(doc: jsPDF, label: string, value: string, x: number, y: number, maxW: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(90, 90, 90);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(20, 20, 20);
  const lines = doc.splitTextToSize(value || "—", maxW);
  doc.text(lines, x, y + 5);
  return y + 5 + lines.length * 5 + 4;
}

/**
 * Build and download a printable incident docket PDF (details + evidence notes + embedded photos).
 */
export async function downloadIncidentDocket(opts: DocketOpts): Promise<void> {
  const { incident, incidentNumber, category, locationLabel, locations } = opts;
  const [attachments, notes] = await Promise.all([
    fetchJson<AttachmentWithUploader[]>(`/api/incidents/${incident.id}/attachments`),
    fetchJson<EvidenceNoteWithAuthor[]>(`/api/incidents/${incident.id}/evidence-notes`),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const marginX = 14;
  const usableW = pageW - marginX * 2;
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(15, 23, 42);
  doc.text("OMT Pulse — Incident Docket", marginX, y);
  y += 8;

  doc.setFontSize(12);
  doc.text(`Incident ${incidentNumber}`, marginX, y);
  y += 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 100, 100);
  doc.text(`Generated ${new Date().toLocaleString()}`, marginX, y);
  y += 8;

  doc.setDrawColor(200, 200, 200);
  doc.line(marginX, y, pageW - marginX, y);
  y += 8;

  const severity = resolveEffectiveSeverity(incident, category);
  const reporter = getReporterDisplayName(incident) ?? "Unknown";
  const coords = resolveIncidentCoords(incident, locations);
  const panicClosed = (incident as { panicClosedAt?: string | Date | null }).panicClosedAt;

  const summary: Array<[string, string]> = [
    ["Date", incident.incidentDate ?? "—"],
    ["Time", incident.incidentTime ?? "—"],
    ["Reported by", reporter],
    ["Category", category?.name ?? "Uncategorised"],
    ["Severity", severity ? severity.charAt(0).toUpperCase() + severity.slice(1) : "—"],
    ["Location", locationLabel || "—"],
  ];
  if (incident.otherCategoryNote?.trim()) {
    summary.push(["Category note", incident.otherCategoryNote.trim()]);
  }
  if (coords) {
    summary.push(["Coordinates", `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`]);
  }
  if (incident.isLive) summary.push(["Status", "Live — Active"]);
  else if (panicClosed) summary.push(["Status", `Panic — Closed (${fmtTs(panicClosed)})`]);
  else if (incident.liveStartedAt) summary.push(["Status", "Live — Ended"]);
  if (incident.liveStartedAt) summary.push(["Live started", fmtTs(incident.liveStartedAt)]);
  if (incident.liveEndedAt) summary.push(["Live ended", fmtTs(incident.liveEndedAt)]);

  for (const [label, value] of summary) {
    y = ensureSpace(doc, y, 14);
    y = writeField(doc, label, value, marginX, y, usableW);
  }

  if (incident.description?.trim()) {
    y = ensureSpace(doc, y, 20);
    y = writeField(doc, "Description", incident.description.trim(), marginX, y, usableW);
  }

  const custom = (incident.customFields as Record<string, string | number | null> | null) ?? {};
  const customEntries = Object.entries(custom).filter(
    ([, v]) => v != null && String(v).trim() !== "",
  );
  if (customEntries.length > 0) {
    y = ensureSpace(doc, y, 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(15, 23, 42);
    doc.text("Additional fields", marginX, y);
    y += 6;
    for (const [key, value] of customEntries) {
      y = ensureSpace(doc, y, 14);
      y = writeField(doc, key, String(value), marginX, y, usableW);
    }
  }

  y = ensureSpace(doc, y, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Evidence notes (${notes.length})`, marginX, y);
  y += 6;

  if (notes.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text("No evidence notes.", marginX, y);
    y += 8;
  } else {
    for (const note of notes) {
      const body = note.body?.trim() || "—";
      const meta = `${authorName(note.authorFirstName, note.authorLastName)} · ${fmtTs(note.createdAt)}${
        note.evidencePhase ? ` · ${note.evidencePhase}` : ""
      }`;
      const bodyLines = doc.splitTextToSize(body, usableW);
      y = ensureSpace(doc, y, 10 + bodyLines.length * 5);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(90, 90, 90);
      doc.text(meta, marginX, y);
      y += 4;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(20, 20, 20);
      doc.text(bodyLines, marginX, y);
      y += bodyLines.length * 5 + 4;
    }
  }

  y = ensureSpace(doc, y, 16);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(15, 23, 42);
  doc.text(`Attachments (${attachments.length})`, marginX, y);
  y += 6;

  if (attachments.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120, 120, 120);
    doc.text("No attachments.", marginX, y);
    y += 8;
  }

  for (const att of attachments) {
    const meta = `${att.filename} · ${authorName(att.uploadedByFirstName, att.uploadedByLastName)} · ${fmtTs(att.createdAt)}${
      att.evidencePhase ? ` · ${att.evidencePhase}` : ""
    }`;
    y = ensureSpace(doc, y, 12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(90, 90, 90);
    const metaLines = doc.splitTextToSize(meta, usableW);
    doc.text(metaLines, marginX, y);
    y += metaLines.length * 4 + 2;

    const image = att.mimeType?.startsWith("image/")
      ? await loadImageDataUrl(att.url)
      : null;

    if (image) {
      const maxImgW = usableW;
      const maxImgH = 90;
      const aspect = image.w / Math.max(image.h, 1);
      let drawW = maxImgW;
      let drawH = drawW / aspect;
      if (drawH > maxImgH) {
        drawH = maxImgH;
        drawW = drawH * aspect;
      }
      y = ensureSpace(doc, y, drawH + 6);
      try {
        doc.addImage(image.dataUrl, image.format, marginX, y, drawW, drawH);
        y += drawH + 6;
      } catch {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.setTextColor(120, 120, 120);
        doc.text("(Image could not be embedded)", marginX, y);
        y += 6;
      }
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(60, 60, 60);
      const urlLines = doc.splitTextToSize(att.url, usableW);
      y = ensureSpace(doc, y, urlLines.length * 4 + 4);
      doc.text(urlLines, marginX, y);
      y += urlLines.length * 4 + 6;
    }
  }

  const safeName = incidentNumber.replace(/[^\w.-]+/g, "_");
  doc.save(`OMT-Docket-${safeName}.pdf`);
}
