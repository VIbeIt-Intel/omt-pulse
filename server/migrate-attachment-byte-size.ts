import { db } from "./storage";
import { sql } from "drizzle-orm";
import { byteSizeFromDataUrl } from "@shared/attachment-byte-size";
import { ObjectStorageService } from "./replit_integrations/object_storage";

/** Idempotent: add byte_size and backfill known attachment sizes. */
export async function migrateAttachmentByteSize() {
  try {
    await db.execute(sql`
      ALTER TABLE incident_attachments ADD COLUMN IF NOT EXISTS byte_size BIGINT
    `);
  } catch (err) {
    console.warn(
      "[attachment-byte-size] add column:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  const rows = await db.execute(sql`
    SELECT id, url FROM incident_attachments WHERE byte_size IS NULL LIMIT 500
  `);

  const list = rows.rows as Array<{ id: number; url: string }>;
  if (!list.length) return;

  let objectStorage: ObjectStorageService | null = null;
  try {
    objectStorage = new ObjectStorageService();
  } catch {
    objectStorage = null;
  }

  let updated = 0;
  for (const row of list) {
    let size = byteSizeFromDataUrl(row.url);
    if (size == null && objectStorage) {
      try {
        const path = objectPathFromUrl(row.url);
        if (path) {
          const file = await objectStorage.getObjectEntityFile(path);
          const [meta] = await file.getMetadata();
          const raw = meta.size;
          const n = typeof raw === "string" ? Number(raw) : Number(raw ?? NaN);
          if (Number.isFinite(n) && n >= 0) size = Math.floor(n);
        }
      } catch {
        /* leave null */
      }
    }
    if (size == null) continue;
    await db.execute(sql`
      UPDATE incident_attachments SET byte_size = ${size} WHERE id = ${row.id} AND byte_size IS NULL
    `);
    updated++;
  }

  if (updated > 0) {
    console.log(`[attachment-byte-size] backfilled ${updated} row(s)`);
  }
}

function objectPathFromUrl(url: string): string | null {
  try {
    if (url.startsWith("/objects/")) return url.split("?")[0] ?? null;
    const u = new URL(url);
    if (u.pathname.startsWith("/objects/")) return u.pathname;
  } catch {
    /* ignore */
  }
  return null;
}
