import jsPDF from "jspdf";
import type {
  AttachmentWithUploader,
  Category,
  EvidenceNoteWithAuthor,
  FormField,
  Location,
} from "@shared/schema";
import intelafriLogo from "@assets/IntelAfri_Logo_13_January_2025_2_1778851888379.png";
import {
  INVOLVEMENT_FIELD_KEYS,
  parsePersons,
  parseVehicles,
} from "@/components/incident-involvement-section";
import { isSapsFormField } from "@/components/incident-saps-section";
import {
  getReporterDisplayName,
  resolveEffectiveSeverity,
  type IncidentWithMeta,
} from "@/lib/incident-display";
import { workstationAuthHeaders } from "@/lib/workstation-session";

type DocketOpts = {
  incident: IncidentWithMeta;
  incidentNumber: string;
  category?: Category | null;
  locationLabel: string;
  locations: Location[];
  lang: DocketLang;
};

type ResponderRow = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  joinedAt: string;
  leftAt: string | null;
  arrivedAt: string | null;
  arrivalNote: string | null;
  lastLat: number | null;
  lastLng: number | null;
  lastPositionAt: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
};

type CommandRow = { id: number; name: string };

type Field = { label: string; value: string; wide?: boolean };

const GREEN: [number, number, number] = [0, 96, 57];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [100, 116, 139];
const MARGIN = 14;
const FOOTER_Y = 288;

export type DocketLang = "en" | "af";

