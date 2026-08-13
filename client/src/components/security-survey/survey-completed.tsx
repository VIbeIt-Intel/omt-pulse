import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Archive,
  Download,
  ExternalLink,
  Loader2,
  Mail,
  AlertTriangle,
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
            <div className="mt-4 space-y-4">
              <div>
                <p className="font-medium">{detail.locationName}</p>
                <p className="text-sm text-muted-foreground">
                  Client: {detail.clientNameOverride || detail.organizationName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {detail.surveyorName} · {detail.templateName}
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void onDownloadPdf()}>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  PDF
                </Button>
                {canArchive && detail.status !== "archived" && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => archiveMutation.mutate(detail.id)}
                    disabled={archiveMutation.isPending}
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
                  onChange={(e) => setEmailTo(e.target.value)}
                />
                <Button size="sm" onClick={() => void onEmailPdf()} disabled={emailBusy}>
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
                <p className="text-sm font-medium">Findings</p>
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
                          <img
                            key={p.id}
                            src={p.objectUrl}
                            alt=""
                            className="h-14 w-14 rounded object-cover border"
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
                          disabled={convertMutation.isPending}
                          onClick={() => convertMutation.mutate(f.id)}
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
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
