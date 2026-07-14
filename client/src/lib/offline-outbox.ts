/**
 * Offline outbox for SOS, Report Incident, and Access Control check-in.
 * IndexedDB so queued media survives app kill (unlike sessionStorage drafts).
 */

import { apiRequest } from "@/lib/queryClient";
import { postPanicAlert, type PanicSendOutcome } from "@/lib/panic-send";
import type { PanicLocationResult } from "@/lib/panic-location";

const DB_NAME = "omt-pulse-outbox";
const DB_VERSION = 1;
const STORE = "jobs";

export type OutboxAttachment = {
  filename: string;
  mimeType: string;
  byteSize?: number;
  /** Already on server (https or /objects/...) */
  url?: string;
  /** File bytes when captured offline */
  dataUrl?: string;
};

export type OutboxIncidentForm = {
  incidentDate: string;
  incidentTime: string;
  locationId?: number | null;
  locationName?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  customMapId?: number | null;
  customMapX?: number | null;
  customMapY?: number | null;
  categoryId?: number | null;
  otherCategoryNote?: string | null;
  description?: string | null;
  customFields?: Record<string, string | number | null> | null;
};

export type OutboxSosJob = {
  id: string;
  type: "sos";
  createdAt: number;
  lat?: number;
  lng?: number;
};

export type OutboxIncidentJob = {
  id: string;
  type: "incident";
  createdAt: number;
  form: OutboxIncidentForm;
  attachments: OutboxAttachment[];
};

export type OutboxAccessControlJob = {
  id: string;
  type: "access_control";
  createdAt: number;
  body: Record<string, unknown>;
};

export type OutboxJob = OutboxSosJob | OutboxIncidentJob | OutboxAccessControlJob;

