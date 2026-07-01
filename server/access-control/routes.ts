import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import {
  ACCESS_ENTRY_CATEGORIES,
  insertDestinationSchema,
} from "@shared/schema";
import {
  createAccessEntry,
  createDestination,
  getCurrentlyInside,
  getDestinations,
  markAccessExit,
  updateDestination,
} from "./storage";
import { parseSaDriversLicenceBytes } from "@shared/sa-drivers-licence";
import { findSadl720InBuffer, padSadlTo720 } from "@shared/extract-sadl-payload";
import { decodeSadlBytesFromImageBuffer } from "@shared/decode-sadl-from-image";
import { decodeLicenceFrontFromImageBuffer } from "./decode-licence-front-image";

const ACCESS_ROLES = ["administrator", "supervisor", "reporter"] as const;

function requireAccessRole(req: Request, res: Response, next: NextFunction) {
  const role = req.currentUser?.role;
  if (!role || !ACCESS_ROLES.includes(role as (typeof ACCESS_ROLES)[number])) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.currentUser?.role !== "administrator") {
    return res.status(403).json({ message: "Administrator only" });
  }
  next();
}

const vehicleInputSchema = z.object({
  registration: z.string().max(32).optional().nullable(),
  make: z.string().max(64).optional().nullable(),
  model: z.string().max(64).optional().nullable(),
  colour: z.string().max(32).optional().nullable(),
  licenceDiscData: z.string().max(512).optional().nullable(),
});

const createEntrySchema = z.object({
  category: z.enum(ACCESS_ENTRY_CATEGORIES),
  destinationId: z.number().int().positive(),
  personFullName: z.string().min(1).max(200),
  personIdNumber: z.string().max(32).optional().nullable(),
  companyName: z.string().max(200).optional().nullable(),
  contactNumber: z.string().max(32).optional().nullable(),
  purpose: z.string().max(500).optional().nullable(),
  personPhotoUrl: z.string().max(2000).optional().nullable(),
  vehiclePhotoUrl: z.string().max(2000).optional().nullable(),
  vehicle: vehicleInputSchema.optional().nullable(),
});

