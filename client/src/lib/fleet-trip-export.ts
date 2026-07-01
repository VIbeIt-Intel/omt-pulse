import * as XLSX from "xlsx";
import type { TrackerDeviceSummary } from "@/components/operations-dashboard";
import { estimatePathDistanceKm } from "@/components/fleet-history-map";

export type FleetTripPosition = {
  id: number;
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  ignitionOn: boolean | null;
  mileageKm: number | null;
  gpsValid: boolean;
  recordedAt: string;
};

export type FleetTripExportOptions = {
  device: TrackerDeviceSummary;
  vehicleTitle: string;
  periodLabel: string;
  periodKey: string;
  positions: FleetTripPosition[];
};

function slugPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function ignitionLabel(value: boolean | null): string {
  if (value === true) return "On";
  if (value === false) return "Off";
  return "";
}

function sortedPositions(positions: FleetTripPosition[]): FleetTripPosition[] {
  return [...positions].sort(
    (a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime(),
  );
}

function buildSummaryRows(opts: FleetTripExportOptions): (string | number)[][] {
  const points = sortedPositions(opts.positions);
  const speeds = points.map((p) => p.speedKph).filter((s): s is number => s != null);
  const maxSpeed = speeds.length ? Math.max(...speeds) : null;
  const path = points
    .filter((p) => p.gpsValid !== false)
    .map((p) => ({ lat: p.latitude, lng: p.longitude }));
  const distanceKm = estimatePathDistanceKm(path);

  const rows: (string | number)[][] = [
    ["OMT Pulse — Vehicle GPS trip report"],
    [],
    ["Generated", new Date().toLocaleString()],
    ["Period", opts.periodLabel],
    ["Vehicle", opts.vehicleTitle],
    ["Display name", opts.device.label ?? ""],
    ["Make", opts.device.vehicleMake ?? ""],
    ["Model", opts.device.vehicleModel ?? ""],
    ["Registration", opts.device.vehicleRegistration ?? ""],
    ["IMEI", opts.device.imei],
    ["Assigned to", opts.device.assignedUserName ?? ""],
    ["Group", opts.device.commandName ?? ""],
    ["GPS points", points.length],
    ["Max speed (km/h)", maxSpeed != null ? Math.round(maxSpeed) : ""],
    ["Distance estimate (km)", distanceKm != null && distanceKm > 0 ? Number(distanceKm.toFixed(2)) : ""],
    ["Notes", opts.device.notes ?? ""],
    [],
    ["This report is for investigation and audit purposes. Times are recorded from the vehicle tracker device."],
  ];

  return rows;
}

function buildGpsRows(positions: FleetTripPosition[]): (string | number)[][] {
  const header = [
    "Seq",
    "Recorded (local)",
    "Recorded (UTC)",
    "Latitude",
    "Longitude",
    "Speed (km/h)",
    "Heading (°)",
    "Ignition (ACC)",
    "Odometer (km)",
    "GPS valid",
  ];

  const rows = sortedPositions(positions).map((p, index) => {
    const recorded = new Date(p.recordedAt);
    return [
      index + 1,
      recorded.toLocaleString(),
      recorded.toISOString(),
      Number(p.latitude.toFixed(6)),
      Number(p.longitude.toFixed(6)),
      p.speedKph != null ? Math.round(p.speedKph) : "",
      p.heading != null ? Math.round(p.heading) : "",
      ignitionLabel(p.ignitionOn),
      p.mileageKm != null ? Number(p.mileageKm.toFixed(2)) : "",
      p.gpsValid ? "Yes" : "No",
    ];
  });

  return [header, ...rows];
}

function buildCsvContent(opts: FleetTripExportOptions): string {
  const summary = buildSummaryRows(opts);
  const gps = buildGpsRows(opts.positions);

  const escape = (value: string | number) => {
    const text = String(value);
    if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
  };

  const lines: string[] = [];
  for (const row of summary) {
    lines.push(row.map(escape).join(","));
  }
  lines.push("");
  for (const row of gps) {
    lines.push(row.map(escape).join(","));
  }
  return lines.join("\n");
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadFleetTripExcel(opts: FleetTripExportOptions): void {
  if (opts.positions.length === 0) return;

  const summarySheet = XLSX.utils.aoa_to_sheet(buildSummaryRows(opts));
  summarySheet["!cols"] = [{ wch: 28 }, { wch: 48 }];

  const gpsData = buildGpsRows(opts.positions);
  const gpsSheet = XLSX.utils.aoa_to_sheet(gpsData);
  gpsSheet["!cols"] = [
    { wch: 6 },
    { wch: 22 },
    { wch: 24 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 10 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  XLSX.utils.book_append_sheet(workbook, gpsSheet, "GPS points");

  const reg = opts.device.vehicleRegistration?.trim();
  const slug = slugPart(reg || opts.device.imei);
  const filename = `omt-fleet-${slug}-${opts.periodKey}.xlsx`;
  XLSX.writeFile(workbook, filename);
}

export function downloadFleetTripCsv(opts: FleetTripExportOptions): void {
  if (opts.positions.length === 0) return;

  const reg = opts.device.vehicleRegistration?.trim();
  const slug = slugPart(reg || opts.device.imei);
  const filename = `omt-fleet-${slug}-${opts.periodKey}.csv`;
  const blob = new Blob([buildCsvContent(opts)], { type: "text/csv;charset=utf-8" });
  triggerDownload(blob, filename);
}
