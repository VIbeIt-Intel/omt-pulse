import type { SurveyAnswer, SurveySeverity, SurveyStatus } from "@shared/schema";
import type { SurveyCategory } from "@shared/security-survey";

export type SurveyTemplateSummary = {
  id: number;
  name: string;
  description: string | null;
  isDefault: boolean;
};

export type SurveyTemplateItem = {
  id: number;
  templateId: number;
  category: string;
  prompt: string;
  sortOrder: number;
  photoRequired: boolean;
};

export type SurveyTemplateDetail = SurveyTemplateSummary & {
  items: SurveyTemplateItem[];
};

export type SurveyFindingPhoto = {
  id: number;
  findingId: number;
  objectUrl: string;
  sortOrder: number;
};

export type SurveyFinding = {
  id: number;
  surveyId: number;
  templateItemId: number | null;
  category: string;
  prompt: string;
  answer: SurveyAnswer | string;
  severity: SurveySeverity | string | null;
  notes: string | null;
  lat: number | null;
  lng: number | null;
  gpsAccuracyM: number | null;
  convertedIncidentId: number | null;
  photos: SurveyFindingPhoto[];
};

export type SecuritySurveyListItem = {
  id: number;
  organizationId: string;
  locationId: number;
  templateId: number;
  surveyorUserId: string;
  status: SurveyStatus | string;
  startedAt: string;
  completedAt: string | null;
  clientNameOverride: string | null;
  recommendations: string | null;
  locationName: string | null;
  surveyorName: string;
  templateName: string;
  answeredCount: number;
  totalItems: number;
};

export type SecuritySurveyDetail = {
  id: number;
  organizationId: string;
  locationId: number;
  templateId: number;
  surveyorUserId: string;
  status: SurveyStatus | string;
  startedAt: string;
  completedAt: string | null;
  clientNameOverride: string | null;
  recommendations: string | null;
  locationName: string | null;
  locationAddress: string | null;
  surveyorName: string;
  templateName: string;
  organizationName: string;
  items: SurveyTemplateItem[];
  findings: SurveyFinding[];
};

export type LocalFindingDraft = {
  templateItemId: number;
  category: SurveyCategory | string;
  prompt: string;
  answer: SurveyAnswer;
  severity: SurveySeverity | null;
  notes: string;
  lat?: number | null;
  lng?: number | null;
  gpsAccuracyM?: number | null;
  photoUrls: string[];
  /** Offline data URLs not yet uploaded */
  photoDataUrls?: string[];
  serverFindingId?: number;
};

export type LocalSurveyDraft = {
  id: string;
  serverSurveyId?: number;
  locationId: number;
  locationName: string;
  templateId: number;
  templateName: string;
  clientNameOverride?: string | null;
  recommendations?: string;
  findings: Record<number, LocalFindingDraft>;
  updatedAt: number;
};

export const SEVERITY_CHIP: Record<string, string> = {
  critical: "bg-red-600 text-white",
  high: "bg-orange-500 text-white",
  medium: "bg-amber-400 text-black",
  low: "bg-emerald-600 text-white",
};
