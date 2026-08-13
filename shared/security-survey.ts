import { z } from "zod";
import { DISPATCH_STAFF_ROLES, isDispatchStaff } from "./user-roles";
import { SURVEY_ANSWERS, SURVEY_SEVERITIES, SURVEY_STATUSES } from "./schema";

/** Checklist categories for site / security surveys. */
export const SURVEY_CATEGORIES = [
  "Perimeter",
  "Access Control",
  "Lighting",
  "CCTV",
  "Guard Posts",
  "Alarm Systems",
  "Fire Safety",
  "General Observations",
] as const;
export type SurveyCategory = (typeof SURVEY_CATEGORIES)[number];

/** Roles that may start and complete surveys in the field. */
export const SURVEY_CONDUCT_ROLES = [
  "administrator",
  "supervisor",
  "control_room",
  "patrol_user",
] as const;

/** Roles that may edit templates and archive surveys. */
export const SURVEY_MANAGE_ROLES = ["administrator", "supervisor"] as const;

export function canConductSecuritySurvey(role: string): boolean {
  return (SURVEY_CONDUCT_ROLES as readonly string[]).includes(role);
}

export function canManageSurveyTemplates(role: string): boolean {
  return (SURVEY_MANAGE_ROLES as readonly string[]).includes(role);
}

export function canViewAllCompletedSurveys(role: string): boolean {
  return isDispatchStaff(role);
}

export function canAccessSecuritySurveyModule(role: string): boolean {
  return canConductSecuritySurvey(role) || canViewAllCompletedSurveys(role);
}

export { DISPATCH_STAFF_ROLES, isDispatchStaff };

export const surveyAnswerSchema = z.enum(SURVEY_ANSWERS);
export const surveySeveritySchema = z.enum(SURVEY_SEVERITIES);
export const surveyStatusSchema = z.enum(SURVEY_STATUSES);
export const surveyCategorySchema = z.enum(SURVEY_CATEGORIES);

export const templateItemInputSchema = z.object({
  category: surveyCategorySchema,
  prompt: z.string().min(1).max(500),
  sortOrder: z.number().int().min(0).optional(),
  photoRequired: z.boolean().optional(),
});

export const createTemplateBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  isDefault: z.boolean().optional(),
  items: z.array(templateItemInputSchema).min(1).max(200),
});

export const updateTemplateBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional().nullable(),
  isDefault: z.boolean().optional(),
  items: z.array(templateItemInputSchema).min(1).max(200).optional(),
});

export const startSurveyBodySchema = z.object({
  locationId: z.number().int().positive(),
  templateId: z.number().int().positive(),
  commandId: z.number().int().positive().optional().nullable(),
  clientNameOverride: z.string().max(300).optional().nullable(),
});

export const updateSurveyBodySchema = z.object({
  status: surveyStatusSchema.optional(),
  recommendations: z.string().max(10000).optional().nullable(),
  clientNameOverride: z.string().max(300).optional().nullable(),
});

export const upsertFindingBodySchema = z.object({
  templateItemId: z.number().int().positive().optional().nullable(),
  category: surveyCategorySchema,
  prompt: z.string().min(1).max(500),
  answer: surveyAnswerSchema,
  severity: surveySeveritySchema.optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  lat: z.number().min(-90).max(90).optional().nullable(),
  lng: z.number().min(-180).max(180).optional().nullable(),
  gpsAccuracyM: z.number().positive().max(5000).optional().nullable(),
  photoUrls: z.array(z.string().min(1).max(2000)).max(12).optional(),
  /** When set, update this finding instead of creating/upserting by templateItemId. */
  findingId: z.number().int().positive().optional(),
});

export const emailSurveyPdfBodySchema = z.object({
  pdfBase64: z.string().min(1),
  filename: z.string().min(1).max(200).optional(),
  recipients: z.array(z.string().email()).min(1).max(10),
  subject: z.string().max(300).optional(),
  message: z.string().max(5000).optional(),
});

