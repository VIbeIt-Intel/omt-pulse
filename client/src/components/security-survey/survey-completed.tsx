import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Archive,
  Download,
  ExternalLink,
  Loader2,
  Mail,
  AlertTriangle,
  MapPin,
} from "lucide-react";
import type { Location } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { OmtShield } from "@/components/omt-shield";
import { ExpandablePhoto } from "@/components/photo-lightbox";
import {
  GeoLocationSheet,
  formatCoordLabel,
  type GeoMapView,
} from "@/components/incident-location-sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  buildSecuritySurveyReportPdfBase64,
  downloadSecuritySurveyReportPdf,
} from "@/lib/security-survey-report-pdf";
import type {
  SecuritySurveyDetail,
  SecuritySurveyListItem,
} from "@/lib/security-survey-types";
import { SEVERITY_CHIP } from "@/lib/security-survey-types";
import { cn } from "@/lib/utils";

const ANSWER_CHIP: Record<string, string> = {
  yes: "bg-green-600 text-white",
  no: "bg-red-600 text-white",
  na: "bg-slate-400 text-slate-900",
};

type Props = {
  canArchive: boolean;
  initialSurveyId?: number | null;
};

export function SurveyCompleted({ canArchive, initialSurveyId }: Props) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [status, setStatus] = useState("completed");
  const [locationId, setLocationId] = useState<string>("all");
  const [detailId, setDetailId] = useState<number | null>(initialSurveyId ?? null);
  const [emailTo, setEmailTo] = useState("");
  const [emailBusy, setEmailBusy] = useState(false);
  const [mapView, setMapView] = useState<GeoMapView | null>(null);

  useEffect(() => {
    if (initialSurveyId != null) setDetailId(initialSurveyId);
  }, [initialSurveyId]);

  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  const listKey = useMemo(
    () => ["/api/security-surveys", status, locationId] as const,
    [status, locationId],
  );

  const { data: surveys = [], isLoading } = useQuery<SecuritySurveyListItem[]>({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (status && status !== "all") params.set("status", status);
      if (locationId !== "all") params.set("locationId", locationId);
      const res = await apiRequest("GET", `/api/security-surveys?${params.toString()}`);
      return res.json();
    },
  });

  const { data: detail, isLoading: detailLoading } = useQuery<SecuritySurveyDetail>({
    queryKey: ["/api/security-surveys", detailId],
    enabled: detailId != null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/security-surveys/${detailId}`);
      return res.json();
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("PATCH", `/api/security-surveys/${id}`, { status: "archived" });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys"] });
      setDetailId(null);
      toast({ title: "Survey archived" });
    },
    onError: (err: Error) =>
      toast({ title: "Archive failed", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: async (findingId: number) => {
      if (!detailId) throw new Error("No survey");
      const res = await apiRequest(
        "POST",
        `/api/security-surveys/${detailId}/findings/${findingId}/convert-incident`,
        {},
      );
      return res.json() as Promise<{ incidentId: number; alreadyConverted: boolean }>;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys", detailId] });
      toast({
        title: data.alreadyConverted ? "Already linked" : "Incident created",
        description: (
          <Link href={`/occurrence-book?incident=${data.incidentId}`} className="underline">
            Open incident #{data.incidentId}
          </Link>
        ),
      });
    },
    onError: (err: Error) =>
      toast({ title: "Convert failed", description: err.message, variant: "destructive" }),
  });

  async function onDownloadPdf() {
    if (!detail) return;
    try {
      await downloadSecuritySurveyReportPdf(detail);
    } catch (err) {
      toast({
        title: "PDF failed",
        description: err instanceof Error ? err.message : "Could not build PDF",
        variant: "destructive",
      });
    }
  }

  async function onEmailPdf() {
    if (!detail) return;
    const recipients = emailTo
      .split(/[,;\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (recipients.length === 0) {
      toast({ title: "Add at least one recipient email", variant: "destructive" });
      return;
    }
    setEmailBusy(true);
    try {
      const { base64, filename } = await buildSecuritySurveyReportPdfBase64(detail);
      await apiRequest("POST", `/api/security-surveys/${detail.id}/email-pdf`, {
        pdfBase64: base64,
        filename,
        recipients,
      });
      toast({ title: "Email sent" });
      setEmailTo("");
    } catch (err) {
      toast({
        title: "Email failed",
        description: err instanceof Error ? err.message : "Could not send",
        variant: "destructive",
      });
    } finally {
      setEmailBusy(false);
    }
  }

  return (
    <div className="space-y-4" data-testid="survey-completed">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="archived">Archived</SelectItem>
              <SelectItem value="in_progress">In progress</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>Site</Label>
          <Select value={locationId} onValueChange={setLocationId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sites</SelectItem>
              {locations.map((l) => (
                <SelectItem key={l.id} value={String(l.id)}>
                  {l.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : surveys.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No surveys match these filters.
        </div>
      ) : (
        <div className="space-y-2">
          {surveys.map((s) => (
            <button
              key={s.id}
              type="button"
              className="flex w-full items-start justify-between gap-3 rounded-lg border p-3 text-left hover:bg-muted/40"
              onClick={() => setDetailId(s.id)}
            >
              <div>
                <p className="font-medium text-sm">{s.locationName}</p>
                <p className="text-xs text-muted-foreground">
                  {s.surveyorName} · {s.templateName}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {new Date(s.startedAt).toLocaleString()}
                  {s.completedAt ? ` → ${new Date(s.completedAt).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="text-right shrink-0">
                <Badge variant="secondary" className="capitalize">
                  {String(s.status).replace(/_/g, " ")}
                </Badge>
                <p className="text-[11px] text-muted-foreground mt-1">
                  {s.answeredCount}/{s.totalItems}
                </p>
              </div>
            </button>
          ))}
        </div>
      )}

      <Sheet open={detailId != null} onOpenChange={(o) => !o && setDetailId(null)}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Survey detail</SheetTitle>
          </SheetHeader>
          {detailLoading || !detail ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (
            <SurveyReportDetail
              detail={detail}
              canArchive={canArchive}
              emailTo={emailTo}
              emailBusy={emailBusy}
              archivePending={archiveMutation.isPending}
              convertPending={convertMutation.isPending}
              onEmailToChange={setEmailTo}
              onDownloadPdf={() => void onDownloadPdf()}
              onEmailPdf={() => void onEmailPdf()}
              onArchive={() => archiveMutation.mutate(detail.id)}
              onConvert={(findingId) => convertMutation.mutate(findingId)}
              onOpenMap={setMapView}
            />
          )}
        </SheetContent>
      </Sheet>

      <GeoLocationSheet view={mapView} onClose={() => setMapView(null)} />
    </div>
  );
}

