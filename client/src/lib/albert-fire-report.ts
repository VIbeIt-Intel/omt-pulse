import { Capacitor, registerPlugin } from "@capacitor/core";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export const ALBERT_FPA = "Albert";
export const ALBERT_PROVINCE = "Eastern Cape";
export const ALBERT_MUNICIPALITY = "Gariep / Joe Quabi";

const DRAFT_KEY = "omt_brandverslag_draft";

export type DamageCell = {
  injury: string;
  damage: string;
  area: string;
  loss: string;
};

export type FireReportDraft = {
  reportBy: string;
  contact: string;
  reportDate: string;
  fireDate: string;
  fireTime: string;
  duration: string;
  cause: string;
  properties: string;
  responders: string;
  resources: string;
  livestock: DamageCell;
  buildings: DamageCell;
  grazing: DamageCell;
  equipment: DamageCell;
  saps: "" | "yes" | "no";
  caseNumber: string;
  reportingPerson: string;
  signatory: string;
  signDate: string;
  signature: string;
};

function emptyDamage(): DamageCell {
  return { injury: "", damage: "", area: "", loss: "" };
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export function timeIso(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function blankFireReport(opts?: {
  name?: string;
  contact?: string;
  fireAt?: string | null;
}): FireReportDraft {
  const today = todayIso();
  const fireDay = opts?.fireAt ? opts.fireAt.slice(0, 10) : today;
  return {
    reportBy: opts?.name ?? "",
    contact: opts?.contact ?? "",
    reportDate: today,
    fireDate: /^\d{4}-\d{2}-\d{2}$/.test(fireDay) ? fireDay : today,
    fireTime: timeIso(opts?.fireAt),
    duration: "",
    cause: "",
    properties: "",
    responders: "",
    resources: "",
    livestock: emptyDamage(),
    buildings: emptyDamage(),
    grazing: emptyDamage(),
    equipment: emptyDamage(),
    saps: "",
    caseNumber: "",
    reportingPerson: opts?.name ?? "",
    signatory: "",
    signDate: today,
    signature: "",
  };
}

export function loadFireReport(): FireReportDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FireReportDraft;
    if (!parsed || typeof parsed !== "object" || !parsed.livestock) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveFireReport(draft: FireReportDraft) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* the phone may refuse a large signature */ }
}

function showDate(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso.trim();
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

type ReportLang = "af" | "en";

const GREEN: [number, number, number] = [0, 96, 57];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [71, 85, 105];

const REPORT_COPY = {
  af: {
    association: "Brandbeskermingsvereniging",
    title: "Brandverslag",
    fpa: "Naam van FPA",
    province: "Provinsie",
    municipality: "Munisipaliteit",
    date: "Datum",
    by: "Verslag deur",
    contact: "Kontaknommer",
    details: "Vuurbesonderhede",
    fireDate: "Datum vuur aangemeld",
    time: "Tyd",
    duration: "Hoe lank het dit gebrand",
    cause: "Oorsaak van die vuur",
    properties: "Eiendomme wat gebrand het",
    responders: "Mense op die toneel",
    resources: "Hulpbronne gebruik",
    loss: "Skade",
    injury: "Beserings of sterftes",
    damage: "Skade of verlies",
    area: "Oppervlakte (ha)",
    estimated: "Geskatte verlies (R)",
    livestock: "Vee",
    buildings: "Geboue",
    grazing: "Weiding",
    equipment: "Toerusting",
    saps: "By die polisie aangemeld",
    yes: "Ja",
    no: "Nee",
    unanswered: "Nie aangedui nie",
    caseNumber: "Saaknommer",
    reporter: "Persoon wat verslag doen",
    sign: "Handtekening van die FPO of voorsitter",
    signDate: "Datum van handtekening",
    footer: "Albert FPA  ·  Brandverslag  ·  Vertroulik",
  },
  en: {
    association: "Fire Protection Association",
    title: "Incident report",
    fpa: "Name of FPA",
    province: "Province",
    municipality: "Municipality",
    date: "Date",
    by: "Report by",
    contact: "Contact number",
    details: "Fire details",
    fireDate: "Date fire reported",
    time: "Time",
    duration: "How long it burned",
    cause: "Cause of the fire",
    properties: "Properties burnt",
    responders: "People at the scene",
    resources: "Resources used",
    loss: "Damage",
    injury: "Injuries or deaths",
    damage: "Damage or loss",
    area: "Area burnt (ha)",
    estimated: "Estimated loss (R)",
    livestock: "Livestock",
    buildings: "Buildings",
    grazing: "Grazing",
    equipment: "Equipment",
    saps: "Reported to the police",
    yes: "Yes",
    no: "No",
    unanswered: "Not stated",
    caseNumber: "Case number",
    reporter: "Reporting person",
    sign: "Signature of the FPO or chairperson",
    signDate: "Date of signature",
    footer: "Albert FPA  ·  Incident report  ·  Confidential",
  },
} as const;

function paintFooter(doc: jsPDF, text: string) {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.4);
    doc.line(14, 284, 196, 284);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(text, 14, 290);
    doc.text(`${page} / ${pages}`, 196, 290, { align: "right" });
  }
}

