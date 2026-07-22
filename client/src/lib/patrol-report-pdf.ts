import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import type { PatrolReport } from "@/lib/patrol-types";

function fmtTs(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function formatDuration(startedAt: string | Date, endedAt: string | Date | null | undefined): string {
  const start = new Date(startedAt).getTime();
  const end = endedAt ? new Date(endedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return "—";
  const mins = Math.round((end - start) / 60_000);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatDistance(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return "—";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

function safeFilePart(s: string): string {
  return s.replace(/[^\w\-]+/g, "_").replace(/_+/g, "_").slice(0, 48);
}

/** Client-side PDF for a completed patrol history report. */
export async function downloadPatrolReportPdf(report: PatrolReport): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const margin = 16;
  let y = 18;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("OMT Patrol Report", margin, y);
  y += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(report.routeName || "Patrol", margin, y);
  y += 6;
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(
    `${report.startedByName} · ${report.status.replace(/_/g, " ")} · Patrol #${report.id}`,
    margin,
    y,
  );
  doc.setTextColor(0);
  y += 10;

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["Metric", "Value"]],
    body: [
      ["Started", fmtTs(report.startedAt)],
      ["Ended", fmtTs(report.endedAt)],
      ["Duration", formatDuration(report.startedAt, report.endedAt)],
      ["Distance", formatDistance(report.distanceM)],
      ["Checkpoints", `${report.completedCheckpoints}/${report.totalCheckpoints}`],
      ["Track points", String(report.trackPointCount ?? report.trackPoints.length)],
      ["Geofence pass", String(report.geofencePassCount ?? 0)],
      ["Geofence fail", String(report.geofenceFailCount ?? 0)],
    ],
    styles: { fontSize: 9, cellPadding: 2 },
    headStyles: { fillColor: [16, 185, 129], textColor: 255 },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  if (report.warnings.length > 0) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("Warnings", margin, y);
    y += 5;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    for (const w of report.warnings) {
      const lines = doc.splitTextToSize(`• ${w}`, 180);
      doc.text(lines, margin, y);
      y += lines.length * 4.2;
    }
    y += 4;
  }

  const rows = report.checkpoints.map((cp, i) => {
    const log = report.logs.find((l) => l.checkpointId === cp.id);
    return [
      String(i + 1),
      cp.name,
      log ? fmtTs(log.clockedAt) : "Not clocked",
      log?.distanceM != null ? `${Math.round(log.distanceM)} m` : "—",
      log?.withinGeofence === false
        ? "Outside"
        : log?.status === "completed"
          ? "OK"
          : log?.status === "missed"
            ? "Missed"
            : "—",
      log?.latitude != null && log.longitude != null
        ? `${log.latitude.toFixed(5)}, ${log.longitude.toFixed(5)}`
        : "—",
      log?.notes?.trim() || "—",
    ];
  });

  autoTable(doc, {
    startY: y,
    margin: { left: margin, right: margin },
    theme: "grid",
    head: [["#", "Checkpoint", "Clocked", "From pin", "Status", "Clock GPS", "Notes"]],
    body: rows,
    styles: { fontSize: 8, cellPadding: 1.5, overflow: "linebreak" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      0: { cellWidth: 8 },
      1: { cellWidth: 32 },
      2: { cellWidth: 32 },
      3: { cellWidth: 18 },
      4: { cellWidth: 18 },
      5: { cellWidth: 36 },
      6: { cellWidth: 28 },
    },
  });

  y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;
  doc.setFontSize(8);
  doc.setTextColor(100);
  doc.text(
    `Generated ${new Date().toLocaleString()} · Photos are available in the live report view.`,
    margin,
    y,
  );

  const name = safeFilePart(report.routeName || "patrol");
  doc.save(`OMT-Patrol-${report.id}-${name}.pdf`);
}