const DOCKET_COPY = {
  en: {
    title: "Incident docket",
    incidentWord: "Incident",
    generated: "Generated",
    by: "by",
    controlRoom: "Control room",
    status: "Status",
    severity: "Severity",
    date: "Date",
    time: "Time",
    reportedBy: "Reported by",
    category: "Category",
    uncategorised: "Uncategorised",
    categoryNote: "Category note",
    escalated: "Escalated",
    stillLive: "Still live",
    yes: "Yes",
    no: "No",
    recordedInSystem: "Recorded in system",
    recordId: "Record id",
    command: "Command",
    importBatch: "Import batch",
    description: "Description",
    place: "Place",
    location: "Location",
    siteAddress: "Site address",
    sitePhone: "Site telephone",
    incidentCoords: "Incident coordinates",
    siteCoords: "Site coordinates",
    customMapPin: "Custom map pin",
    markedOnMap: "Marked on custom map",
    liveTimeline: "Live timeline",
    liveStarted: "Live started",
    responderArrived: "Responder arrived",
    responseTime: "Response time",
    origin: "Origin",
    destination: "Destination",
    closed: "Closed",
    endType: "End type",
    manuallyClosed: "Manually closed",
    converted: "Converted to incident",
    closedBy: "Closed by",
    totalDuration: "Total duration",
    locationAtSubmission: "Location at submission",
    closedFrom: "Closed from",
    panicAcknowledged: "Panic acknowledged",
    panicClosed: "Panic closed",
    lastResponderPosition: "Last responder position",
    updated: "Updated",
    responders: "Responders",
    noResponders: "No responders joined this incident.",
    joined: "Joined",
    arrived: "Arrived",
    notArrived: "Not marked arrived",
    left: "Left",
    stillOnIncident: "Still on the incident when this docket was made",
    timeOnIncident: "Time on incident",
    arrivalNote: "Arrival note",
    lastPosition: "Last position",
    theirDestination: "Their destination",
    people: "People involved",
    vehicles: "Vehicles involved",
    noneRecorded: "None recorded.",
    role: "Role",
    name: "Name",
    gender: "Gender",
    approxAge: "Approximate age",
    type: "Type",
    colour: "Colour",
    registration: "Registration",
    recordedNoDetail: "Recorded, no further detail",
    additionalFields: "Additional fields",
    sceneEvidence: "Scene evidence",
    supplementaryEvidence: "Supplementary evidence",
    otherEvidence: "Other evidence",
    note: "Note",
    endOfDocket: "End of docket",
    closing: "This docket was taken from the OMT Pulse control-room record at the time it was generated. It includes the incident details, place, live timeline, responders, people, vehicles, SAPS fields, notes and photographs held on that record. Times are shown in the local time of the computer that created this file.",
    footer: "OMT Pulse  ·  Incident docket  ·  Confidential",
    unknown: "Unknown",
    imageFailed: "(Image could not be embedded)",
    statusPanicClosed: "Panic — closed",
    statusLiveActive: "Live — active",
    statusLiveEnded: "Live — ended",
    statusLiveOpen: "Live — open",
    statusRecorded: "Recorded",
    severityRed: "Red",
    severityOrange: "Orange",
    severityYellow: "Yellow",
    hour: "hour",
    hours: "hours",
    minute: "minute",
    minutes: "minutes",
    second: "second",
    seconds: "seconds",
    commandPrefix: "Command",
    toastTitle: "Docket downloaded",
    toastBody: "PDF saved with the full incident record.",
    toastFail: "Docket failed",
    toastFailBody: "Could not generate the docket PDF.",
  },
  af: {
    title: "Voorvaldokket",
    incidentWord: "Voorval",
    generated: "Opgestel",
    by: "deur",
    controlRoom: "Beheerkamer",
    status: "Status",
    severity: "Ernst",
    date: "Datum",
    time: "Tyd",
    reportedBy: "Aangemeld deur",
    category: "Kategorie",
    uncategorised: "Ongekategoriseer",
    categoryNote: "Kategorienota",
    escalated: "Eskaleer",
    stillLive: "Steeds lewendig",
    yes: "Ja",
    no: "Nee",
    recordedInSystem: "In stelsel aangeteken",
    recordId: "Rekordnommer",
    command: "Groep",
    importBatch: "Invoerlopie",
    description: "Beskrywing",
    place: "Plek",
    location: "Ligging",
    siteAddress: "Perseeladres",
    sitePhone: "Perseeltelefoon",
    incidentCoords: "Voorvalkoördinate",
    siteCoords: "Perseelkoördinate",
    customMapPin: "Eie kaartpen",
    markedOnMap: "Op eie kaart gemerk",
    liveTimeline: "Lewendige tydlyn",
    liveStarted: "Lewendig begin",
    responderArrived: "Reageerder het aangekom",
    responseTime: "Reaksietyd",
    origin: "Oorsprong",
    destination: "Bestemming",
    closed: "Gesluit",
    endType: "Afsluiting",
    manuallyClosed: "Met die hand gesluit",
    converted: "Omgeskakel na voorval",
    closedBy: "Gesluit deur",
    totalDuration: "Totale duur",
    locationAtSubmission: "Ligging by indiening",
    closedFrom: "Gesluit vanaf",
    panicAcknowledged: "Paniek erken",
    panicClosed: "Paniek gesluit",
    lastResponderPosition: "Laaste reageerderposisie",
    updated: "Opgedateer",
    responders: "Reageerders",
    noResponders: "Geen reageerders het by hierdie voorval aangesluit nie.",
    joined: "Aangesluit",
    arrived: "Aangekom",
    notArrived: "Nie as aangekom gemerk nie",
    left: "Weg",
    stillOnIncident: "Nog op die voorval toe hierdie dokket gemaak is",
    timeOnIncident: "Tyd op die voorval",
    arrivalNote: "Aankomsnota",
    lastPosition: "Laaste posisie",
    theirDestination: "Hulle bestemming",
    people: "Mense betrokke",
    vehicles: "Voertuie betrokke",
    noneRecorded: "Niks aangeteken nie.",
    role: "Rol",
    name: "Naam",
    gender: "Geslag",
    approxAge: "Geskatte ouderdom",
    type: "Tipe",
    colour: "Kleur",
    registration: "Registrasie",
    recordedNoDetail: "Aangeteken, geen verdere besonderhede nie",
    additionalFields: "Bykomende velde",
    sceneEvidence: "Toneelbewyse",
    supplementaryEvidence: "Aanvullende bewyse",
    otherEvidence: "Ander bewyse",
    note: "Nota",
    endOfDocket: "Einde van dokket",
    closing: "Hierdie dokket is geneem uit die OMT Pulse-beheerkamerrekord toe dit opgestel is. Dit sluit die voorvalbesonderhede, plek, lewendige tydlyn, reageerders, mense, voertuie, SAPS-velde, notas en foto's op daardie rekord in. Tye word gewys in die plaaslike tyd van die rekenaar wat hierdie lêer gemaak het.",
    footer: "OMT Pulse  ·  Voorvaldokket  ·  Vertroulik",
    unknown: "Onbekend",
    imageFailed: "(Foto kon nie ingesluit word nie)",
    statusPanicClosed: "Paniek — gesluit",
    statusLiveActive: "Lewendig — aktief",
    statusLiveEnded: "Lewendig — geëindig",
    statusLiveOpen: "Lewendig — oop",
    statusRecorded: "Aangeteken",
    severityRed: "Rooi",
    severityOrange: "Oranje",
    severityYellow: "Geel",
    hour: "uur",
    hours: "ure",
    minute: "minuut",
    minutes: "minute",
    second: "sekonde",
    seconds: "sekondes",
    commandPrefix: "Groep",
    toastTitle: "Dokket afgelaai",
    toastBody: "PDF gestoor met die volle voorvalrekord.",
    toastFail: "Dokket het misluk",
    toastFailBody: "Kon nie die dokket-PDF maak nie.",
  },
} as const;