/** Default checklist prompts seeded per org on first migrate. */
export const DEFAULT_SURVEY_TEMPLATE_ITEMS: Array<{
  category: SurveyCategory;
  prompt: string;
  photoRequired?: boolean;
}> = [
  { category: "Perimeter", prompt: "Is the perimeter fence/wall intact with no breaches?", photoRequired: true },
  { category: "Perimeter", prompt: "Are perimeter gates secure and lockable?" },
  { category: "Perimeter", prompt: "Is vegetation cleared so the perimeter line of sight is clear?" },
  { category: "Access Control", prompt: "Is the main access point staffed or controlled?" },
  { category: "Access Control", prompt: "Are visitor / vehicle logs being completed?" },
  { category: "Access Control", prompt: "Are access credentials / keys controlled and accounted for?" },
  { category: "Lighting", prompt: "Is perimeter lighting operational after dark?" },
  { category: "Lighting", prompt: "Are high-risk areas (parking, stores, plant) adequately lit?", photoRequired: true },
  { category: "CCTV", prompt: "Are CCTV cameras covering critical approaches and assets?" },
  { category: "CCTV", prompt: "Is the recording / NVR system operational with correct time sync?" },
  { category: "CCTV", prompt: "Can live views be reviewed from the control room?" },
  { category: "Guard Posts", prompt: "Is the guard house / post manned as scheduled?" },
  { category: "Guard Posts", prompt: "Do guards have working radios / panic devices?" },
  { category: "Guard Posts", prompt: "Is the post logbook up to date?" },
  { category: "Alarm Systems", prompt: "Is the intruder alarm armed/tested and reporting correctly?" },
  { category: "Alarm Systems", prompt: "Are panic / duress buttons functional where installed?" },
  { category: "Fire Safety", prompt: "Are fire extinguishers present, charged, and in date?", photoRequired: true },
  { category: "Fire Safety", prompt: "Are emergency exits clear and exit signage visible?" },
  { category: "Fire Safety", prompt: "Is the fire detection / hose reel equipment serviceable?" },
  { category: "General Observations", prompt: "Are there any immediate security risks requiring escalation?", photoRequired: true },
  { category: "General Observations", prompt: "Is housekeeping acceptable (no concealment or trip hazards)?" },
  { category: "General Observations", prompt: "Any other observations for the client report?" },
];

/** Warehouse-focused checklist (same categories, site-type wording). */
export const WAREHOUSE_SURVEY_TEMPLATE_ITEMS: Array<{
  category: SurveyCategory;
  prompt: string;
  photoRequired?: boolean;
}> = [
  { category: "Perimeter", prompt: "Is the warehouse yard perimeter fence/wall intact with no breaches or climb points?", photoRequired: true },
  { category: "Perimeter", prompt: "Are vehicle and pedestrian gates controlled, lockable, and in good condition?" },
  { category: "Perimeter", prompt: "Is vegetation / scrap cleared so the perimeter and yard stay visible?" },
  { category: "Access Control", prompt: "Is the main warehouse entrance / reception staffed or access-controlled?" },
  { category: "Access Control", prompt: "Are truck / visitor / contractor logs completed at the gate or reception?" },
  { category: "Access Control", prompt: "Are keys, access cards, and roller-shutter remotes controlled and accounted for?" },
  { category: "Access Control", prompt: "Are loading-bay / dock doors secured when not actively in use?", photoRequired: true },
  { category: "Lighting", prompt: "Is yard, parking, and perimeter lighting operational after dark?" },
  { category: "Lighting", prompt: "Are loading bays, high-value stores, and racking aisles adequately lit?", photoRequired: true },
  { category: "CCTV", prompt: "Do cameras cover gates, loading bays, high-value areas, and main approaches?", photoRequired: true },
  { category: "CCTV", prompt: "Is recording / NVR operational with correct time sync and usable retention?" },
  { category: "CCTV", prompt: "Can live warehouse views be reviewed from the control room / office?" },
  { category: "Guard Posts", prompt: "Is the gate / guard post manned as scheduled during operating and after-hours?" },
  { category: "Guard Posts", prompt: "Do guards have working radios / panic devices and know warehouse escalation steps?" },
  { category: "Guard Posts", prompt: "Is the post / gate logbook up to date (vehicles, seals, incidents)?" },
  { category: "Alarm Systems", prompt: "Is the intruder alarm armed/tested correctly for warehouse zones after hours?" },
  { category: "Alarm Systems", prompt: "Are panic / duress buttons functional where installed (office, cash, high-value)?" },
  { category: "Fire Safety", prompt: "Are fire extinguishers present, charged, in date, and not blocked by stock?", photoRequired: true },
  { category: "Fire Safety", prompt: "Are emergency exits and escape routes clear of pallets, cages, and packaging?" },
  { category: "Fire Safety", prompt: "Is fire detection / hose reel / sprinkler equipment serviceable where installed?" },
  { category: "General Observations", prompt: "Is high-value / bonded stock area secured separately from general warehousing?" },
  { category: "General Observations", prompt: "Are there any immediate security risks requiring escalation?", photoRequired: true },
  { category: "General Observations", prompt: "Is housekeeping acceptable (no concealment spaces, trip hazards, or stock blocking cameras)?" },
  { category: "General Observations", prompt: "Any other warehouse observations for the client report?" },
];
