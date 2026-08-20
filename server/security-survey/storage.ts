import {
  surveyTemplates,
  surveyTemplateItems,
  securitySurveys,
  surveyFindings,
  surveyFindingPhotos,
  locations,
  users,
  organizations,
  type SurveyTemplate,
  type SurveyTemplateItem,
  type SecuritySurvey,
  type SurveyFinding,
  type SurveyFindingPhoto,
} from "@shared/schema";
import {
  computeSurveyRiskSummary,
  type SurveyRiskRating,
} from "@shared/security-survey-risk";
import { db, storage } from "../storage";
import { eq, and, desc, asc, inArray, gte, lte, sql } from "drizzle-orm";

export type TemplateWithItems = SurveyTemplate & { items: SurveyTemplateItem[] };

export type FindingWithPhotos = SurveyFinding & { photos: SurveyFindingPhoto[] };

export type SurveyListItem = SecuritySurvey & {
  locationName: string;
  surveyorName: string;
  templateName: string;
  answeredCount: number;
  totalItems: number;
  /** Weighted risk score from finding severities (same bands as PDF). */
  riskScore: number;
  riskRating: SurveyRiskRating;
  riskLabel: string;
};

export type SurveyDetail = SecuritySurvey & {
  locationName: string | null;
  locationAddress: string | null;
  locationPhotoUrl: string | null;
  locationLatitude: number | null;
  locationLongitude: number | null;
  surveyorName: string;
  templateName: string;
  organizationName: string;
  findings: FindingWithPhotos[];
  items: SurveyTemplateItem[];
};

export async function listTemplates(orgId: string): Promise<TemplateWithItems[]> {
  const templates = await db
    .select()
    .from(surveyTemplates)
    .where(eq(surveyTemplates.organizationId, orgId))
    .orderBy(desc(surveyTemplates.isDefault), asc(surveyTemplates.name));

  if (templates.length === 0) return [];

  const items = await db
    .select()
    .from(surveyTemplateItems)
    .where(inArray(surveyTemplateItems.templateId, templates.map((t) => t.id)))
    .orderBy(asc(surveyTemplateItems.sortOrder));

  return templates.map((t) => ({
    ...t,
    items: items.filter((i) => i.templateId === t.id),
  }));
}

export async function getTemplate(
  id: number,
  orgId: string,
): Promise<TemplateWithItems | null> {
  const [template] = await db
    .select()
    .from(surveyTemplates)
    .where(and(eq(surveyTemplates.id, id), eq(surveyTemplates.organizationId, orgId)))
    .limit(1);
  if (!template) return null;

  const items = await db
    .select()
    .from(surveyTemplateItems)
    .where(eq(surveyTemplateItems.templateId, id))
    .orderBy(asc(surveyTemplateItems.sortOrder));

  return { ...template, items };
}

export async function createTemplate(
  orgId: string,
  userId: string,
  data: {
    name: string;
    description?: string | null;
    isDefault?: boolean;
    items: Array<{
      category: string;
      prompt: string;
      sortOrder?: number;
      photoRequired?: boolean;
    }>;
  },
): Promise<TemplateWithItems> {
  return db.transaction(async (tx) => {
    if (data.isDefault) {
      await tx
        .update(surveyTemplates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(surveyTemplates.organizationId, orgId));
    }

    const [template] = await tx
      .insert(surveyTemplates)
      .values({
        organizationId: orgId,
        name: data.name,
        description: data.description ?? null,
        isDefault: data.isDefault ?? false,
        createdByUserId: userId,
        updatedAt: new Date(),
      })
      .returning();

    const itemRows =
      data.items.length > 0
        ? await tx
            .insert(surveyTemplateItems)
            .values(
              data.items.map((item, idx) => ({
                templateId: template.id,
                category: item.category,
                prompt: item.prompt,
                sortOrder: item.sortOrder ?? idx,
                photoRequired: item.photoRequired ?? false,
              })),
            )
            .returning()
        : [];

    return { ...template, items: itemRows };
  });
}