type DocketCopy = (typeof DOCKET_COPY)[DocketLang];

export function docketCopy(lang: DocketLang): DocketCopy {
  return DOCKET_COPY[lang];
}

function fmtTs(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString();
}

function fmtDuration(from: string | Date, to: string | Date, t: DocketCopy): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours} ${hours === 1 ? t.hour : t.hours}`);
  if (mins > 0) parts.push(`${mins} ${mins === 1 ? t.minute : t.minutes}`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs} ${secs === 1 ? t.second : t.seconds}`);
  return parts.join(" ");
}

function fmtBytes(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function coordText(lat: number | null | undefined, lng: number | null | undefined): string | null {
  if (lat == null || lng == null) return null;
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (Math.abs(la) < 0.00001 && Math.abs(ln) < 0.00001) return null;
  return `${la.toFixed(6)}, ${ln.toFixed(6)}\nhttps://maps.google.com/?q=${la.toFixed(6)},${ln.toFixed(6)}`;
}

function authorName(first: string | null | undefined, last: string | null | undefined, t: DocketCopy): string {
  return `${first ?? ""} ${last ?? ""}`.trim() || t.unknown;
}

function humanKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
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

async function fetchOptional<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      credentials: "include",
      cache: "no-store",
      headers: workstationAuthHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadImageDataUrl(
  url: string,
): Promise<{ dataUrl: string; format: "JPEG" | "PNG"; w: number; h: number } | null> {
  try {
    let dataUrl = url;
    let mime = "";
    if (!url.startsWith("data:")) {
      const res = await fetch(url, { credentials: "include", cache: "no-store" });
      if (!res.ok) return null;
      const blob = await res.blob();
      mime = blob.type;
      if (mime && !mime.startsWith("image/")) return null;
      if (mime.includes("webp") || mime.includes("gif")) return null;
      dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(blob);
      });
    } else {
      mime = url.slice(5, url.indexOf(";"));
      if (mime.includes("webp") || mime.includes("gif")) return null;
    }
    const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => reject(new Error("decode failed"));
      img.src = dataUrl;
    });
    const format: "JPEG" | "PNG" = mime.includes("png") || dataUrl.includes("image/png") ? "PNG" : "JPEG";
    return { dataUrl, format, ...dims };
  } catch {
    return null;
  }
}

function pageBottom(doc: jsPDF): number {
  return doc.internal.pageSize.getHeight() - 16;
}

function paintRunningHeader(doc: jsPDF, incidentNumber: string, t: DocketCopy) {
  const pageW = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...GREEN);
  doc.text("OMT PULSE", MARGIN, 10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(`${t.incidentWord} ${incidentNumber}`, MARGIN + 24, 10);
  doc.setDrawColor(...GREEN);
  doc.setLineWidth(0.35);
  doc.line(MARGIN, 12.5, pageW - MARGIN, 12.5);
}