export function registerAccessControlRoutes(app: Express) {
  // ── Destinations ────────────────────────────────────────────────────────────
  app.get("/api/access-control/destinations", requireAccessRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const includeInactive = req.query.all === "1" && req.currentUser!.role === "administrator";
    res.json(await getDestinations(orgId, !includeInactive));
  });

  app.post("/api/access-control/destinations", requireAdmin, async (req, res) => {
    const parsed = insertDestinationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const orgId = req.currentUser!.organizationId;
    const dest = await createDestination(parsed.data, orgId);
    res.status(201).json(dest);
  });

  app.patch("/api/access-control/destinations/:id", requireAdmin, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const partial = insertDestinationSchema.partial().safeParse(req.body);
    if (!partial.success) return res.status(400).json({ message: partial.error.message });
    const orgId = req.currentUser!.organizationId;
    const updated = await updateDestination(id, partial.data, orgId);
    if (!updated) return res.status(404).json({ message: "Destination not found" });
    res.json(updated);
  });

  // ── Entries ─────────────────────────────────────────────────────────────────
  app.get("/api/access-control/currently-inside", requireAccessRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    res.json(await getCurrentlyInside(orgId));
  });

  app.post("/api/access-control/decode-drivers-licence", requireAccessRole, async (req, res) => {
    const bodySchema = z.object({
      payloadBase64: z.string().min(100).max(2048),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    let bytes: Buffer;
    try {
      bytes = Buffer.from(parsed.data.payloadBase64, "base64");
    } catch {
      return res.status(400).json({ message: "Invalid base64 payload" });
    }

    let sadl =
      bytes.length === 720
        ? new Uint8Array(bytes)
        : findSadl720InBuffer(new Uint8Array(bytes)) ?? null;
    if (!sadl && bytes.length >= 700 && bytes.length < 720) {
      sadl = padSadlTo720(new Uint8Array(bytes));
    }
    if (!sadl) {
      return res.status(400).json({ message: "Driver licence barcode must be 720 bytes" });
    }

    const dl = parseSaDriversLicenceBytes(sadl, true);
    if (!dl) {
      return res.status(422).json({ message: "Could not decode driver licence barcode" });
    }
    res.json(dl);
  });

  app.post("/api/access-control/decode-drivers-licence-image", requireAccessRole, async (req, res) => {
    const bodySchema = z.object({
      imageBase64: z.string().min(100).max(8_000_000),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const dataUrl = parsed.data.imageBase64;
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;

    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(base64, "base64");
    } catch {
      return res.status(400).json({ message: "Invalid image base64" });
    }
    if (imageBuffer.length < 1_000 || imageBuffer.length > 6_000_000) {
      return res.status(400).json({ message: "Image too small or too large" });
    }

    const startedAt = Date.now();
    let sadlBytes: Uint8Array | null = null;
    try {
      sadlBytes = await decodeSadlBytesFromImageBuffer(imageBuffer);
    } catch (err) {
      console.error(
        "[sadl-image] decode threw:",
        err instanceof Error ? err.message : err,
      );
      return res
        .status(500)
        .json({ message: "Server error while reading driver's licence image" });
    }

    if (!sadlBytes) {
      console.warn(
        `[sadl-image] no PDF417 found — imageBytes=${imageBuffer.length} ms=${Date.now() - startedAt}`,
      );
      return res.status(422).json({ message: "No driver's licence PDF417 found in image" });
    }

    const dl = parseSaDriversLicenceBytes(sadlBytes, true);
    if (!dl) {
      console.warn(
        `[sadl-image] PDF417 read (${sadlBytes.length} bytes) but decrypt/parse failed`,
      );
      return res.status(422).json({ message: "Could not decode driver licence barcode" });
    }
    console.log(
      `[sadl-image] success — id=${dl.idNumber ? "yes" : "no"} name=${dl.surname ? "yes" : "no"} ms=${Date.now() - startedAt}`,
    );
    res.json(dl);
  });

  app.post("/api/access-control/decode-licence-front-image", requireAccessRole, async (req, res) => {
    const bodySchema = z.object({
      imageBase64: z.string().min(100).max(8_000_000),
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const dataUrl = parsed.data.imageBase64;
    const base64 = dataUrl.includes(",") ? dataUrl.split(",")[1]! : dataUrl;

    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(base64, "base64");
    } catch {
      return res.status(400).json({ message: "Invalid image base64" });
    }
    if (imageBuffer.length < 1_000 || imageBuffer.length > 6_000_000) {
      return res.status(400).json({ message: "Image too small or too large" });
    }

    const startedAt = Date.now();
    try {
      const ocr = await decodeLicenceFrontFromImageBuffer(imageBuffer);
      if (!ocr.personIdNumber && !ocr.personFullName) {
        console.warn(`[licence-front-ocr] no fields — imageBytes=${imageBuffer.length} ms=${Date.now() - startedAt}`);
        return res.status(422).json({
          message: ocr.hint ?? "Could not read the front of the licence",
        });
      }
      console.log(
        `[licence-front-ocr] success — id=${ocr.personIdNumber ? "yes" : "no"} name=${ocr.personFullName ? "yes" : "no"} ms=${Date.now() - startedAt}`,
      );
      res.json(ocr);
    } catch (err) {
      console.error(
        "[licence-front-ocr] decode threw:",
        err instanceof Error ? err.message : err,
      );
      return res
        .status(500)
        .json({ message: "Server error while reading licence front image" });
    }
  });

  app.post("/api/access-control/entries", requireAccessRole, async (req, res) => {
    const parsed = createEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;

    const dests = await getDestinations(orgId, true);
    if (!dests.some((d) => d.id === parsed.data.destinationId)) {
      return res.status(400).json({ message: "Select a valid active destination" });
    }

    const entry = await createAccessEntry(orgId, userId, parsed.data);
    res.status(201).json(entry);
  });

  app.post("/api/access-control/entries/:id/exit", requireAccessRole, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId = req.currentUser!.organizationId;
    const updated = await markAccessExit(id, orgId);
    if (!updated) return res.status(404).json({ message: "Entry not found or already exited" });
    res.json(updated);
  });
}
