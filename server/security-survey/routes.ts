import type { Express, Request, Response } from "express";
import {
  canAccessSecuritySurveyModule,
  canConductSecuritySurvey,
  canManageSurveyTemplates,
  canViewAllCompletedSurveys,
  createTemplateBodySchema,
  updateTemplateBodySchema,
  startSurveyBodySchema,
  updateSurveyBodySchema,
  upsertFindingBodySchema,
  emailSurveyPdfBodySchema,
} from "@shared/security-survey";
import { sendAppEmail } from "../mail";
import { storage } from "../storage";
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listSurveys,
  getSurveyDetail,
  startSurvey,
  updateSurvey,
  completeSurvey,
  upsertFinding,
  updateFinding,
  deleteFinding,
  convertFindingToIncident,
} from "./storage";
import { z } from "zod";

function requireUser(req: Request, res: Response): boolean {
  if (!req.currentUser) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  return true;
}

function requireAccess(req: Request, res: Response): boolean {
  if (!requireUser(req, res)) return false;
  if (!canAccessSecuritySurveyModule(req.currentUser!.role)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

function requireConduct(req: Request, res: Response): boolean {
  if (!requireUser(req, res)) return false;
  if (!canConductSecuritySurvey(req.currentUser!.role)) {
    res.status(403).json({ message: "Forbidden" });
    return false;
  }
  return true;
}

function requireManage(req: Request, res: Response): boolean {
  if (!requireUser(req, res)) return false;
  if (!canManageSurveyTemplates(req.currentUser!.role)) {
    res.status(403).json({ message: "Administrator or supervisor only" });
    return false;
  }
  return true;
}

async function assertCanViewSurvey(
  req: Request,
  survey: { surveyorUserId: string; status: string },
): Promise<boolean> {
  const role = req.currentUser!.role;
  if (canViewAllCompletedSurveys(role)) return true;
  return survey.surveyorUserId === req.currentUser!.id;
}

const patchFindingBodySchema = z.object({
  answer: z.enum(["yes", "no", "na"]).optional(),
  severity: z.enum(["critical", "high", "medium", "low"]).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  gpsAccuracyM: z.number().positive().max(5000).optional().nullable(),
  photoUrls: z.array(z.string().min(1).max(2000)).max(12).optional(),
});

export function registerSecuritySurveyRoutes(app: Express): void {
  // ── Templates ──────────────────────────────────────────────────────────────

  app.get("/api/security-surveys/templates", async (req, res) => {
    if (!requireAccess(req, res)) return;
    try {
      const templates = await listTemplates(req.currentUser!.organizationId);
      res.json(templates);
    } catch (err) {
      console.error("[security-survey] list templates:", err);
      res.status(500).json({ message: "Failed to list templates" });
    }
  });

  app.post("/api/security-surveys/templates", async (req, res) => {
    if (!requireManage(req, res)) return;
    const parsed = createTemplateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    try {
      const created = await createTemplate(
        req.currentUser!.organizationId,
        req.currentUser!.id,
        parsed.data,
      );
      res.status(201).json(created);
    } catch (err) {
      console.error("[security-survey] create template:", err);
      res.status(500).json({ message: "Failed to create template" });
    }
  });

  app.get("/api/security-surveys/templates/:id", async (req, res) => {
    if (!requireAccess(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const template = await getTemplate(id, req.currentUser!.organizationId);
      if (!template) return res.status(404).json({ message: "Template not found" });
      res.json(template);
    } catch (err) {
      console.error("[security-survey] get template:", err);
      res.status(500).json({ message: "Failed to load template" });
    }
  });

  app.patch("/api/security-surveys/templates/:id", async (req, res) => {
    if (!requireManage(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = updateTemplateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    try {
      const updated = await updateTemplate(id, req.currentUser!.organizationId, parsed.data);
      if (!updated) return res.status(404).json({ message: "Template not found" });
      res.json(updated);
    } catch (err) {
      console.error("[security-survey] update template:", err);
      res.status(500).json({ message: "Failed to update template" });
    }
  });

  app.delete("/api/security-surveys/templates/:id", async (req, res) => {
    if (!requireManage(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const ok = await deleteTemplate(id, req.currentUser!.organizationId);
      if (!ok) return res.status(404).json({ message: "Template not found" });
      res.status(204).end();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete template";
      if (message.includes("in use")) return res.status(409).json({ message });
      console.error("[security-survey] delete template:", err);
      res.status(500).json({ message: "Failed to delete template" });
    }
  });

  // ── Surveys ────────────────────────────────────────────────────────────────

  app.get("/api/security-surveys", async (req, res) => {
    if (!requireAccess(req, res)) return;
    try {
      const orgId = req.currentUser!.organizationId;
      const role = req.currentUser!.role;
      const locationIdRaw = typeof req.query.locationId === "string" ? req.query.locationId : undefined;
      const surveyorRaw =
        typeof req.query.surveyorUserId === "string" ? req.query.surveyorUserId : undefined;
      const statusRaw = typeof req.query.status === "string" ? req.query.status : undefined;
      const fromRaw = typeof req.query.from === "string" ? req.query.from : undefined;
      const toRaw = typeof req.query.to === "string" ? req.query.to : undefined;

      const filters: Parameters<typeof listSurveys>[1] = {};
      if (locationIdRaw) {
        const locationId = parseInt(locationIdRaw, 10);
        if (Number.isFinite(locationId)) filters.locationId = locationId;
      }
      if (surveyorRaw) filters.surveyorUserId = surveyorRaw;
      if (statusRaw) {
        filters.status = statusRaw.includes(",") ? statusRaw.split(",").map((s) => s.trim()) : statusRaw;
      }
      if (fromRaw) {
        const from = new Date(fromRaw);
        if (!Number.isNaN(from.getTime())) filters.from = from;
      }
      if (toRaw) {
        const to = new Date(toRaw);
        if (!Number.isNaN(to.getTime())) filters.to = to;
      }

      if (!canViewAllCompletedSurveys(role)) {
        filters.restrictSurveyorIds = [req.currentUser!.id];
      }

      const surveys = await listSurveys(orgId, filters);
      res.json(surveys);
    } catch (err) {
      console.error("[security-survey] list surveys:", err);
      res.status(500).json({ message: "Failed to list surveys" });
    }
  });

  app.post("/api/security-surveys", async (req, res) => {
    if (!requireConduct(req, res)) return;
    const parsed = startSurveyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    try {
      const orgId = req.currentUser!.organizationId;
      const userId = req.currentUser!.id;

      const assigned = await storage.getUserLocationAssignments(userId, orgId);
      if (assigned.length > 0 && !assigned.includes(parsed.data.locationId)) {
        return res.status(403).json({ message: "Location is outside your assigned premises" });
      }

      let commandId = parsed.data.commandId ?? null;
      if (commandId == null) {
        const location = await storage.getLocation(parsed.data.locationId, orgId);
        commandId = location?.commandId ?? null;
      }
      if (commandId == null) {
        const cmds = await storage.getUserCommands(userId);
        commandId = cmds[0]?.id ?? null;
      }

      const survey = await startSurvey(orgId, userId, {
        ...parsed.data,
        commandId,
      });
      res.status(201).json(survey);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start survey";
      if (message.includes("not found")) return res.status(404).json({ message });
      console.error("[security-survey] start survey:", err);
      res.status(500).json({ message: "Failed to start survey" });
    }
  });

  app.get("/api/security-surveys/:id", async (req, res) => {
    if (!requireAccess(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const survey = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!survey) return res.status(404).json({ message: "Survey not found" });
      if (!(await assertCanViewSurvey(req, survey))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      res.json(survey);
    } catch (err) {
      console.error("[security-survey] get survey:", err);
      res.status(500).json({ message: "Failed to load survey" });
    }
  });

  app.patch("/api/security-surveys/:id", async (req, res) => {
    if (!requireAccess(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = updateSurveyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }

    try {
      const existing = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!existing) return res.status(404).json({ message: "Survey not found" });

      if (parsed.data.status === "archived") {
        if (!canManageSurveyTemplates(req.currentUser!.role)) {
          return res.status(403).json({ message: "Administrator or supervisor only" });
        }
      } else if (existing.surveyorUserId !== req.currentUser!.id && !canViewAllCompletedSurveys(req.currentUser!.role)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const updated = await updateSurvey(id, req.currentUser!.organizationId, parsed.data);
      res.json(updated);
    } catch (err) {
      console.error("[security-survey] update survey:", err);
      res.status(500).json({ message: "Failed to update survey" });
    }
  });

  app.post("/api/security-surveys/:id/complete", async (req, res) => {
    if (!requireConduct(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    try {
      const existing = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!existing) return res.status(404).json({ message: "Survey not found" });
      if (
        existing.surveyorUserId !== req.currentUser!.id &&
        !canManageSurveyTemplates(req.currentUser!.role)
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const completed = await completeSurvey(id, req.currentUser!.organizationId);
      res.json(completed);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to complete survey";
      if (message.includes("incomplete") || message.includes("archived")) {
        return res.status(400).json({ message });
      }
      console.error("[security-survey] complete survey:", err);
      res.status(500).json({ message: "Failed to complete survey" });
    }
  });

  // ── Findings ───────────────────────────────────────────────────────────────

  app.post("/api/security-surveys/:id/findings", async (req, res) => {
    if (!requireConduct(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = upsertFindingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    try {
      const existing = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!existing) return res.status(404).json({ message: "Survey not found" });
      if (
        existing.surveyorUserId !== req.currentUser!.id &&
        !canManageSurveyTemplates(req.currentUser!.role)
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const finding = await upsertFinding(id, req.currentUser!.organizationId, parsed.data);
      res.status(201).json(finding);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save finding";
      if (message.includes("not found")) return res.status(404).json({ message });
      if (message.includes("Cannot edit")) return res.status(400).json({ message });
      console.error("[security-survey] upsert finding:", err);
      res.status(500).json({ message: "Failed to save finding" });
    }
  });

  app.patch("/api/security-surveys/:id/findings/:findingId", async (req, res) => {
    if (!requireConduct(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    const findingId = parseInt(req.params.findingId as string, 10);
    if (!Number.isFinite(id) || !Number.isFinite(findingId)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const parsed = patchFindingBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    try {
      const existing = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!existing) return res.status(404).json({ message: "Survey not found" });
      if (
        existing.surveyorUserId !== req.currentUser!.id &&
        !canManageSurveyTemplates(req.currentUser!.role)
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const finding = await updateFinding(id, findingId, req.currentUser!.organizationId, parsed.data);
      if (!finding) return res.status(404).json({ message: "Finding not found" });
      res.json(finding);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to update finding";
      if (message.includes("Cannot edit")) return res.status(400).json({ message });
      console.error("[security-survey] update finding:", err);
      res.status(500).json({ message: "Failed to update finding" });
    }
  });

  app.delete("/api/security-surveys/:id/findings/:findingId", async (req, res) => {
    if (!requireConduct(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    const findingId = parseInt(req.params.findingId as string, 10);
    if (!Number.isFinite(id) || !Number.isFinite(findingId)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    try {
      const existing = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!existing) return res.status(404).json({ message: "Survey not found" });
      if (
        existing.surveyorUserId !== req.currentUser!.id &&
        !canManageSurveyTemplates(req.currentUser!.role)
      ) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const ok = await deleteFinding(id, findingId, req.currentUser!.organizationId);
      if (!ok) return res.status(404).json({ message: "Finding not found" });
      res.status(204).end();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to delete finding";
      if (message.includes("Cannot delete")) return res.status(400).json({ message });
      console.error("[security-survey] delete finding:", err);
      res.status(500).json({ message: "Failed to delete finding" });
    }
  });

  app.post("/api/security-surveys/:id/findings/:findingId/convert-incident", async (req, res) => {
    if (!requireAccess(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    const findingId = parseInt(req.params.findingId as string, 10);
    if (!Number.isFinite(id) || !Number.isFinite(findingId)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    try {
      const existing = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!existing) return res.status(404).json({ message: "Survey not found" });
      if (!(await assertCanViewSurvey(req, existing))) {
        return res.status(403).json({ message: "Forbidden" });
      }
      const result = await convertFindingToIncident(
        id,
        findingId,
        req.currentUser!.organizationId,
        req.currentUser!.id,
      );
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to convert finding";
      if (message.includes("not found")) return res.status(404).json({ message });
      if (message.includes("already converted")) return res.status(409).json({ message });
      console.error("[security-survey] convert incident:", err);
      res.status(500).json({ message: "Failed to convert finding" });
    }
  });

  app.post("/api/security-surveys/:id/email-pdf", async (req, res) => {
    if (!requireAccess(req, res)) return;
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ message: "Invalid id" });
    const parsed = emailSurveyPdfBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.message });
    }
    try {
      const survey = await getSurveyDetail(id, req.currentUser!.organizationId);
      if (!survey) return res.status(404).json({ message: "Survey not found" });
      if (!(await assertCanViewSurvey(req, survey))) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const siteName = survey.locationName || `Survey #${survey.id}`;
      const clientName = survey.clientNameOverride || survey.organizationName;
      const filename =
        parsed.data.filename?.trim() ||
        `OMT-Site-Survey-${survey.id}.pdf`;
      const subject =
        parsed.data.subject?.trim() ||
        `Site Survey Report — ${clientName} / ${siteName}`;
      const messageText =
        parsed.data.message?.trim() ||
        `Please find attached the site survey report for ${siteName}.`;

      const pdfBase64 = parsed.data.pdfBase64.replace(/^data:application\/pdf;base64,/, "");

      const result = await sendAppEmail({
        to: parsed.data.recipients,
        subject,
        text: messageText,
        html: `<p>${messageText.replace(/\n/g, "<br/>")}</p>`,
        attachments: [
          {
            filename,
            content: pdfBase64,
          },
        ],
      });

      if (!result.sent) {
        return res.status(502).json({ message: result.reason || "Failed to send email" });
      }
      res.json({ ok: true, id: result.id });
    } catch (err) {
      console.error("[security-survey] email pdf:", err);
      res.status(500).json({ message: "Failed to email PDF" });
    }
  });
}