export async function updateTemplate(
  id: number,
  orgId: string,
  data: {
    name?: string;
    description?: string | null;
    isDefault?: boolean;
    items?: Array<{
      category: string;
      prompt: string;
      sortOrder?: number;
      photoRequired?: boolean;
    }>;
  },
): Promise<TemplateWithItems | null> {
  const existing = await getTemplate(id, orgId);
  if (!existing) return null;

  return db.transaction(async (tx) => {
    if (data.isDefault === true) {
      await tx
        .update(surveyTemplates)
        .set({ isDefault: false, updatedAt: new Date() })
        .where(eq(surveyTemplates.organizationId, orgId));
    }

    const [template] = await tx
      .update(surveyTemplates)
      .set({
        ...(data.name != null ? { name: data.name } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(surveyTemplates.id, id), eq(surveyTemplates.organizationId, orgId)))
      .returning();

    let items = existing.items;
    if (data.items) {
      await tx.delete(surveyTemplateItems).where(eq(surveyTemplateItems.templateId, id));
      items =
        data.items.length > 0
          ? await tx
              .insert(surveyTemplateItems)
              .values(
                data.items.map((item, idx) => ({
                  templateId: id,
                  category: item.category,
                  prompt: item.prompt,
                  sortOrder: item.sortOrder ?? idx,
                  photoRequired: item.photoRequired ?? false,
                })),
              )
              .returning()
          : [];
    }

    return { ...template, items };
  });
}

export async function deleteTemplate(id: number, orgId: string): Promise<boolean> {
  const inUse = await db
    .select({ id: securitySurveys.id })
    .from(securitySurveys)
    .where(and(eq(securitySurveys.templateId, id), eq(securitySurveys.organizationId, orgId)))
    .limit(1);
  if (inUse.length > 0) {
    throw new Error("Template is in use by existing surveys");
  }

  const deleted = await db
    .delete(surveyTemplates)
    .where(and(eq(surveyTemplates.id, id), eq(surveyTemplates.organizationId, orgId)))
    .returning({ id: surveyTemplates.id });
  return deleted.length > 0;
}

export async function listSurveys(
  orgId: string,
  filters: {
    locationId?: number;
    surveyorUserId?: string;
    status?: string | string[];
    from?: Date;
    to?: Date;
    /** When set, restrict to these surveyors (non-dispatch own-only view). */
    restrictSurveyorIds?: string[];
  } = {},
): Promise<SurveyListItem[]> {
  const conditions = [eq(securitySurveys.organizationId, orgId)];

  if (filters.locationId != null) {
    conditions.push(eq(securitySurveys.locationId, filters.locationId));
  }
  if (filters.surveyorUserId) {
    conditions.push(eq(securitySurveys.surveyorUserId, filters.surveyorUserId));
  }
  if (filters.restrictSurveyorIds && filters.restrictSurveyorIds.length > 0) {
    conditions.push(inArray(securitySurveys.surveyorUserId, filters.restrictSurveyorIds));
  }
  if (filters.status) {
    const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
    if (statuses.length === 1) {
      conditions.push(eq(securitySurveys.status, statuses[0]!));
    } else if (statuses.length > 1) {
      conditions.push(inArray(securitySurveys.status, statuses));
    }
  }
  if (filters.from) {
    conditions.push(gte(securitySurveys.startedAt, filters.from));
  }
  if (filters.to) {
    conditions.push(lte(securitySurveys.startedAt, filters.to));
  }

  const rows = await db
    .select({
      survey: securitySurveys,
      locationName: locations.name,
      surveyorFirst: users.firstName,
      surveyorLast: users.lastName,
      templateName: surveyTemplates.name,
    })
    .from(securitySurveys)
    .leftJoin(locations, eq(securitySurveys.locationId, locations.id))
    .innerJoin(users, eq(securitySurveys.surveyorUserId, users.id))
    .innerJoin(surveyTemplates, eq(securitySurveys.templateId, surveyTemplates.id))
    .where(and(...conditions))
    .orderBy(desc(securitySurveys.startedAt));

  if (rows.length === 0) return [];

  const surveyIds = rows.map((r) => r.survey.id);

  // One pass: finding counts + severities for risk (avoids N+1 / heavy payloads).
  const findingRows = await db
    .select({
      surveyId: surveyFindings.surveyId,
      severity: surveyFindings.severity,
    })
    .from(surveyFindings)
    .where(inArray(surveyFindings.surveyId, surveyIds));

  const countMap = new Map<number, number>();
  const severitiesBySurvey = new Map<number, Array<{ severity: string | null }>>();
  for (const row of findingRows) {
    countMap.set(row.surveyId, (countMap.get(row.surveyId) ?? 0) + 1);
    const list = severitiesBySurvey.get(row.surveyId) ?? [];
    list.push({ severity: row.severity });
    severitiesBySurvey.set(row.surveyId, list);
  }

  const templateIds = [...new Set(rows.map((r) => r.survey.templateId))];
  const itemCounts = await db
    .select({
      templateId: surveyTemplateItems.templateId,
      count: sql<number>`count(*)::int`,
    })
    .from(surveyTemplateItems)
    .where(inArray(surveyTemplateItems.templateId, templateIds))
    .groupBy(surveyTemplateItems.templateId);
  const itemCountMap = new Map(itemCounts.map((c) => [c.templateId, c.count]));

  return rows.map((r) => {
    const risk = computeSurveyRiskSummary(severitiesBySurvey.get(r.survey.id) ?? []);
    return {
      ...r.survey,
      locationName: r.locationName ?? "Unknown site",
      surveyorName: `${r.surveyorFirst} ${r.surveyorLast}`.trim(),
      templateName: r.templateName,
      answeredCount:
        (r.survey.progressJson as { answered?: number } | null)?.answered ??
        countMap.get(r.survey.id) ??
        0,
      totalItems:
        (r.survey.progressJson as { total?: number } | null)?.total ??
        itemCountMap.get(r.survey.templateId) ??
        0,
      riskScore: risk.score,
      riskRating: risk.rating,
      riskLabel: risk.label,
    };
  });
}

export async function getSurveyDetail(
  id: number,
  orgId: string,
): Promise<SurveyDetail | null> {
  const [row] = await db
    .select({
      survey: securitySurveys,
      locationName: locations.name,
      locationAddress: locations.address,
      locationPhotoUrl: locations.photoUrl,
      locationLatitude: locations.latitude,
      locationLongitude: locations.longitude,
      surveyorFirst: users.firstName,
      surveyorLast: users.lastName,
      templateName: surveyTemplates.name,
      organizationName: organizations.name,
    })
    .from(securitySurveys)
    .leftJoin(locations, eq(securitySurveys.locationId, locations.id))
    .innerJoin(users, eq(securitySurveys.surveyorUserId, users.id))
    .innerJoin(surveyTemplates, eq(securitySurveys.templateId, surveyTemplates.id))
    .innerJoin(organizations, eq(securitySurveys.organizationId, organizations.id))
    .where(and(eq(securitySurveys.id, id), eq(securitySurveys.organizationId, orgId)))
    .limit(1);

  if (!row) return null;

  const templateItems = await db
    .select()
    .from(surveyTemplateItems)
    .where(eq(surveyTemplateItems.templateId, row.survey.templateId))
    .orderBy(asc(surveyTemplateItems.sortOrder));

  const findings = await db
    .select()
    .from(surveyFindings)
    .where(eq(surveyFindings.surveyId, id))
    .orderBy(asc(surveyFindings.id));

  const findingIds = findings.map((f) => f.id);
  const photos =
    findingIds.length > 0
      ? await db
          .select()
          .from(surveyFindingPhotos)
          .where(inArray(surveyFindingPhotos.findingId, findingIds))
          .orderBy(asc(surveyFindingPhotos.sortOrder))
      : [];

  return {
    ...row.survey,
    locationName: row.locationName,
    locationAddress: row.locationAddress,
    locationPhotoUrl: row.locationPhotoUrl ?? null,
    locationLatitude: row.locationLatitude ?? null,
    locationLongitude: row.locationLongitude ?? null,
    surveyorName: `${row.surveyorFirst} ${row.surveyorLast}`.trim(),
    templateName: row.templateName,
    organizationName: row.organizationName,
    items: templateItems,
    findings: findings.map((f) => ({
      ...f,
      photos: photos.filter((p) => p.findingId === f.id),
    })),
  };
}

export async function startSurvey(
  orgId: string,
  userId: string,
  data: {
    locationId: number;
    templateId: number;
    commandId?: number | null;
    clientNameOverride?: string | null;
  },
): Promise<SurveyDetail> {
  const template = await getTemplate(data.templateId, orgId);
  if (!template) throw new Error("Template not found");

  const location = await storage.getLocation(data.locationId, orgId);
  if (!location) throw new Error("Location not found");

  const [survey] = await db
    .insert(securitySurveys)
    .values({
      organizationId: orgId,
      locationId: data.locationId,
      templateId: data.templateId,
      surveyorUserId: userId,
      commandId: data.commandId ?? location.commandId ?? null,
      clientNameOverride: data.clientNameOverride ?? null,
      status: "in_progress",
      startedAt: new Date(),
      progressJson: { answered: 0, total: template.items.length },
      updatedAt: new Date(),
    })
    .returning();

  const detail = await getSurveyDetail(survey.id, orgId);
  if (!detail) throw new Error("Failed to load created survey");
  return detail;
}

async function refreshProgress(surveyId: number, orgId: string): Promise<void> {
  const [survey] = await db
    .select()
    .from(securitySurveys)
    .where(and(eq(securitySurveys.id, surveyId), eq(securitySurveys.organizationId, orgId)))
    .limit(1);
  if (!survey) return;

  const [itemCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(surveyTemplateItems)
    .where(eq(surveyTemplateItems.templateId, survey.templateId));

  const [answeredCount] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(surveyFindings)
    .where(eq(surveyFindings.surveyId, surveyId));

  await db
    .update(securitySurveys)
    .set({
      progressJson: {
        answered: answeredCount?.count ?? 0,
        total: itemCount?.count ?? 0,
      },
      updatedAt: new Date(),
    })
    .where(eq(securitySurveys.id, surveyId));
}

export async function updateSurvey(
  id: number,
  orgId: string,
  data: {
    status?: string;
    recommendations?: string | null;
    clientNameOverride?: string | null;
  },
): Promise<SurveyDetail | null> {
  const existing = await getSurveyDetail(id, orgId);
  if (!existing) return null;

  const patch: Partial<SecuritySurvey> = { updatedAt: new Date() };
  if (data.status != null) patch.status = data.status;
  if (data.recommendations !== undefined) patch.recommendations = data.recommendations;
  if (data.clientNameOverride !== undefined) patch.clientNameOverride = data.clientNameOverride;
  if (data.status === "completed" && !existing.completedAt) {
    patch.completedAt = new Date();
  }
  if (data.status === "archived" || data.status === "in_progress" || data.status === "draft") {
    // leave completedAt as-is
  }

  await db
    .update(securitySurveys)
    .set(patch)
    .where(and(eq(securitySurveys.id, id), eq(securitySurveys.organizationId, orgId)));

  return getSurveyDetail(id, orgId);
}

export async function completeSurvey(
  id: number,
  orgId: string,
): Promise<SurveyDetail | null> {
  const detail = await getSurveyDetail(id, orgId);
  if (!detail) return null;
  if (detail.status === "archived") {
    throw new Error("Cannot complete an archived survey");
  }

  await refreshProgress(id, orgId);
  const refreshed = await getSurveyDetail(id, orgId);
  if (!refreshed) return null;

  const answered = refreshed.findings.length;
  const total = refreshed.items.length;
  if (total > 0 && answered < total) {
    throw new Error(`Survey incomplete: ${answered}/${total} items answered`);
  }

  await db
    .update(securitySurveys)
    .set({
      status: "completed",
      completedAt: new Date(),
      progressJson: { answered, total },
      updatedAt: new Date(),
    })
    .where(and(eq(securitySurveys.id, id), eq(securitySurveys.organizationId, orgId)));

  return getSurveyDetail(id, orgId);
}

export async function upsertFinding(
  surveyId: number,
  orgId: string,
  data: {
    findingId?: number;
    templateItemId?: number | null;
    category: string;
    prompt: string;
    answer: string;
    severity?: string | null;
    notes?: string | null;
    lat?: number | null;
    lng?: number | null;
    gpsAccuracyM?: number | null;
    photoUrls?: string[];
  },
): Promise<FindingWithPhotos> {
  const [survey] = await db
    .select()
    .from(securitySurveys)
    .where(and(eq(securitySurveys.id, surveyId), eq(securitySurveys.organizationId, orgId)))
    .limit(1);
  if (!survey) throw new Error("Survey not found");
  if (survey.status === "archived" || survey.status === "completed") {
    throw new Error("Cannot edit findings on a completed or archived survey");
  }

  let finding: SurveyFinding | undefined;

  if (data.findingId) {
    const [existing] = await db
      .select()
      .from(surveyFindings)
      .where(and(eq(surveyFindings.id, data.findingId), eq(surveyFindings.surveyId, surveyId)))
      .limit(1);
    if (!existing) throw new Error("Finding not found");
    const [updated] = await db
      .update(surveyFindings)
      .set({
        category: data.category,
        prompt: data.prompt,
        answer: data.answer,
        severity: data.severity ?? null,
        notes: data.notes ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        gpsAccuracyM: data.gpsAccuracyM ?? null,
        templateItemId: data.templateItemId ?? existing.templateItemId,
        updatedAt: new Date(),
      })
      .where(eq(surveyFindings.id, data.findingId))
      .returning();
    finding = updated;
  } else if (data.templateItemId != null) {
    const [existing] = await db
      .select()
      .from(surveyFindings)
      .where(
        and(
          eq(surveyFindings.surveyId, surveyId),
          eq(surveyFindings.templateItemId, data.templateItemId),
        ),
      )
      .limit(1);

    if (existing) {
      const [updated] = await db
        .update(surveyFindings)
        .set({
          category: data.category,
          prompt: data.prompt,
          answer: data.answer,
          severity: data.severity ?? null,
          notes: data.notes ?? null,
          lat: data.lat ?? null,
          lng: data.lng ?? null,
          gpsAccuracyM: data.gpsAccuracyM ?? null,
          updatedAt: new Date(),
        })
        .where(eq(surveyFindings.id, existing.id))
        .returning();
      finding = updated;
    } else {
      const [created] = await db
        .insert(surveyFindings)
        .values({
          surveyId,
          templateItemId: data.templateItemId,
          category: data.category,
          prompt: data.prompt,
          answer: data.answer,
          severity: data.severity ?? null,
          notes: data.notes ?? null,
          lat: data.lat ?? null,
          lng: data.lng ?? null,
          gpsAccuracyM: data.gpsAccuracyM ?? null,
          updatedAt: new Date(),
        })
        .returning();
      finding = created;
    }
  } else {
    const [created] = await db
      .insert(surveyFindings)
      .values({
        surveyId,
        templateItemId: null,
        category: data.category,
        prompt: data.prompt,
        answer: data.answer,
        severity: data.severity ?? null,
        notes: data.notes ?? null,
        lat: data.lat ?? null,
        lng: data.lng ?? null,
        gpsAccuracyM: data.gpsAccuracyM ?? null,
        updatedAt: new Date(),
      })
      .returning();
    finding = created;
  }

  if (!finding) throw new Error("Failed to save finding");

  if (data.photoUrls) {
    await db.delete(surveyFindingPhotos).where(eq(surveyFindingPhotos.findingId, finding.id));
    if (data.photoUrls.length > 0) {
      await db.insert(surveyFindingPhotos).values(
        data.photoUrls.map((objectUrl, idx) => ({
          findingId: finding!.id,
          objectUrl,
          sortOrder: idx,
        })),
      );
    }
  }

  if (survey.status === "draft") {
    await db
      .update(securitySurveys)
      .set({ status: "in_progress", updatedAt: new Date() })
      .where(eq(securitySurveys.id, surveyId));
  }

  await refreshProgress(surveyId, orgId);

  const photos = await db
    .select()
    .from(surveyFindingPhotos)
    .where(eq(surveyFindingPhotos.findingId, finding.id))
    .orderBy(asc(surveyFindingPhotos.sortOrder));

  return { ...finding, photos };
}

export async function updateFinding(
  surveyId: number,
  findingId: number,
  orgId: string,
  data: {
    answer?: string;
    severity?: string | null;
    notes?: string | null;
    lat?: number | null;
    lng?: number | null;
    gpsAccuracyM?: number | null;
    photoUrls?: string[];
  },
): Promise<FindingWithPhotos | null> {
  const [survey] = await db
    .select()
    .from(securitySurveys)
    .where(and(eq(securitySurveys.id, surveyId), eq(securitySurveys.organizationId, orgId)))
    .limit(1);
  if (!survey) return null;
  if (survey.status === "archived") {
    throw new Error("Cannot edit findings on an archived survey");
  }

  const [existing] = await db
    .select()
    .from(surveyFindings)
    .where(and(eq(surveyFindings.id, findingId), eq(surveyFindings.surveyId, surveyId)))
    .limit(1);
  if (!existing) return null;

  const [updated] = await db
    .update(surveyFindings)
    .set({
      ...(data.answer != null ? { answer: data.answer } : {}),
      ...(data.severity !== undefined ? { severity: data.severity } : {}),
      ...(data.notes !== undefined ? { notes: data.notes } : {}),
      ...(data.lat !== undefined ? { lat: data.lat } : {}),
      ...(data.lng !== undefined ? { lng: data.lng } : {}),
      ...(data.gpsAccuracyM !== undefined ? { gpsAccuracyM: data.gpsAccuracyM } : {}),
      updatedAt: new Date(),
    })
    .where(eq(surveyFindings.id, findingId))
    .returning();

  if (data.photoUrls) {
    await db.delete(surveyFindingPhotos).where(eq(surveyFindingPhotos.findingId, findingId));
    if (data.photoUrls.length > 0) {
      await db.insert(surveyFindingPhotos).values(
        data.photoUrls.map((objectUrl, idx) => ({
          findingId,
          objectUrl,
          sortOrder: idx,
        })),
      );
    }
  }

  await refreshProgress(surveyId, orgId);

  const photos = await db
    .select()
    .from(surveyFindingPhotos)
    .where(eq(surveyFindingPhotos.findingId, findingId))
    .orderBy(asc(surveyFindingPhotos.sortOrder));

  return { ...updated, photos };
}

export async function deleteFinding(
  surveyId: number,
  findingId: number,
  orgId: string,
): Promise<boolean> {
  const [survey] = await db
    .select()
    .from(securitySurveys)
    .where(and(eq(securitySurveys.id, surveyId), eq(securitySurveys.organizationId, orgId)))
    .limit(1);
  if (!survey) return false;
  if (survey.status === "archived") {
    throw new Error("Cannot delete findings on an archived survey");
  }

  const deleted = await db
    .delete(surveyFindings)
    .where(and(eq(surveyFindings.id, findingId), eq(surveyFindings.surveyId, surveyId)))
    .returning({ id: surveyFindings.id });

  if (deleted.length > 0) {
    await refreshProgress(surveyId, orgId);
  }
  return deleted.length > 0;
}

export async function convertFindingToIncident(
  surveyId: number,
  findingId: number,
  orgId: string,
  userId: string,
): Promise<{ finding: FindingWithPhotos; incidentId: number }> {
  const detail = await getSurveyDetail(surveyId, orgId);
  if (!detail) throw new Error("Survey not found");

  const finding = detail.findings.find((f) => f.id === findingId);
  if (!finding) throw new Error("Finding not found");
  if (finding.convertedIncidentId) {
    throw new Error("Finding already converted to an incident");
  }

  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const incidentDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const incidentTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;

  const otherCategory = await storage.ensureOtherCategory(orgId, detail.commandId);
  const severityMap: Record<string, string> = {
    critical: "red",
    high: "orange",
    medium: "yellow",
    low: "green",
  };

  const description = [
    `Site survey finding (${finding.category})`,
    finding.prompt,
    finding.answer ? `Answer: ${finding.answer.toUpperCase()}` : null,
    finding.severity ? `Severity: ${finding.severity}` : null,
    finding.notes?.trim() || null,
    `Survey #${surveyId}`,
  ]
    .filter(Boolean)
    .join("\n");

  const incident = await storage.createIncident(
    {
      incidentDate,
      incidentTime,
      locationId: detail.locationId,
      locationName: detail.locationName,
      latitude: finding.lat ?? null,
      longitude: finding.lng ?? null,
      categoryId: otherCategory.id,
      otherCategoryNote: `Security survey: ${finding.category}`,
      description,
      severity: finding.severity ? severityMap[finding.severity] ?? null : null,
      commandId: detail.commandId ?? null,
      isLive: false,
    },
    orgId,
    userId,
  );

  const [updated] = await db
    .update(surveyFindings)
    .set({ convertedIncidentId: incident.id, updatedAt: new Date() })
    .where(eq(surveyFindings.id, findingId))
    .returning();

  return {
    finding: { ...updated, photos: finding.photos },
    incidentId: incident.id,
  };
}