function ensureSpace(doc: jsPDF, y: number, need: number, incidentNumber: string, t: DocketCopy): number {
  if (y + need <= pageBottom(doc)) return y;
  doc.addPage();
  paintRunningHeader(doc, incidentNumber, t);
  return 18;
}

function fieldBlockHeight(doc: jsPDF, value: string, maxW: number): number {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const lines = doc.splitTextToSize(value || "—", maxW);
  return 3.6 + lines.length * 4.2 + 3.2;
}

function paintField(doc: jsPDF, label: string, value: string, x: number, y: number, maxW: number): void {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...MUTED);
  doc.text(label.toUpperCase(), x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...INK);
  const lines = doc.splitTextToSize(value || "—", maxW);
  doc.text(lines, x, y + 4.2);
}

function paintFields(doc: jsPDF, y: number, fields: Field[], incidentNumber: string, t: DocketCopy): number {
  const pageW = doc.internal.pageSize.getWidth();
  const usable = pageW - MARGIN * 2;
  const gap = 6;
  const colW = (usable - gap) / 2;
  let pending: Field | null = null;

  const flushPair = (left: Field, right: Field | null) => {
    const leftH = fieldBlockHeight(doc, left.value, right ? colW : usable);
    const rightH = right ? fieldBlockHeight(doc, right.value, colW) : 0;
    const h = Math.max(leftH, rightH);
    y = ensureSpace(doc, y, h, incidentNumber, t);
    paintField(doc, left.label, left.value, MARGIN, y, right ? colW : usable);
    if (right) paintField(doc, right.label, right.value, MARGIN + colW + gap, y, colW);
    y += h;
  };

  for (const field of fields) {
    const wide = field.wide || field.value.length > 70 || field.value.includes("\n");
    if (wide) {
      if (pending) {
        flushPair(pending, null);
        pending = null;
      }
      flushPair(field, null);
      continue;
    }
    if (pending) {
      flushPair(pending, field);
      pending = null;
    } else {
      pending = field;
    }
  }
  if (pending) flushPair(pending, null);
  return y;
}

function paintSection(doc: jsPDF, y: number, title: string, incidentNumber: string, t: DocketCopy): number {
  y = ensureSpace(doc, y, 16, incidentNumber, t);
  y += 3;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...GREEN);
  doc.text(title.toUpperCase(), MARGIN, y);
  const pageW = doc.internal.pageSize.getWidth();
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, y + 1.6, pageW - MARGIN, y + 1.6);
  return y + 7;
}

function paintParagraph(doc: jsPDF, y: number, text: string, incidentNumber: string, t: DocketCopy, color = MUTED): number {
  const pageW = doc.internal.pageSize.getWidth();
  const usable = pageW - MARGIN * 2;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(text, usable);
  y = ensureSpace(doc, y, lines.length * 4 + 2, incidentNumber, t);
  doc.setTextColor(...color);
  doc.text(lines, MARGIN, y);
  return y + lines.length * 4 + 2;
}

async function paintImage(
  doc: jsPDF,
  y: number,
  image: { dataUrl: string; format: "JPEG" | "PNG"; w: number; h: number },
  incidentNumber: string,
  t: DocketCopy,
): Promise<number> {
  const pageW = doc.internal.pageSize.getWidth();
  const maxW = pageW - MARGIN * 2;
  const maxH = 95;
  const aspect = image.w / Math.max(image.h, 1);
  let drawW = maxW;
  let drawH = drawW / aspect;
  if (drawH > maxH) {
    drawH = maxH;
    drawW = drawH * aspect;
  }
  y = ensureSpace(doc, y, drawH + 4, incidentNumber, t);
  try {
    doc.addImage(image.dataUrl, image.format, MARGIN, y, drawW, drawH);
    return y + drawH + 5;
  } catch {
    return paintParagraph(doc, y, t.imageFailed, incidentNumber, t);
  }
}

