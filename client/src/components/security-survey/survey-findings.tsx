import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import type {
  SecuritySurveyDetail,
  SecuritySurveyListItem,
} from "@/lib/security-survey-types";
import { SEVERITY_CHIP } from "@/lib/security-survey-types";
import { cn } from "@/lib/utils";

export function SurveyFindings() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [surveyId, setSurveyId] = useState<string>("");

  const { data: surveys = [] } = useQuery<SecuritySurveyListItem[]>({
    queryKey: ["/api/security-surveys", "active"],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/security-surveys?status=draft,in_progress",
      );
      return res.json();
    },
  });

  const { data: completed = [] } = useQuery<SecuritySurveyListItem[]>({
    queryKey: ["/api/security-surveys", "completed-recent"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/security-surveys?status=completed");
      return res.json();
    },
  });

  const options = [...surveys, ...completed];

  const { data: detail, isLoading } = useQuery<SecuritySurveyDetail>({
    queryKey: ["/api/security-surveys", surveyId],
    enabled: !!surveyId,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/security-surveys/${surveyId}`);
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (findingId: number) => {
      await apiRequest("DELETE", `/api/security-surveys/${surveyId}/findings/${findingId}`);
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys", surveyId] });
      toast({ title: "Finding deleted" });
    },
    onError: (err: Error) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const convertMutation = useMutation({
    mutationFn: async (findingId: number) => {
      const res = await apiRequest(
        "POST",
        `/api/security-surveys/${surveyId}/findings/${findingId}/convert-incident`,
        {},
      );
      return res.json() as Promise<{ incidentId: number }>;
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys", surveyId] });
      toast({
        title: "Incident created",
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

  return (
    <div className="space-y-4" data-testid="survey-findings">
      <Select value={surveyId} onValueChange={setSurveyId}>
        <SelectTrigger>
          <SelectValue placeholder="Select a survey" />
        </SelectTrigger>
        <SelectContent>
          {options.map((s) => (
            <SelectItem key={s.id} value={String(s.id)}>
              #{s.id} · {s.locationName} · {String(s.status).replace(/_/g, " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {!surveyId ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          Select an active or completed survey to review findings.
        </p>
      ) : isLoading || !detail ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : detail.findings.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">No findings yet.</p>
      ) : (
        <div className="space-y-2">
          {detail.findings.map((f) => (
            <div key={f.id} className="rounded-lg border p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <Badge variant="outline" className="text-[10px]">
                    {f.category}
                  </Badge>
                  <p className="text-sm font-medium mt-1">{f.prompt}</p>
                </div>
                <Badge className="uppercase shrink-0">{f.answer}</Badge>
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
              <div className="flex flex-wrap gap-2">
                {detail.status !== "completed" && detail.status !== "archived" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs text-destructive"
                    onClick={() => deleteMutation.mutate(f.id)}
                  >
                    <Trash2 className="h-3 w-3 mr-1" />
                    Delete
                  </Button>
                )}
                {f.convertedIncidentId ? (
                  <Link
                    href={`/occurrence-book?incident=${f.convertedIncidentId}`}
                    className="text-xs text-primary underline self-center"
                  >
                    Incident #{f.convertedIncidentId}
                  </Link>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => convertMutation.mutate(f.id)}
                    disabled={convertMutation.isPending}
                  >
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Create incident
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