function section(doc: jsPDF, title: string, y: number): number {
  doc.setFillColor(...GREEN);
  doc.rect(14, y, 182, 7, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(255, 255, 255);
  doc.text(title.toUpperCase(), 17, y + 4.8);
  doc.setTextColor(...INK);
  return y + 12;
}

function field(doc: jsPDF, label: string, value: string, x: number, y: number, width: number): number {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text(label, x, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  const text = value.trim() || "—";
  const lines = doc.splitTextToSize(text, width);
  doc.text(lines, x, y + 5);
  return y + 8 + lines.length * 5;
}

export function buildAlbertFireReport(draft: FireReportDraft, lang: ReportLang = "af"): jsPDF {
  const t = REPORT_COPY[lang];
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const x = 14;
  const width = 182;

  doc.setFillColor(...GREEN);
  doc.rect(0, 0, 210, 32, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("ALBERT", x, 13);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(t.association, x, 19);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(t.title.toUpperCase(), 196, 16, { align: "right" });
  doc.setTextColor(...INK);

  let y = 42;
  y = field(doc, t.fpa, ALBERT_FPA, x, y, 58);
  const metaY = 42;
  field(doc, t.province, ALBERT_PROVINCE, 78, metaY, 58);
  field(doc, t.municipality, ALBERT_MUNICIPALITY, 140, metaY, 56);
  y = Math.max(y, field(doc, t.date, showDate(draft.reportDate), 140, metaY + 16, 56));
  field(doc, t.by, draft.reportBy, x, metaY + 16, 60);
  y = Math.max(y, field(doc, t.contact, draft.contact, 78, metaY + 16, 58));
  y += 4;

  y = section(doc, t.details, y);
  const fireRow = y;
  y = Math.max(
    field(doc, t.fireDate, showDate(draft.fireDate), x, fireRow, 88),
    field(doc, t.time, draft.fireTime, 110, fireRow, 70),
  );
  y = field(doc, t.duration, draft.duration, x, y, width);
  y = field(doc, t.cause, draft.cause, x, y, width);
  y = field(doc, t.properties, draft.properties, x, y, width);
  y = field(doc, t.responders, draft.responders, x, y, width);
  y = field(doc, t.resources, draft.resources, x, y, width);
  y += 2;

  y = section(doc, t.loss, y);
  const row = (label: string, cell: DamageCell) => [
    label,
    cell.injury.trim() || "—",
    cell.damage.trim() || "—",
    cell.area.trim() || "—",
    cell.loss.trim() || "—",
  ];
  autoTable(doc, {
    startY: y,
    margin: { left: x, right: x },
    head: [["", t.injury, t.damage, t.area, t.estimated]],
    body: [
      row(t.livestock, draft.livestock),
      row(t.buildings, draft.buildings),
      row(t.grazing, draft.grazing),
      row(t.equipment, draft.equipment),
    ],
    styles: { font: "helvetica", fontSize: 8, cellPadding: 2, textColor: INK, lineColor: [226, 232, 240], lineWidth: 0.1 },
    headStyles: { fillColor: GREEN, textColor: 255, fontStyle: "bold" },
    columnStyles: { 0: { fontStyle: "bold", cellWidth: 28 } },
    alternateRowStyles: { fillColor: [244, 241, 234] },
  });
  y = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 36;
  y += 8;
  if (y > 230) {
    doc.addPage();
    y = 18;
  }

  const saps = draft.saps === "yes" ? t.yes : draft.saps === "no" ? t.no : t.unanswered;
  y = field(doc, t.saps, saps, x, y, width);
  if (draft.saps === "yes") y = field(doc, t.caseNumber, draft.caseNumber, x, y, width);
  y = field(doc, t.reporter, draft.reportingPerson, x, y, width);
  y = field(doc, t.sign, draft.signatory, x, y, width);
  if (draft.signature.startsWith("data:image")) {
    try {
      const format = draft.signature.includes("image/jpeg") ? "JPEG" : "PNG";
      doc.setDrawColor(226, 232, 240);
      doc.rect(x, y, 78, 26);
      doc.addImage(draft.signature, format, x + 2, y + 2, 74, 22);
      y += 30;
    } catch { /* a bad signature must not block the report */ }
  }
  field(doc, t.signDate, showDate(draft.signDate), x, y, 70);
  paintFooter(doc, t.footer);
  return doc;
}

export function fireReportFilename(draft: FireReportDraft): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(draft.fireDate) ? draft.fireDate : todayIso();
  return `Albert-brandverslag-${day}.pdf`;
}

type PdfDelivery = {
  deliverPdf(options: { filename: string; data: string; action: "save" | "print" | "share" }): Promise<{ saved: boolean }>;
};

const PdfDelivery = registerPlugin<PdfDelivery>("OmtAppSettings");

function pdfBase64(doc: jsPDF): string {
  const uri = doc.output("datauristring");
  const comma = uri.indexOf(",");
  return comma >= 0 ? uri.slice(comma + 1) : uri;
}

/** On the phone, write the PDF into Downloads. The browser still uses a normal download. */
async function deliverFireReport(
  draft: FireReportDraft,
  lang: ReportLang,
  action: "save" | "print" | "share",
): Promise<"shared" | "saved"> {
  saveFireReport(draft);
  const doc = buildAlbertFireReport(draft, lang);
  const filename = fireReportFilename(draft);
  if (Capacitor.isNativePlatform() && Capacitor.isPluginAvailable("OmtAppSettings")) {
    await PdfDelivery.deliverPdf({ filename, data: pdfBase64(doc), action });
    return action === "share" ? "shared" : "saved";
  }
  if (action === "print") {
    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const frame = document.createElement("iframe");
    frame.setAttribute("style", "position:fixed;width:0;height:0;border:0");
    frame.src = url;
    document.body.appendChild(frame);
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      window.setTimeout(() => {
        frame.remove();
        URL.revokeObjectURL(url);
      }, 60_000);
    };
    return "saved";
  }
  if (action === "share" && typeof navigator.share === "function") {
    const file = new File([doc.output("blob")], filename, { type: "application/pdf" });
    const canShareFiles = typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] });
    if (canShareFiles) {
      try {
        await navigator.share({ files: [file], title: filename });
        return "shared";
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return "shared";
      }
    }
  }
  doc.save(filename);
  return "saved";
}

export function downloadFireReport(draft: FireReportDraft, lang: ReportLang = "af") {
  return deliverFireReport(draft, lang, "save");
}

export function printFireReport(draft: FireReportDraft, lang: ReportLang = "af") {
  return deliverFireReport(draft, lang, "print");
}

export function forwardFireReport(draft: FireReportDraft, lang: ReportLang = "af") {
  return deliverFireReport(draft, lang, "share");
}