function severityLabel(severity: string | null, t: DocketCopy): string {
  if (severity === "red") return t.severityRed;
  if (severity === "orange") return t.severityOrange;
  if (severity === "yellow") return t.severityYellow;
  if (!severity) return "—";
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

function statusOf(incident: IncidentWithMeta, t: DocketCopy): string {
  if (incident.panicClosedAt) return `${t.statusPanicClosed} ${fmtTs(incident.panicClosedAt)}`;
  if (incident.isLive) return t.statusLiveActive;
  if (incident.liveStartedAt && incident.liveEndedAt) return t.statusLiveEnded;
  if (incident.liveStartedAt) return t.statusLiveOpen;
  return t.statusRecorded;
}

function push(fields: Field[], label: string, value: string | null | undefined, wide = false) {
  const text = value?.trim();
  if (!text) return;
  fields.push({ label, value: text, wide });
}

/**
 * Build and download a printable incident docket PDF.
 * Includes the control-room record, live timeline, people, vehicles, notes and photos.
 */
export async function downloadIncidentDocket(opts: DocketOpts): Promise<void> {
  const { incident, incidentNumber, category, locationLabel, locations, lang } = opts;
  const t = docketCopy(lang);
  const [attachments, notes, responders, formFields, commands, me] = await Promise.all([
    fetchJson<AttachmentWithUploader[]>(`/api/incidents/${incident.id}/attachments`),
    fetchJson<EvidenceNoteWithAuthor[]>(`/api/incidents/${incident.id}/evidence-notes`),
    fetchOptional<ResponderRow[]>(`/api/incidents/${incident.id}/responders`),
    fetchOptional<FormField[]>("/api/form-fields"),
    fetchOptional<CommandRow[]>("/api/commands"),
    fetchOptional<{ orgName?: string | null; firstName?: string | null; lastName?: string | null }>("/api/auth/me"),
  ]);

  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  let y = 12;

  let logoData: string | null = null;
  try {
    const logoRes = await fetch(intelafriLogo);
    if (logoRes.ok) {
      const blob = await logoRes.blob();
      logoData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("logo"));
        reader.readAsDataURL(blob);
      });
    }
  } catch {
    logoData = null;
  }
  if (logoData) {
    try {
      doc.addImage(logoData, "PNG", MARGIN, y, 38, 16);
    } catch {
      /* letterhead still stands without the image */
    }
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(...GREEN);
  doc.text("OMT PULSE", MARGIN + 44, y + 6);
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  doc.text(t.title, MARGIN + 44, y + 13);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(`${t.incidentWord} ${incidentNumber}`, MARGIN, y);
  y += 6;

  const orgName = me?.orgName?.trim() || "—";
  const generatedBy = `${me?.firstName ?? ""} ${me?.lastName ?? ""}`.trim() || t.controlRoom;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const meta = doc.splitTextToSize(
    `${orgName}   ·   ${t.generated} ${new Date().toLocaleString()} ${t.by} ${generatedBy}`,
    pageW - MARGIN * 2,
  );
  doc.text(meta, MARGIN, y);
  y += meta.length * 4 + 2;

  doc.setFillColor(...GREEN);
  doc.rect(MARGIN, y, pageW - MARGIN * 2, 1.1, "F");
  y += 7;

  const severity = resolveEffectiveSeverity(incident, category);
  const reporter = getReporterDisplayName(incident) ?? t.unknown;
  const site = incident.locationId != null ? locations.find((l) => l.id === incident.locationId) : undefined;
  const commandName = incident.commandId != null
    ? commands?.find((c) => c.id === incident.commandId)?.name ?? `${t.commandPrefix} ${incident.commandId}`
    : null;

  const record: Field[] = [
    { label: t.status, value: statusOf(incident, t) },
    { label: t.severity, value: severityLabel(severity, t) },
    { label: t.date, value: incident.incidentDate || "—" },
    { label: t.time, value: incident.incidentTime || "—" },
    { label: t.reportedBy, value: reporter },
    { label: t.category, value: category?.name ?? t.uncategorised },
  ];
  push(record, t.categoryNote, incident.otherCategoryNote);
  record.push(
    { label: t.escalated, value: incident.isEscalated ? t.yes : t.no },
    { label: t.stillLive, value: incident.isLive ? t.yes : t.no },
    { label: t.recordedInSystem, value: fmtTs(incident.createdAt) },
    { label: t.recordId, value: String(incident.id) },
  );
  push(record, t.command, commandName);
  push(record, t.importBatch, incident.importBatchId != null ? String(incident.importBatchId) : null);
  record.push({ label: t.description, value: incident.description?.trim() || "—", wide: true });

  y = paintFields(doc, y, record, incidentNumber, t);

  const place: Field[] = [];
  push(place, t.location, locationLabel && locationLabel !== "-" ? locationLabel : incident.locationName);
  push(place, t.siteAddress, site?.address);
  push(place, t.sitePhone, site?.phone);
  push(place, t.incidentCoords, coordText(incident.latitude, incident.longitude), true);
  if (site && (site.latitude != null || site.longitude != null)) {
    push(place, t.siteCoords, coordText(site.latitude, site.longitude), true);
  }
  if (incident.customMapId != null) {
    const pin = [incident.customMapX, incident.customMapY].filter((n) => n != null).join(", ");
    push(place, t.customMapPin, pin || t.markedOnMap);
  }
  if (place.length > 0) {
    y = paintSection(doc, y, t.place, incidentNumber, t);
    y = paintFields(doc, y, place, incidentNumber, t);
  }

  const live: Field[] = [];
  if (incident.liveStartedAt) push(live, t.liveStarted, fmtTs(incident.liveStartedAt));
  if (incident.responderArrivedAt) push(live, t.responderArrived, fmtTs(incident.responderArrivedAt));
  if (incident.liveStartedAt && incident.responderArrivedAt) {
    push(live, t.responseTime, fmtDuration(incident.liveStartedAt, incident.responderArrivedAt, t));
  }
  push(live, t.origin, coordText(incident.liveStartLat, incident.liveStartLng), true);
  if (incident.destinationName?.trim() || coordText(incident.destinationLat, incident.destinationLng)) {
    const destCoord = coordText(incident.destinationLat, incident.destinationLng);
    push(
      live,
      t.destination,
      [incident.destinationName?.trim(), destCoord].filter(Boolean).join("\n"),
      true,
    );
  }
  if (incident.liveEndedAt) push(live, t.closed, fmtTs(incident.liveEndedAt));
  if (incident.liveEndedAt) {
    push(live, t.endType, incident.liveClosedManually ? t.manuallyClosed : t.converted);
  }
  push(live, t.closedBy, incident.closedByName);
  if (incident.liveStartedAt && incident.liveEndedAt) {
    push(live, t.totalDuration, fmtDuration(incident.liveStartedAt, incident.liveEndedAt, t));
  }
  if (incident.liveEndedAt && !incident.liveClosedManually) {
    push(live, t.locationAtSubmission, coordText(incident.liveConvertLat, incident.liveConvertLng), true);
  }
  if (incident.liveEndedAt && incident.liveClosedManually) {
    push(live, t.closedFrom, coordText(incident.liveEndLat, incident.liveEndLng), true);
  }
  if (incident.panicAcknowledgedAt) push(live, t.panicAcknowledged, fmtTs(incident.panicAcknowledgedAt));
  if (incident.panicClosedAt) push(live, t.panicClosed, fmtTs(incident.panicClosedAt));
  if (incident.responderLat != null && incident.responderLng != null) {
    const when = incident.responderPositionUpdatedAt ? `${t.updated} ${fmtTs(incident.responderPositionUpdatedAt)}` : null;
    push(
      live,
      t.lastResponderPosition,
      [coordText(incident.responderLat, incident.responderLng), when].filter(Boolean).join("\n"),
      true,
    );
  }
  if (live.length > 0) {
    y = paintSection(doc, y, t.liveTimeline, incidentNumber, t);
    y = paintFields(doc, y, live, incidentNumber, t);
  }

  const responderRows = responders ?? [];
  y = paintSection(doc, y, `${t.responders} (${responderRows.length})`, incidentNumber, t);
  if (responderRows.length === 0) {
    y = paintParagraph(doc, y, t.noResponders, incidentNumber, t);
  }
  for (const row of responderRows) {
    const bits: string[] = [
      `${t.joined} ${fmtTs(row.joinedAt)}`,
      row.arrivedAt ? `${t.arrived} ${fmtTs(row.arrivedAt)}` : t.notArrived,
      row.leftAt ? `${t.left} ${fmtTs(row.leftAt)}` : t.stillOnIncident,
    ];
    if (row.joinedAt && row.leftAt) bits.push(`${t.timeOnIncident} ${fmtDuration(row.joinedAt, row.leftAt, t)}`);
    if (row.arrivalNote?.trim()) bits.push(`${t.arrivalNote}: ${row.arrivalNote.trim()}`);
    const pos = coordText(row.lastLat, row.lastLng);
    if (pos) bits.push(`${t.lastPosition} ${row.lastPositionAt ? `(${fmtTs(row.lastPositionAt)}) ` : ""}${pos}`);
    if (row.destinationName || coordText(row.destinationLat, row.destinationLng)) {
      bits.push(
        `${t.theirDestination}: ${[row.destinationName?.trim(), coordText(row.destinationLat, row.destinationLng)].filter(Boolean).join(" — ")}`,
      );
    }
    y = paintFields(
      doc,
      y,
      [{ label: authorName(row.firstName, row.lastName, t), value: bits.join("\n"), wide: true }],
      incidentNumber,
      t,
    );
  }

  const custom = (incident.customFields as Record<string, string | number | null> | null) ?? {};
  const labelFor = new Map((formFields ?? []).map((f) => [f.fieldKey, f.label]));

  const persons = parsePersons(custom);
  const vehicles = parseVehicles(custom);
  y = await paintInvolvement(doc, y, t.people, persons, incidentNumber, t, (p) => [
    [t.role, p.role],
    [t.name, p.name],
    [t.gender, p.gender],
    [t.approxAge, p.approxAge],
    [t.description, p.description],
  ], (p) => p.photoUrls);

  y = await paintInvolvement(doc, y, t.vehicles, vehicles, incidentNumber, t, (v) => [
    [t.type, v.type],
    [t.colour, v.colour],
    [t.registration, v.registration],
    [t.description, v.description],
  ], (v) => v.photoUrls);

  const sapsFields = (formFields ?? []).filter((f) => isSapsFormField(f) && !f.isSystem);
  const sapsRows: Field[] = [];
  for (const field of sapsFields) {
    const raw = custom[field.fieldKey];
    if (raw == null || String(raw).trim() === "") continue;
    sapsRows.push({ label: field.label || humanKey(field.fieldKey), value: String(raw), wide: String(raw).length > 70 });
  }
  if (sapsRows.length > 0) {
    y = paintSection(doc, y, "SAPS", incidentNumber, t);
    y = paintFields(doc, y, sapsRows, incidentNumber, t);
  }

  const skipKeys = new Set<string>([
    ...INVOLVEMENT_FIELD_KEYS,
    ...sapsFields.map((f) => f.fieldKey),
  ]);
  const extra: Field[] = [];
  for (const [key, raw] of Object.entries(custom)) {
    if (skipKeys.has(key)) continue;
    if (raw == null || String(raw).trim() === "") continue;
    const value = String(raw);
    if (value.startsWith("[") || value.startsWith("{")) continue;
    extra.push({
      label: labelFor.get(key) || humanKey(key),
      value,
      wide: value.length > 70,
    });
  }
  if (extra.length > 0) {
    y = paintSection(doc, y, t.additionalFields, incidentNumber, t);
    y = paintFields(doc, y, extra, incidentNumber, t);
  }

  y = await paintEvidence(doc, y, t.sceneEvidence, notes, attachments, "scene", incidentNumber, t);
  y = await paintEvidence(doc, y, t.supplementaryEvidence, notes, attachments, "supplementary", incidentNumber, t);
  const unphasedNotes = notes.filter((n) => n.evidencePhase !== "scene" && n.evidencePhase !== "supplementary");
  const unphasedFiles = attachments.filter((a) => a.evidencePhase !== "scene" && a.evidencePhase !== "supplementary");
  if (unphasedNotes.length > 0 || unphasedFiles.length > 0) {
    y = await paintEvidence(doc, y, t.otherEvidence, unphasedNotes, unphasedFiles, null, incidentNumber, t);
  }

  y = paintSection(doc, y, t.endOfDocket, incidentNumber, t);
  y = paintParagraph(doc, y, t.closing, incidentNumber, t, INK);

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(t.footer, MARGIN, FOOTER_Y);
    doc.text(`${i} / ${pages}`, pageW - MARGIN, FOOTER_Y, { align: "right" });
  }

  const safeName = incidentNumber.replace(/[^\w.-]+/g, "_");
  doc.save(`OMT-Docket-${safeName}.pdf`);
}