function SurveyReportDetail({
  detail,
  canArchive,
  emailTo,
  emailBusy,
  archivePending,
  convertPending,
  onEmailToChange,
  onDownloadPdf,
  onEmailPdf,
  onArchive,
  onConvert,
  onOpenMap,
}: {
  detail: SecuritySurveyDetail;
  canArchive: boolean;
  emailTo: string;
  emailBusy: boolean;
  archivePending: boolean;
  convertPending: boolean;
  onEmailToChange: (v: string) => void;
  onDownloadPdf: () => void;
  onEmailPdf: () => void;
  onArchive: () => void;
  onConvert: (findingId: number) => void;
  onOpenMap: (view: GeoMapView) => void;
}) {
  const clientName = detail.clientNameOverride || detail.organizationName;
  const siteName = detail.locationName || "Site";
  const hasCoords =
    detail.locationLatitude != null &&
    detail.locationLongitude != null &&
    Number.isFinite(detail.locationLatitude) &&
    Number.isFinite(detail.locationLongitude);
  const addressLabel = detail.locationAddress?.trim() || null;
  const findingByItem = useMemo(
    () =>
      new Map(
        detail.findings
          .filter((f) => f.templateItemId != null)
          .map((f) => [f.templateItemId!, f]),
      ),
    [detail.findings],
  );

  function openLocationMap() {
    if (!hasCoords) return;
    onOpenMap({
      lat: detail.locationLatitude!,
      lng: detail.locationLongitude!,
      title: addressLabel ? `${siteName} — ${addressLabel}` : siteName,
    });
  }

  const metaRows: Array<{ field: string; value: ReactNode }> = [
    { field: "Client", value: clientName },
    { field: "Site", value: siteName },
    {
      field: "Address",
      value:
        addressLabel || hasCoords ? (
          hasCoords ? (
            <button
              type="button"
              className="inline-flex max-w-full items-start gap-1 text-left text-primary hover:underline"
              onClick={openLocationMap}
              data-testid="link-survey-report-address"
            >
              <span className="min-w-0 break-words">
                {addressLabel ||
                  formatCoordLabel(detail.locationLatitude!, detail.locationLongitude!)}
              </span>
              <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
            </button>
          ) : (
            addressLabel
          )
        ) : (
          "—"
        ),
    },
    { field: "Template", value: detail.templateName || "—" },
    { field: "Started", value: new Date(detail.startedAt).toLocaleString() },
    {
      field: "Completed",
      value: detail.completedAt ? new Date(detail.completedAt).toLocaleString() : "—",
    },
    {
      field: "Progress",
      value: `${detail.findings.length}/${detail.items.length} items`,
    },
  ];

  return (
    <div className="mt-4 space-y-4">
      <div className="flex items-start gap-3">
        <OmtShield className="h-12 w-12 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            OMT Site Survey Report
          </p>
          <p className="font-medium leading-snug">{siteName}</p>
          <p className="text-sm text-muted-foreground">{clientName}</p>
          <p className="text-xs text-muted-foreground">
            {detail.surveyorName} · {String(detail.status).replace(/_/g, " ")} · #{detail.id}
          </p>
        </div>
      </div>

      <div className="overflow-hidden rounded-md border text-sm">
        <div className="grid grid-cols-[7rem_1fr] bg-emerald-500 px-2.5 py-1.5 text-xs font-semibold text-white">
          <span>Field</span>
          <span>Value</span>
        </div>
        {metaRows.map((row) => (
          <div
            key={row.field}
            className="grid grid-cols-[7rem_1fr] border-t px-2.5 py-1.5 even:bg-muted/20"
          >
            <span className="text-muted-foreground">{row.field}</span>
            <span className="min-w-0 break-words">{row.value}</span>
          </div>
        ))}
      </div>

      {detail.locationPhotoUrl ? (
        <ExpandablePhoto
          photoUrl={detail.locationPhotoUrl}
          title={`${siteName} site photo`}
          className="aspect-[4/3] w-full rounded-md border object-cover"
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={onDownloadPdf}>
          <Download className="h-3.5 w-3.5 mr-1" />
          PDF
        </Button>
        {canArchive && detail.status !== "archived" && (
          <Button
            size="sm"
            variant="outline"
            onClick={onArchive}
            disabled={archivePending}
          >
            <Archive className="h-3.5 w-3.5 mr-1" />
            Archive
          </Button>
        )}
      </div>

      <div className="space-y-2 rounded-md border p-3">
        <Label className="flex items-center gap-1.5">
          <Mail className="h-3.5 w-3.5" />
          Email PDF
        </Label>
        <Input
          placeholder="recipient@example.com"
          value={emailTo}
          onChange={(e) => onEmailToChange(e.target.value)}
        />
        <Button size="sm" onClick={onEmailPdf} disabled={emailBusy}>
          {emailBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Send
        </Button>
      </div>

      {detail.recommendations?.trim() && (
        <div className="rounded-md bg-muted/50 p-3 text-sm">
          <p className="font-medium text-xs uppercase text-muted-foreground mb-1">
            Recommendations
          </p>
          {detail.recommendations}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-sm font-medium">Checklist</p>
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[28rem] text-left text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="px-2 py-1.5 font-semibold">#</th>
                <th className="px-2 py-1.5 font-semibold">Category</th>
                <th className="px-2 py-1.5 font-semibold">Checkpoint</th>
                <th className="px-2 py-1.5 font-semibold">Answer</th>
                <th className="px-2 py-1.5 font-semibold">Severity</th>
                <th className="px-2 py-1.5 font-semibold">Notes</th>
              </tr>
            </thead>
            <tbody>
              {detail.items.map((item, i) => {
                const f = findingByItem.get(item.id);
                const severity = f?.severity ? String(f.severity) : null;
                const answerKey = f ? String(f.answer).toLowerCase() : null;
                return (
                  <tr key={item.id} className="border-t align-top">
                    <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                    <td className="px-2 py-1.5">{item.category}</td>
                    <td className="px-2 py-1.5">{item.prompt}</td>
                    <td className="px-2 py-1.5">
                      {answerKey ? (
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                            ANSWER_CHIP[answerKey] ?? "bg-muted",
                          )}
                        >
                          {answerKey}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      {severity ? (
                        <span
                          className={cn(
                            "inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold capitalize",
                            SEVERITY_CHIP[severity] ?? "bg-muted",
                          )}
                        >
                          {severity}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {f?.notes?.trim() || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium">Findings & actions</p>
        {detail.findings.map((f) => (
          <div key={f.id} className="rounded-md border p-2.5 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <Badge variant="outline" className="text-[10px]">
                  {f.category}
                </Badge>
                <p className="text-sm mt-1">{f.prompt}</p>
              </div>
              <Badge variant="secondary" className="uppercase shrink-0">
                {f.answer}
              </Badge>
            </div>
            {f.severity && (
              <span
                className={cn(
                  "inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium",
                  SEVERITY_CHIP[f.severity] ?? "bg-muted",
                )}
              >
                {f.severity}
              </span>
            )}
            {f.notes?.trim() && (
              <p className="text-xs text-muted-foreground">{f.notes}</p>
            )}
            {f.photos.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {f.photos.map((p) => (
                  <ExpandablePhoto
                    key={p.id}
                    photoUrl={p.objectUrl}
                    className="h-14 w-14 rounded object-cover border"
                    title={f.prompt}
                  />
                ))}
              </div>
            )}
            <div className="pt-1">
              {f.convertedIncidentId ? (
                <Link
                  href={`/occurrence-book?incident=${f.convertedIncidentId}`}
                  className="inline-flex items-center text-xs text-primary underline"
                >
                  Incident #{f.convertedIncidentId}
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  disabled={convertPending}
                  onClick={() => onConvert(f.id)}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Create incident
                </Button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
