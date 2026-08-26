import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Location } from "@shared/schema";
import type { SurveyAnswer, SurveySeverity } from "@shared/schema";
import { Camera, CheckCircle2, Loader2, MapPin, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { prepareAndUploadFile } from "@/lib/upload-media";
import { requestLocationAccess } from "@/lib/request-location-access";
import {
  enqueueOutboxJob,
  fileToDataUrl,
  isProbablyOffline,
} from "@/lib/offline-outbox";
import {
  getSurveyDraft,
  listSurveyDrafts,
  newSurveyDraftId,
  removeSurveyDraft,
  saveSurveyDraft,
} from "@/lib/security-survey-drafts";
import type {
  LocalFindingDraft,
  LocalSurveyDraft,
  SecuritySurveyDetail,
  SurveyTemplateDetail,
  SurveyTemplateSummary,
} from "@/lib/security-survey-types";
import { SEVERITY_CHIP } from "@/lib/security-survey-types";
import { cn } from "@/lib/utils";

type Props = {
  onOpenFindings?: (surveyId: number) => void;
  /** When set, load this server survey into the active editor (fullscreen edit). */
  editSurveyId?: number | null;
  onExitEdit?: () => void;
};

const ANSWERS: SurveyAnswer[] = ["yes", "no", "na"];
const SEVERITIES: SurveySeverity[] = ["critical", "high", "medium", "low"];

function draftFromSurveyDetail(survey: SecuritySurveyDetail, localId: string): LocalSurveyDraft {
  const findings: Record<number, LocalFindingDraft> = {};
  for (const f of survey.findings) {
    if (f.templateItemId == null) continue;
    findings[f.templateItemId] = {
      templateItemId: f.templateItemId,
      category: f.category,
      prompt: f.prompt,
      answer: f.answer as SurveyAnswer,
      severity: (f.severity as SurveySeverity) ?? null,
      notes: f.notes ?? "",
      lat: f.lat,
      lng: f.lng,
      gpsAccuracyM: f.gpsAccuracyM,
      photoUrls: f.photos.map((p) => p.objectUrl),
      serverFindingId: f.id,
    };
  }
  return {
    id: localId,
    serverSurveyId: survey.id,
    locationId: survey.locationId,
    locationName: survey.locationName ?? `Site #${survey.locationId}`,
    templateId: survey.templateId,
    templateName: survey.templateName,
    clientNameOverride: survey.clientNameOverride,
    recommendations: survey.recommendations ?? "",
    findings,
    updatedAt: Date.now(),
  };
}

export function SurveyConduct({ onOpenFindings, editSurveyId, onExitEdit }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const [photoTargetItemId, setPhotoTargetItemId] = useState<number | null>(null);

  const [draft, setDraft] = useState<LocalSurveyDraft | null>(null);
  const [activeSurvey, setActiveSurvey] = useState<SecuritySurveyDetail | null>(null);
  const [locationId, setLocationId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [clientOverride, setClientOverride] = useState("");
  const [recommendations, setRecommendations] = useState("");
  const [savingItemId, setSavingItemId] = useState<number | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const loadedEditIdRef = useRef<number | null>(null);

  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: templates = [] } = useQuery<SurveyTemplateSummary[]>({
    queryKey: ["/api/security-surveys/templates"],
  });
  const { data: localDrafts = [], refetch: refetchDrafts } = useQuery({
    queryKey: ["security-survey-drafts"],
    queryFn: listSurveyDrafts,
  });

  useEffect(() => {
    const onChange = () => void refetchDrafts();
    window.addEventListener("omt:survey-drafts-changed", onChange);
    window.addEventListener("omt:survey-synced", onChange);
    return () => {
      window.removeEventListener("omt:survey-drafts-changed", onChange);
      window.removeEventListener("omt:survey-synced", onChange);
    };
  }, [refetchDrafts]);

  useEffect(() => {
    if (editSurveyId == null) {
      loadedEditIdRef.current = null;
      return;
    }
    if (loadedEditIdRef.current === editSurveyId) return;
    let cancelled = false;

    async function loadForEdit(surveyId: number) {
      setEditLoading(true);
      try {
        const existingDrafts = await listSurveyDrafts();
        const localMatch = existingDrafts.find((d) => d.serverSurveyId === surveyId);

        let survey: SecuritySurveyDetail;
        const res = await apiRequest("GET", `/api/security-surveys/${surveyId}`);
        survey = (await res.json()) as SecuritySurveyDetail;

        if (survey.status === "archived") {
          throw new Error("Archived surveys cannot be edited");
        }

        if (survey.status === "completed") {
          const reopen = await apiRequest("PATCH", `/api/security-surveys/${surveyId}`, {
            status: "in_progress",
          });
          survey = (await reopen.json()) as SecuritySurveyDetail;
          void qc.invalidateQueries({ queryKey: ["/api/security-surveys"] });
        }

        if (cancelled) return;

        const localId = localMatch?.id ?? newSurveyDraftId();
        const fromServer = draftFromSurveyDetail(survey, localId);
        // Prefer server answers; keep any offline-only photo payloads from a matching draft.
        if (localMatch) {
          for (const [itemIdStr, finding] of Object.entries(fromServer.findings)) {
            const localF = localMatch.findings[Number(itemIdStr)];
            if (localF?.photoDataUrls?.length) {
              finding.photoDataUrls = localF.photoDataUrls;
            }
          }
        }

        await saveSurveyDraft(fromServer);
        if (cancelled) return;

        loadedEditIdRef.current = surveyId;
        setDraft(fromServer);
        setActiveSurvey(survey);
        setRecommendations(fromServer.recommendations ?? survey.recommendations ?? "");
        toast({
          title: "Editing report",
          description: "Make changes, then complete the survey again when finished.",
        });
      } catch (err) {
        if (cancelled) return;
        toast({
          title: "Could not open editor",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
        onExitEdit?.();
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    }

    void loadForEdit(editSurveyId);
    return () => {
      cancelled = true;
    };
    // onExitEdit is only used for failure exit; omit from deps to avoid reload loops
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [editSurveyId, qc, toast]);

  const defaultTemplateId = useMemo(() => {
    const d = templates.find((t) => t.isDefault) ?? templates[0];
    return d ? String(d.id) : "";
  }, [templates]);

  useEffect(() => {
    if (!templateId && defaultTemplateId) setTemplateId(defaultTemplateId);
  }, [defaultTemplateId, templateId]);

  const { data: templateDetail } = useQuery<SurveyTemplateDetail>({
    queryKey: ["/api/security-surveys/templates", draft?.templateId ?? templateId],
    enabled: !!(draft?.templateId || templateId),
    queryFn: async () => {
      const id = draft?.templateId ?? Number(templateId);
      const res = await apiRequest("GET", `/api/security-surveys/templates/${id}`);
      return res.json();
    },
  });

  const items = activeSurvey?.items ?? templateDetail?.items ?? [];
  const answeredCount = useMemo(() => {
    if (!draft) return 0;
    const fromDraft = items.filter((it) => draft.findings[it.id]?.answer).length;
    if (fromDraft > 0) return fromDraft;
    if (activeSurvey) return activeSurvey.findings.length;
    return 0;
  }, [activeSurvey, draft, items]);

  const pct = items.length > 0 ? Math.round((answeredCount / items.length) * 100) : 0;

  function findingFor(itemId: number): LocalFindingDraft | undefined {
    if (draft?.findings[itemId]) return draft.findings[itemId];
    const f = activeSurvey?.findings.find((x) => x.templateItemId === itemId);
    if (!f) return undefined;
    return {
      templateItemId: itemId,
      category: f.category,
      prompt: f.prompt,
      answer: f.answer as SurveyAnswer,
      severity: (f.severity as SurveySeverity) ?? null,
      notes: f.notes ?? "",
      lat: f.lat,
      lng: f.lng,
      gpsAccuracyM: f.gpsAccuracyM,
      photoUrls: f.photos.map((p) => p.objectUrl),
      serverFindingId: f.id,
    };
  }

  async function persistDraft(next: LocalSurveyDraft) {
    setDraft(next);
    await saveSurveyDraft(next);
  }

  const startMutation = useMutation({
    mutationFn: async () => {
      const locId = Number(locationId);
      const tplId = Number(templateId);
      if (!locId || !tplId) throw new Error("Select site and template");
      const loc = locations.find((l) => l.id === locId);
      const tpl = templates.find((t) => t.id === tplId);
      const localId = newSurveyDraftId();
      const local: LocalSurveyDraft = {
        id: localId,
        locationId: locId,
        locationName: loc?.name ?? `Site #${locId}`,
        templateId: tplId,
        templateName: tpl?.name ?? "Template",
        clientNameOverride: clientOverride.trim() || null,
        findings: {},
        updatedAt: Date.now(),
      };

      if (isProbablyOffline()) {
        await saveSurveyDraft(local);
        await enqueueOutboxJob({
          type: "security_survey_upsert",
          localDraftId: localId,
          start: {
            locationId: locId,
            templateId: tplId,
            clientNameOverride: clientOverride.trim() || null,
          },
        });
        return { local, survey: null as SecuritySurveyDetail | null };
      }

      const res = await apiRequest("POST", "/api/security-surveys", {
        locationId: locId,
        templateId: tplId,
        clientNameOverride: clientOverride.trim() || null,
      });
      const survey = (await res.json()) as SecuritySurveyDetail;
      local.serverSurveyId = survey.id;
      await saveSurveyDraft(local);
      return { local, survey };
    },
    onSuccess: ({ local, survey }) => {
      setDraft(local);
      setActiveSurvey(survey);
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys"] });
      toast({ title: survey ? "Survey started" : "Survey queued offline" });
    },
    onError: (err: Error) => toast({ title: "Could not start", description: err.message, variant: "destructive" }),
  });

  async function resumeDraft(d: LocalSurveyDraft) {
    setDraft(d);
    setRecommendations(d.recommendations ?? "");
    if (d.serverSurveyId) {
      try {
        const res = await apiRequest("GET", `/api/security-surveys/${d.serverSurveyId}`);
        setActiveSurvey(await res.json());
      } catch {
        setActiveSurvey(null);
      }
    } else {
      setActiveSurvey(null);
    }
  }

  async function saveFinding(itemId: number, patch: Partial<LocalFindingDraft>) {
    if (!draft) return;
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    const prev = findingFor(itemId);
    const nextFinding: LocalFindingDraft = {
      templateItemId: itemId,
      category: item.category,
      prompt: item.prompt,
      answer: patch.answer ?? prev?.answer ?? "na",
      severity: patch.severity !== undefined ? patch.severity : prev?.severity ?? null,
      notes: patch.notes !== undefined ? patch.notes : prev?.notes ?? "",
      lat: patch.lat !== undefined ? patch.lat : prev?.lat,
      lng: patch.lng !== undefined ? patch.lng : prev?.lng,
      gpsAccuracyM: patch.gpsAccuracyM !== undefined ? patch.gpsAccuracyM : prev?.gpsAccuracyM,
      photoUrls: patch.photoUrls ?? prev?.photoUrls ?? [],
      photoDataUrls: patch.photoDataUrls ?? prev?.photoDataUrls ?? [],
      serverFindingId: prev?.serverFindingId,
    };

    const nextDraft: LocalSurveyDraft = {
      ...draft,
      findings: { ...draft.findings, [itemId]: nextFinding },
      updatedAt: Date.now(),
    };
    await persistDraft(nextDraft);
    setSavingItemId(itemId);

    try {
      let lat = nextFinding.lat;
      let lng = nextFinding.lng;
      let gpsAccuracyM = nextFinding.gpsAccuracyM;
      if (lat == null || lng == null) {
        const loc = await requestLocationAccess({ probeMode: "allow-tap" });
        if (loc.lat != null && loc.lng != null) {
          lat = loc.lat;
          lng = loc.lng;
          nextFinding.lat = lat;
          nextFinding.lng = lng;
          await persistDraft({
            ...nextDraft,
            findings: { ...nextDraft.findings, [itemId]: nextFinding },
          });
        }
      }

      if (isProbablyOffline() || !nextDraft.serverSurveyId) {
        await enqueueOutboxJob({
          type: "security_survey_finding",
          localDraftId: nextDraft.id,
          surveyId: nextDraft.serverSurveyId,
          templateItemId: itemId,
          category: nextFinding.category,
          prompt: nextFinding.prompt,
          answer: nextFinding.answer,
          severity: nextFinding.severity,
          notes: nextFinding.notes,
          lat,
          lng,
          gpsAccuracyM,
          photoUrls: nextFinding.photoUrls,
          photoDataUrls: nextFinding.photoDataUrls,
          findingId: nextFinding.serverFindingId,
        });
        return;
      }

      const res = await apiRequest("POST", `/api/security-surveys/${nextDraft.serverSurveyId}/findings`, {
        templateItemId: itemId,
        category: nextFinding.category,
        prompt: nextFinding.prompt,
        answer: nextFinding.answer,
        severity: nextFinding.severity,
        notes: nextFinding.notes || null,
        lat: lat ?? null,
        lng: lng ?? null,
        gpsAccuracyM: gpsAccuracyM ?? null,
        photoUrls: nextFinding.photoUrls,
      });
      const saved = await res.json();
      nextFinding.serverFindingId = saved.id;
      nextFinding.photoUrls = (saved.photos ?? []).map((p: { objectUrl: string }) => p.objectUrl);
      nextFinding.photoDataUrls = [];
      await persistDraft({
        ...nextDraft,
        findings: { ...nextDraft.findings, [itemId]: nextFinding },
      });
      const detailRes = await apiRequest("GET", `/api/security-surveys/${nextDraft.serverSurveyId}`);
      setActiveSurvey(await detailRes.json());
    } catch (err) {
      toast({
        title: "Saved locally",
        description: err instanceof Error ? err.message : "Will sync when online",
      });
      await enqueueOutboxJob({
        type: "security_survey_finding",
        localDraftId: nextDraft.id,
        surveyId: nextDraft.serverSurveyId,
        templateItemId: itemId,
        category: nextFinding.category,
        prompt: nextFinding.prompt,
        answer: nextFinding.answer,
        severity: nextFinding.severity,
        notes: nextFinding.notes,
        lat: nextFinding.lat,
        lng: nextFinding.lng,
        gpsAccuracyM: nextFinding.gpsAccuracyM,
        photoUrls: nextFinding.photoUrls,
        photoDataUrls: nextFinding.photoDataUrls,
        findingId: nextFinding.serverFindingId,
      });
    } finally {
      setSavingItemId(null);
    }
  }

  async function onPickPhoto(file: File) {
    if (photoTargetItemId == null || !draft) return;
    const prev = findingFor(photoTargetItemId);
    try {
      if (isProbablyOffline()) {
        const dataUrl = await fileToDataUrl(file);
        await saveFinding(photoTargetItemId, {
          photoDataUrls: [...(prev?.photoDataUrls ?? []), dataUrl],
          photoUrls: prev?.photoUrls ?? [],
          answer: prev?.answer ?? "na",
        });
      } else {
        const { objectUrl } = await prepareAndUploadFile(file, { preset: "evidence" });
        await saveFinding(photoTargetItemId, {
          photoUrls: [...(prev?.photoUrls ?? []), objectUrl],
          answer: prev?.answer ?? "na",
        });
      }
    } catch (err) {
      toast({
        title: "Photo failed",
        description: err instanceof Error ? err.message : "Upload error",
        variant: "destructive",
      });
    } finally {
      setPhotoTargetItemId(null);
      if (fileRef.current) fileRef.current.value = "";
      if (cameraRef.current) cameraRef.current.value = "";
    }
  }

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!draft?.serverSurveyId) {
        await enqueueOutboxJob({
          type: "security_survey_upsert",
          localDraftId: draft!.id,
          surveyId: draft?.serverSurveyId,
          start: draft?.serverSurveyId
            ? undefined
            : {
                locationId: draft!.locationId,
                templateId: draft!.templateId,
                clientNameOverride: draft!.clientNameOverride,
              },
          patch: { recommendations: recommendations || null },
          complete: true,
        });
        return null;
      }
      await apiRequest("PATCH", `/api/security-surveys/${draft.serverSurveyId}`, {
        recommendations: recommendations || null,
      });
      const res = await apiRequest("POST", `/api/security-surveys/${draft.serverSurveyId}/complete`, {});
      return (await res.json()) as SecuritySurveyDetail;
    },
    onSuccess: async (survey) => {
      if (draft) await removeSurveyDraft(draft.id);
      setDraft(null);
      setActiveSurvey(null);
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys"] });
      toast({ title: survey ? "Survey completed" : "Completion queued offline" });
      if (survey && onOpenFindings) onOpenFindings(survey.id);
    },
    onError: (err: Error) =>
      toast({ title: "Cannot complete", description: err.message, variant: "destructive" }),
  });

  if (editLoading || (editSurveyId != null && !draft)) {
    return (
      <div className="flex justify-center py-16" data-testid="survey-edit-loading">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="space-y-4" data-testid="survey-conduct-start">
        {localDrafts.length > 0 && (
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-medium">Resume draft</p>
            {localDrafts.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-2 rounded-md border px-3 py-2"
                data-testid={`survey-draft-${d.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {d.locationName} · {d.templateName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(d.updatedAt).toLocaleString()}
                  </p>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  title="Continue draft"
                  onClick={() => void resumeDraft(d)}
                  data-testid={`survey-draft-edit-${d.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  title="Remove draft"
                  onClick={async () => {
                    await removeSurveyDraft(d.id);
                    await refetchDrafts();
                    toast({ title: "Draft removed" });
                  }}
                  data-testid={`survey-draft-delete-${d.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label>Site</Label>
            <Select value={locationId || undefined} onValueChange={setLocationId}>
              <SelectTrigger data-testid="survey-location">
                <SelectValue placeholder="Select premises" />
              </SelectTrigger>
              <SelectContent>
                {locations.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    No sites yet. Add a location in Field Admin first.
                  </div>
                ) : (
                  locations.map((l) => (
                    <SelectItem key={l.id} value={String(l.id)}>
                      {l.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Template</Label>
            <Select value={templateId || undefined} onValueChange={setTemplateId}>
              <SelectTrigger data-testid="survey-template">
                <SelectValue placeholder="Select template" />
              </SelectTrigger>
              <SelectContent>
                {templates.length === 0 ? (
                  <div className="px-2 py-3 text-sm text-muted-foreground">
                    No templates yet. Open Library and add Standard or Warehouse, then come back here.
                  </div>
                ) : (
                  templates.map((t) => (
                    <SelectItem key={t.id} value={String(t.id)}>
                      {t.name}
                      {t.isDefault ? " (default)" : ""}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Client name override (optional)</Label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={clientOverride}
              onChange={(e) => setClientOverride(e.target.value)}
              placeholder="Defaults to organisation name"
            />
          </div>
          <Button
            className="w-full"
            disabled={!locationId || !templateId || startMutation.isPending}
            onClick={() => startMutation.mutate()}
            data-testid="survey-start"
          >
            {startMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MapPin className="h-4 w-4 mr-2" />}
            Start survey
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="survey-conduct-active">
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="survey-photo-upload"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPickPhoto(f);
        }}
      />
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid="survey-photo-camera"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onPickPhoto(f);
        }}
      />

      <div className="rounded-lg border p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-medium text-sm">{draft.locationName}</p>
            <p className="text-xs text-muted-foreground">{draft.templateName}</p>
          </div>
          <Badge variant="secondary">
            {answeredCount}/{items.length}
          </Badge>
        </div>
        <Progress value={pct} className="h-2" />
        <p className="text-xs text-muted-foreground">{pct}% complete</p>
      </div>

      <div className="space-y-3">
        {items.map((item) => {
          const f = findingFor(item.id);
          const photos = [...(f?.photoUrls ?? []), ...(f?.photoDataUrls ?? [])];
          return (
            <div
              key={item.id}
              className="rounded-lg border border-border/80 bg-card p-3 space-y-3 shadow-sm"
              data-testid={`survey-checkpoint-${item.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant="outline" className="mb-1 text-[10px]">
                    {item.category}
                  </Badge>
                  <p className="text-sm font-medium leading-snug">{item.prompt}</p>
                  {item.photoRequired && (
                    <p className="text-[11px] text-amber-600 mt-0.5">Photo required</p>
                  )}
                </div>
                {savingItemId === item.id && <Loader2 className="h-4 w-4 animate-spin shrink-0" />}
              </div>

              {/* Evidence sits directly under the checkpoint heading so photos stay bound to this card. */}
              <div
                className="rounded-md border border-dashed border-border/70 bg-muted/30 p-2 space-y-2"
                data-testid={`survey-evidence-${item.id}`}
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Evidence for this checkpoint
                </p>
                <div className="flex flex-wrap gap-2 items-center">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPhotoTargetItemId(item.id);
                      cameraRef.current?.click();
                    }}
                    data-testid={`survey-camera-${item.id}`}
                  >
                    <Camera className="h-3.5 w-3.5 mr-1" />
                    Camera
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setPhotoTargetItemId(item.id);
                      fileRef.current?.click();
                    }}
                    data-testid={`survey-upload-${item.id}`}
                  >
                    <Upload className="h-3.5 w-3.5 mr-1" />
                    Upload
                  </Button>
                  {photos.map((url, i) => (
                    <div
                      key={`${url.slice(0, 24)}-${i}`}
                      className="relative h-12 w-12 rounded overflow-hidden border"
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                      <button
                        type="button"
                        className="absolute top-0 right-0 bg-black/60 p-0.5"
                        onClick={() => {
                          const urls = f?.photoUrls ?? [];
                          const dataUrls = f?.photoDataUrls ?? [];
                          if (i < urls.length) {
                            void saveFinding(item.id, {
                              photoUrls: urls.filter((_, idx) => idx !== i),
                              answer: f?.answer ?? "na",
                            });
                          } else {
                            const di = i - urls.length;
                            void saveFinding(item.id, {
                              photoDataUrls: dataUrls.filter((_, idx) => idx !== di),
                              answer: f?.answer ?? "na",
                            });
                          }
                        }}
                      >
                        <Trash2 className="h-3 w-3 text-white" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {ANSWERS.map((a) => (
                  <Button
                    key={a}
                    type="button"
                    size="sm"
                    variant={f?.answer === a ? "default" : "outline"}
                    onClick={() => void saveFinding(item.id, { answer: a })}
                  >
                    {a.toUpperCase()}
                  </Button>
                ))}
              </div>

              {(f?.answer === "no" || f?.severity) && (
                <div className="flex flex-wrap gap-1.5">
                  {SEVERITIES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-[11px] font-medium border",
                        f?.severity === s ? SEVERITY_CHIP[s] : "bg-muted text-muted-foreground",
                      )}
                      onClick={() => void saveFinding(item.id, { severity: s, answer: f?.answer ?? "no" })}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}

              <Textarea
                placeholder="Notes for this checkpoint"
                value={f?.notes ?? ""}
                onChange={(e) => {
                  if (!draft) return;
                  const prev = findingFor(item.id);
                  void persistDraft({
                    ...draft,
                    findings: {
                      ...draft.findings,
                      [item.id]: {
                        templateItemId: item.id,
                        category: item.category,
                        prompt: item.prompt,
                        answer: prev?.answer ?? "na",
                        severity: prev?.severity ?? null,
                        notes: e.target.value,
                        photoUrls: prev?.photoUrls ?? [],
                        photoDataUrls: prev?.photoDataUrls ?? [],
                        serverFindingId: prev?.serverFindingId,
                        lat: prev?.lat,
                        lng: prev?.lng,
                        gpsAccuracyM: prev?.gpsAccuracyM,
                      },
                    },
                  });
                }}
                onBlur={() => {
                  const prev = findingFor(item.id);
                  if (prev?.answer) void saveFinding(item.id, { notes: prev.notes });
                }}
                rows={2}
                className="text-sm"
              />
            </div>
          );
        })}
      </div>

      <div className="space-y-2 rounded-lg border p-3">
        <Label>Recommendations (optional summary)</Label>
        <Textarea
          value={recommendations}
          onChange={(e) => setRecommendations(e.target.value)}
          rows={2}
          placeholder="Brief client summary — detailed actions are generated from Critical/High findings"
        />
        <Button
          className="w-full"
          disabled={answeredCount < items.length || completeMutation.isPending || items.length === 0}
          onClick={() => completeMutation.mutate()}
          data-testid="survey-complete"
        >
          {completeMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <CheckCircle2 className="h-4 w-4 mr-2" />
          )}
          Complete survey
        </Button>
        {editSurveyId != null && (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => onExitEdit?.()}
            data-testid="survey-edit-cancel"
          >
            Cancel editing
          </Button>
        )}
        {answeredCount < items.length && (
          <p className="text-xs text-muted-foreground text-center">
            Answer all {items.length} items to complete ({answeredCount} done)
          </p>
        )}
      </div>
    </div>
  );
}