async function paintInvolvement<T>(
  doc: jsPDF,
  y: number,
  title: string,
  rows: T[],
  incidentNumber: string,
  t: DocketCopy,
  fieldsOf: (row: T) => Array<[string, string]>,
  photosOf: (row: T) => string[],
): Promise<number> {
  y = paintSection(doc, y, `${title} (${rows.length})`, incidentNumber, t);
  if (rows.length === 0) {
    return paintParagraph(doc, y, t.noneRecorded, incidentNumber, t);
  }
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const fields: Field[] = fieldsOf(row)
      .filter(([, value]) => value?.trim())
      .map(([label, value]) => ({ label, value, wide: label === t.description || value.length > 70 }));
    if (fields.length === 0) fields.push({ label: `${title} ${i + 1}`, value: t.recordedNoDetail });
    else fields[0] = { ...fields[0], label: `${i + 1}. ${fields[0].label}` };
    y = paintFields(doc, y, fields, incidentNumber, t);
    const photos = photosOf(row).filter(Boolean);
    for (const url of photos) {
      const image = await loadImageDataUrl(url);
      if (image) y = await paintImage(doc, y, image, incidentNumber, t);
    }
  }
  return y;
}

async function paintEvidence(
  doc: jsPDF,
  y: number,
  title: string,
  notes: EvidenceNoteWithAuthor[],
  attachments: AttachmentWithUploader[],
  phase: "scene" | "supplementary" | null,
  incidentNumber: string,
  t: DocketCopy,
): Promise<number> {
  const phaseNotes = phase == null ? notes : notes.filter((n) => n.evidencePhase === phase);
  const phaseFiles = phase == null ? attachments : attachments.filter((a) => a.evidencePhase === phase);
  y = paintSection(doc, y, `${title} (${phaseNotes.length + phaseFiles.length})`, incidentNumber, t);
  if (phaseNotes.length === 0 && phaseFiles.length === 0) {
    return paintParagraph(doc, y, t.noneRecorded, incidentNumber, t);
  }
  for (const note of phaseNotes) {
    const meta = `${authorName(note.authorFirstName, note.authorLastName, t)} · ${fmtTs(note.createdAt)} · ${t.note}`;
    y = paintFields(
      doc,
      y,
      [{ label: meta, value: note.body?.trim() || "—", wide: true }],
      incidentNumber,
      t,
    );
  }
  for (const att of phaseFiles) {
    const size = fmtBytes(att.byteSize);
    const meta = [
      att.filename,
      authorName(att.uploadedByFirstName, att.uploadedByLastName, t),
      fmtTs(att.createdAt),
      att.mimeType,
      size,
    ].filter(Boolean).join(" · ");
    y = paintParagraph(doc, y + 1, meta, incidentNumber, t);
    const image = att.mimeType?.startsWith("image/") ? await loadImageDataUrl(att.url) : null;
    if (image) {
      y = await paintImage(doc, y, image, incidentNumber, t);
    } else {
      y = paintParagraph(doc, y, att.url, incidentNumber, t, INK);
    }
  }
  return y;
}