function newId(): string {
  return `ob_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
  });
}

export async function listOutboxJobs(): Promise<OutboxJob[]> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => {
        const jobs = (req.result as OutboxJob[]) ?? [];
        jobs.sort((a, b) => a.createdAt - b.createdAt);
        resolve(jobs);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function countOutboxJobs(): Promise<number> {
  const jobs = await listOutboxJobs();
  return jobs.length;
}

export async function enqueueOutboxJob(
  job:
    | Omit<OutboxSosJob, "id" | "createdAt">
    | Omit<OutboxIncidentJob, "id" | "createdAt">
    | Omit<OutboxAccessControlJob, "id" | "createdAt">,
): Promise<OutboxJob> {
  const full = { ...job, id: newId(), createdAt: Date.now() } as OutboxJob;
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(full);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  window.dispatchEvent(new CustomEvent("omt:outbox-changed"));
  return full;
}

export async function removeOutboxJob(id: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
  window.dispatchEvent(new CustomEvent("omt:outbox-changed"));
}

function dataUrlToBlob(dataUrl: string, mimeFallback: string): Blob {
  const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) {
    const bin = atob(dataUrl);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mimeFallback });
  }
  const mime = m[1] || mimeFallback;
  const bin = atob(m[2]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function fileToDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
}

async function uploadBlob(
  body: Blob,
  contentType: string,
): Promise<{ objectUrl: string; byteSize: number }> {
  const resp = await fetch("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": contentType },
    body,
    credentials: "include",
  });
  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(
      typeof errData.message === "string" ? errData.message : `Upload failed (${resp.status})`,
    );
  }
  const data = (await resp.json()) as { objectUrl: string; byteSize?: number };
  return {
    objectUrl: data.objectUrl,
    byteSize: typeof data.byteSize === "number" ? data.byteSize : body.size,
  };
}

async function drainSos(job: OutboxSosJob): Promise<PanicSendOutcome> {
  const loc: PanicLocationResult =
    job.lat != null && job.lng != null ? { lat: job.lat, lng: job.lng } : {};
  return postPanicAlert(loc);
}

async function rewriteDataUrlsInCustomFields(
  customFields: Record<string, string | number | null> | null | undefined,
): Promise<Record<string, string | number | null> | null | undefined> {
  if (!customFields) return customFields;
  const next: Record<string, string | number | null> = { ...customFields };

  async function rewriteUrlList(raw: unknown): Promise<string | null> {
    let urls: string[] = [];
    if (typeof raw === "string" && raw.trim()) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) urls = parsed.map(String);
        else if (raw.startsWith("data:") || raw.startsWith("http") || raw.startsWith("/")) urls = [raw];
      } catch {
        if (raw.startsWith("data:") || raw.startsWith("http") || raw.startsWith("/")) urls = [raw];
      }
    }
    if (urls.length === 0) return typeof raw === "string" ? raw : null;
    const out: string[] = [];
    for (const u of urls) {
      if (u.startsWith("data:")) {
        const blob = dataUrlToBlob(u, "image/jpeg");
        const { objectUrl } = await uploadBlob(blob, blob.type || "image/jpeg");
        out.push(objectUrl);
      } else {
        out.push(u);
      }
    }
    return JSON.stringify(out);
  }

  if (typeof next.personPhotoUrls === "string") {
    next.personPhotoUrls = await rewriteUrlList(next.personPhotoUrls);
  }
  if (typeof next.vehiclePhotoUrls === "string") {
    next.vehiclePhotoUrls = await rewriteUrlList(next.vehiclePhotoUrls);
  }

  if (typeof next.personsJson === "string" && next.personsJson.trim()) {
    try {
      const people = JSON.parse(next.personsJson) as Array<Record<string, unknown>>;
      for (const p of people) {
        const photos = Array.isArray(p.photoUrls) ? (p.photoUrls as string[]) : [];
        const rewritten: string[] = [];
        for (const u of photos) {
          if (typeof u === "string" && u.startsWith("data:")) {
            const blob = dataUrlToBlob(u, "image/jpeg");
            const { objectUrl } = await uploadBlob(blob, blob.type || "image/jpeg");
            rewritten.push(objectUrl);
          } else if (typeof u === "string") {
            rewritten.push(u);
          }
        }
        p.photoUrls = rewritten;
      }
      next.personsJson = JSON.stringify(people);
      const first = people[0];
      if (first && Array.isArray(first.photoUrls) && first.photoUrls.length > 0) {
        next.personPhotoUrls = JSON.stringify(first.photoUrls);
      }
    } catch {
      /* leave as-is */
    }
  }

  if (typeof next.vehiclesJson === "string" && next.vehiclesJson.trim()) {
    try {
      const vehicles = JSON.parse(next.vehiclesJson) as Array<Record<string, unknown>>;
      for (const v of vehicles) {
        const photos = Array.isArray(v.photoUrls) ? (v.photoUrls as string[]) : [];
        const rewritten: string[] = [];
        for (const u of photos) {
          if (typeof u === "string" && u.startsWith("data:")) {
            const blob = dataUrlToBlob(u, "image/jpeg");
            const { objectUrl } = await uploadBlob(blob, blob.type || "image/jpeg");
            rewritten.push(objectUrl);
          } else if (typeof u === "string") {
            rewritten.push(u);
          }
        }
        v.photoUrls = rewritten;
      }
      next.vehiclesJson = JSON.stringify(vehicles);
      const first = vehicles[0];
      if (first && Array.isArray(first.photoUrls) && first.photoUrls.length > 0) {
        next.vehiclePhotoUrls = JSON.stringify(first.photoUrls);
      }
    } catch {
      /* leave as-is */
    }
  }

  return next;
}

async function drainIncident(job: OutboxIncidentJob): Promise<void> {
  let form = { ...job.form };
  if (form.categoryId === -1) {
    const ensureResp = await apiRequest("POST", "/api/categories/ensure-other", {});
    const otherCat = (await ensureResp.json()) as { id: number };
    form = { ...form, categoryId: otherCat.id };
  }

  form = {
    ...form,
    customFields: await rewriteDataUrlsInCustomFields(form.customFields ?? null),
  };

  const resolvedAtts: { url: string; filename: string; mimeType: string; byteSize?: number }[] = [];
  for (const att of job.attachments) {
    if (att.url && !att.url.startsWith("blob:") && !att.url.startsWith("data:")) {
      resolvedAtts.push({
        url: att.url,
        filename: att.filename,
        mimeType: att.mimeType,
        byteSize: att.byteSize,
      });
      continue;
    }
    if (!att.dataUrl) {
      throw new Error(`Queued attachment ${att.filename} has no uploadable data`);
    }
    const blob = dataUrlToBlob(att.dataUrl, att.mimeType);
    const { objectUrl, byteSize } = await uploadBlob(blob, att.mimeType || blob.type);
    resolvedAtts.push({
      url: objectUrl,
      filename: att.filename,
      mimeType: att.mimeType,
      byteSize: att.byteSize ?? byteSize,
    });
  }

  const resp = await apiRequest("POST", "/api/incidents", form);
  const saved = (await resp.json()) as { id: number };
  for (const att of resolvedAtts) {
    await apiRequest("POST", `/api/incidents/${saved.id}/attachments`, {
      ...att,
      evidencePhase: "scene",
    });
  }
}

async function rewriteAccessPhotoUrl(url: unknown): Promise<string | null> {
  if (typeof url !== "string" || !url) return null;
  if (!url.startsWith("data:")) return url;
  const blob = dataUrlToBlob(url, "image/jpeg");
  const { objectUrl } = await uploadBlob(blob, blob.type || "image/jpeg");
  return objectUrl;
}

async function drainAccessControl(job: OutboxAccessControlJob): Promise<void> {
  const body = { ...job.body };
  body.vehiclePhotoUrl = await rewriteAccessPhotoUrl(body.vehiclePhotoUrl);

  if (Array.isArray(body.people)) {
    body.people = await Promise.all(
      (body.people as Record<string, unknown>[]).map(async (person) => ({
        ...person,
        personPhotoUrl: await rewriteAccessPhotoUrl(person.personPhotoUrl),
      })),
    );
  }

  await apiRequest("POST", "/api/access-control/entries", body);
}

let draining = false;

export async function drainOutbox(): Promise<{ drained: number; failed: number }> {
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    return { drained: 0, failed: 0 };
  }
  if (draining) return { drained: 0, failed: 0 };
  draining = true;
  let drained = 0;
  let failed = 0;
  try {
    const jobs = await listOutboxJobs();
    for (const job of jobs) {
      try {
        if (job.type === "sos") {
          await drainSos(job);
        } else if (job.type === "access_control") {
          await drainAccessControl(job);
        } else {
          await drainIncident(job);
        }
        await removeOutboxJob(job.id);
        drained += 1;
      } catch (err) {
        failed += 1;
        console.warn("[outbox] drain failed", job.id, err);
        break;
      }
    }
  } finally {
    draining = false;
    if (drained > 0 || failed > 0) {
      window.dispatchEvent(
        new CustomEvent("omt:outbox-drained", { detail: { drained, failed } }),
      );
    }
  }
  return { drained, failed };
}

export function isProbablyOffline(): boolean {
  return typeof navigator !== "undefined" && !navigator.onLine;
}
