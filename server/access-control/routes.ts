import type { Express, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { ACCESS_SCAN_METHODS } from "@shared/access-scan-data";
import {
  ACCESS_ENTRY_CATEGORIES,
  insertDestinationSchema,
} from "@shared/schema";
import {
  createAccessVisit,
  createDestination,
  getAccessActivity,
  getAccessAnalytics,
  getAccessLog,
  getAccessOverview,
  getCurrentlyInside,
  getDestinations,
  getPersonAccessHistory,
  markAccessExit,
  updateDestination,
} from "./storage";
import {
  diagnoseSadlParseFailure,
  parseSaDriversLicenceBytes,
} from "@shared/sa-drivers-licence";
import { findSadl720InBuffer, padSadlTo720 } from "@shared/extract-sadl-payload";
import { decodeSadlBytesFromImageBuffer } from "@shared/decode-sadl-from-image";
import { decodeLicenceFrontFromImageBuffer } from "./decode-licence-front-image";
import { decodeLicenceDiscFromImageBuffer } from "./decode-licence-disc-image";

import { hasAccessControlRole, canViewAccessControlModule } from "@shared/user-roles";

function requireAccessRole(req: Request, res: Response, next: NextFunction) {
  const role = req.currentUser?.role;
  if (!role || !hasAccessControlRole(role)) {
    return res.status(403).json({ message: "Access denied" });
  }
  next();
}

function requireAccessReadRole(req: Request, res: Response, next: NextFunction) {
  const role = req.currentUser?.role;
  if (!role || !canViewAccessControlModule(role)) {
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

function csvCell(value: string): string {
  const v = value.replace(/"/g, '""');
  return /[",\n]/.test(v) ? `"${v}"` : v;
}

const vehicleInputSchema = z.object({
  registration: z.string().max(32).optional().nullable(),
  make: z.string().max(64).optional().nullable(),
  model: z.string().max(64).optional().nullable(),
  colour: z.string().max(32).optional().nullable(),
  licenceDiscData: z.string().max(512).optional().nullable(),
});

const accessScanIdentitySchema = z.object({
  fullName: z.string().max(200).optional(),
  idNumber: z.string().max(32).optional(),
  surname: z.string().max(120).optional(),
  givenNames: z.string().max(120).optional(),
  sex: z.string().max(16).optional(),
  nationality: z.string().max(64).optional(),
  dateOfBirth: z.string().max(32).optional(),
  countryOfBirth: z.string().max(64).optional(),
  citizenshipStatus: z.string().max(64).optional(),
});

const accessScanDriversLicenceSchema = z.object({
  licenceNumber: z.string().max(32).optional(),
  issueDate: z.string().max(32).optional(),
  expiryDate: z.string().max(32).optional(),
  issueNumber: z.string().max(16).optional(),
  vehicleCodes: z.array(z.string().max(8)).max(12).optional(),
  vehicleRestrictions: z.array(z.string().max(32)).max(12).optional(),
  licenceCodeIssueDates: z.array(z.string().max(32)).max(12).optional(),
  driverRestrictionCodes: z.string().max(16).optional(),
  prdpCode: z.string().max(16).optional(),
  prdpExpiryDate: z.string().max(32).optional(),
  gender: z.string().max(16).optional(),
  birthdate: z.string().max(32).optional(),
  idNumberType: z.string().max(16).optional(),
  idCountryOfIssue: z.string().max(64).optional(),
  licenceCountryOfIssue: z.string().max(64).optional(),
});

const accessScanDataSchema = z.object({
  capturedAt: z.string().max(40),
  scanMethod: z.enum(ACCESS_SCAN_METHODS),
  documentType: z.enum(["smart_id", "drivers_licence", "id_book"]).optional(),
  identity: accessScanIdentitySchema,
  driversLicence: accessScanDriversLicenceSchema.optional(),
  extraFields: z.array(z.string().max(200)).max(20).optional(),
  rawBarcodePreview: z.string().max(500).optional(),
});

const personInputSchema = z.object({
  personFullName: z.string().min(1).max(200),
  personIdNumber: z.string().max(32).optional().nullable(),
  personPhotoUrl: z.string().max(2000).optional().nullable(),
  partyRole: z.enum(["walk_in", "driver", "passenger"]).optional().nullable(),
  scanData: accessScanDataSchema.optional().nullable(),
});

const createEntrySchema = z
  .object({
    category: z.enum(ACCESS_ENTRY_CATEGORIES),
    destinationId: z.number().int().positive(),
    companyName: z.string().max(200).optional().nullable(),
    contactNumber: z.string().max(32).optional().nullable(),
    purpose: z.string().max(500).optional().nullable(),
    vehiclePhotoUrl: z.string().max(2000).optional().nullable(),
    vehicle: vehicleInputSchema.optional().nullable(),
    /** Multi-person visit (preferred). */
    people: z.array(personInputSchema).min(1).max(20).optional(),
    /** Legacy single-person fields — still accepted. */
    personFullName: z.string().min(1).max(200).optional(),
    personIdNumber: z.string().max(32).optional().nullable(),
    personPhotoUrl: z.string().max(2000).optional().nullable(),
    partyRole: z.enum(["walk_in", "driver", "passenger"]).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.people?.length) return;
    if (!data.personFullName?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide people[] or personFullName",
        path: ["personFullName"],
      });
    }
  });

export function registerAccessControlRoutes(app: Express) {
  // ── Destinations ────────────────────────────────────────────────────────────
  app.get("/api/access-control/destinations", requireAccessReadRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const includeInactive = req.query.all === "1" && req.currentUser!.role === "administrator";
    let locationId: number | undefined;
    if (req.query.locationId != null) {
      locationId = parseInt(String(req.query.locationId), 10);
      if (!Number.isFinite(locationId)) {
        return res.status(400).json({ message: "Invalid locationId" });
      }
    } else if (req.currentWorkstation?.locationId != null) {
      locationId = req.currentWorkstation.locationId;
    }
    res.json(await getDestinations(orgId, !includeInactive, locationId));
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
  app.get("/api/access-control/overview", requireAccessReadRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    res.json(await getAccessOverview(orgId));
  });

  app.get("/api/access-control/activity", requireAccessReadRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const limit = parseInt(String(req.query.limit ?? "40"), 10);
    const destinationId = req.query.destinationId
      ? parseInt(String(req.query.destinationId), 10)
      : undefined;
    const status = req.query.status as "inside" | "exited" | "all" | undefined;
    const category = req.query.category ? String(req.query.category) : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    if (destinationId != null && !Number.isFinite(destinationId)) {
      return res.status(400).json({ message: "Invalid destinationId" });
    }
    if (from && Number.isNaN(from.getTime())) {
      return res.status(400).json({ message: "Invalid from date" });
    }
    if (to && Number.isNaN(to.getTime())) {
      return res.status(400).json({ message: "Invalid to date" });
    }

    res.json(
      await getAccessActivity(orgId, {
        limit: Number.isFinite(limit) ? limit : 40,
        destinationId,
        search,
        status: status === "inside" || status === "exited" ? status : "all",
        category,
        from,
        to,
      }),
    );
  });

  app.get("/api/access-control/analytics", requireAccessReadRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const days = parseInt(String(req.query.days ?? "7"), 10);
    res.json(await getAccessAnalytics(orgId, Number.isFinite(days) ? days : 7));
  });

  app.get("/api/access-control/entries/:id", requireAccessReadRole, async (req, res) => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const orgId = req.currentUser!.organizationId;
    const entry = await getAccessLog(id, orgId);
    if (!entry) return res.status(404).json({ message: "Entry not found" });
    res.json(entry);
  });

  app.get("/api/access-control/person-history", requireAccessReadRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const personIdNumber = req.query.personIdNumber ? String(req.query.personIdNumber) : undefined;
    const personFullName = req.query.personFullName ? String(req.query.personFullName) : undefined;
    const excludeId = req.query.excludeId ? parseInt(String(req.query.excludeId), 10) : undefined;
    res.json(
      await getPersonAccessHistory(orgId, {
        personIdNumber,
        personFullName,
        excludeId: Number.isFinite(excludeId) ? excludeId : undefined,
      }),
    );
  });

  app.get("/api/access-control/report.csv", requireAccessReadRole, async (req, res) => {
    const orgId = req.currentUser!.organizationId;
    const destinationId = req.query.destinationId
      ? parseInt(String(req.query.destinationId), 10)
      : undefined;
    const search = req.query.search ? String(req.query.search) : undefined;
    const status = req.query.status as "inside" | "exited" | "all" | undefined;
    const from = req.query.from ? new Date(String(req.query.from)) : undefined;
    const to = req.query.to ? new Date(String(req.query.to)) : undefined;

    const rows = await getAccessActivity(orgId, {
      limit: 2000,
      destinationId: Number.isFinite(destinationId) ? destinationId : undefined,
      search,
      status: status === "inside" || status === "exited" ? status : "all",
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    });

    const header = [
      "Date",
      "Time in",
      "Time out",
      "Status",
      "Full name",
      "ID number",
      "Category",
      "Destination",
      "Company",
      "Contact",
      "Purpose",
      "Vehicle registration",
      "Vehicle make",
      "Vehicle model",
      "Logged by",
    ];

    const fmt = (d: Date | string | null | undefined) => {
      if (!d) return "";
      const dt = typeof d === "string" ? new Date(d) : d;
      return dt.toLocaleString("en-ZA");
    };

    const lines = [
      header.join(","),
      ...rows.map((r) =>
        [
          r.timeIn ? new Date(r.timeIn).toLocaleDateString("en-ZA") : "",
          fmt(r.timeIn),
          fmt(r.timeOut),
          r.status,
          csvCell(r.personFullName),
          csvCell(r.personIdNumber ?? ""),
          csvCell(r.category),
          csvCell(r.destinationName),
          csvCell(r.companyName ?? ""),
          csvCell(r.contactNumber ?? ""),
          csvCell(r.purpose ?? ""),
          csvCell(r.vehicle?.registration ?? ""),
          csvCell(r.vehicle?.make ?? ""),
          csvCell(r.vehicle?.model ?? ""),
          csvCell(r.loggedByName ?? ""),
        ].join(","),
      ),
    ];

    const filename = `access-report-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(lines.join("\n"));
  });

  app.get("/api/access-control/currently-inside", requireAccessReadRole, async (req, res) => {
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

    // Hardware scanner (Binary Eye): exact 720-byte payload — try strict Luhn first, then
    // relaxed field checks (image pipeline keeps strict-only via decode-sadl-from-image).
    let dl = parseSaDriversLicenceBytes(sadl, true, { strictIdCheck: true });
    if (!dl) {
      dl = parseSaDriversLicenceBytes(sadl, true, { strictIdCheck: false });
    }
    if (!dl) {
      const diag = diagnoseSadlParseFailure(sadl);
      console.warn(
        `[sadl-scan] decrypt/parse failed — luhn=${diag.luhnOk} plausible=${diag.plausibleOk} id=${diag.idNumber ?? "?"} surname=${diag.surname ?? "?"} err=${diag.error ?? ""}`,
      );
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

  app.post("/api/access-control/decode-licence-disc-image", requireAccessRole, async (req, res) => {
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
      const ocr = await decodeLicenceDiscFromImageBuffer(imageBuffer);
      if (!ocr.registration && !ocr.make && !ocr.model) {
        console.warn(`[licence-disc-ocr] no fields — imageBytes=${imageBuffer.length} ms=${Date.now() - startedAt}`);
        return res.status(422).json({
          message: ocr.hint ?? "Could not read the licence disc",
        });
      }
      console.log(
        `[licence-disc-ocr] success — reg=${ocr.registration ? "yes" : "no"} make=${ocr.make ? "yes" : "no"} ms=${Date.now() - startedAt}`,
      );
      res.json(ocr);
    } catch (err) {
      console.error(
        "[licence-disc-ocr] decode threw:",
        err instanceof Error ? err.message : err,
      );
      return res
        .status(500)
        .json({ message: "Server error while reading licence disc image" });
    }
  });

  app.post("/api/access-control/entries", requireAccessRole, async (req, res) => {
    const parsed = createEntrySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const orgId = req.currentUser!.organizationId;
    const userId = req.currentUser!.id;
    const workstationId = req.session.workstationId ?? req.currentWorkstation?.id ?? null;

    const dests = await getDestinations(orgId, true, req.currentWorkstation?.locationId ?? undefined);
    const dest = dests.find((d) => d.id === parsed.data.destinationId);
    if (!dest) {
      return res.status(400).json({ message: "Select a valid active destination for this premises" });
    }

    const people =
      parsed.data.people?.length
        ? parsed.data.people
        : [
            {
              personFullName: parsed.data.personFullName!,
              personIdNumber: parsed.data.personIdNumber,
              personPhotoUrl: parsed.data.personPhotoUrl,
              partyRole: parsed.data.partyRole,
            },
          ];

    const entries = await createAccessVisit(orgId, userId, {
      category: parsed.data.category,
      destinationId: parsed.data.destinationId,
      companyName: parsed.data.companyName,
      contactNumber: parsed.data.contactNumber,
      purpose: parsed.data.purpose,
      vehiclePhotoUrl: parsed.data.vehiclePhotoUrl,
      vehicle: parsed.data.vehicle,
      workstationId,
      people,
    });

    // Keep single-person clients working; multi-person gets the full array.
    res.status(201).json(entries.length === 1 ? entries[0] : entries);
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
