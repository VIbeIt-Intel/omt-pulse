import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { SURVEY_CATEGORIES, type SurveyCategory } from "@shared/security-survey";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { SurveyTemplateDetail, SurveyTemplateSummary } from "@/lib/security-survey-types";

type DraftItem = {
  key: string;
  category: SurveyCategory;
  prompt: string;
  photoRequired: boolean;
};

export function SurveyLibrary() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isDefault, setIsDefault] = useState(false);
  const [items, setItems] = useState<DraftItem[]>([]);

  const { data: templates = [] } = useQuery<SurveyTemplateSummary[]>({
    queryKey: ["/api/security-surveys/templates"],
  });

  const { data: detail, isLoading } = useQuery<SurveyTemplateDetail>({
    queryKey: ["/api/security-surveys/templates", selectedId],
    enabled: selectedId != null,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/security-surveys/templates/${selectedId}`);
      return res.json();
    },
  });

  useEffect(() => {
    if (!detail) return;
    setName(detail.name);
    setDescription(detail.description ?? "");
    setIsDefault(detail.isDefault);
    setItems(
      detail.items.map((it) => ({
        key: `i_${it.id}`,
        category: it.category as SurveyCategory,
        prompt: it.prompt,
        photoRequired: it.photoRequired,
      })),
    );
  }, [detail]);

  function startNew() {
    setSelectedId(null);
    setName("New survey template");
    setDescription("");
    setIsDefault(false);
    setItems([
      {
        key: `n_${Date.now()}`,
        category: "Perimeter",
        prompt: "",
        photoRequired: false,
      },
    ]);
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        isDefault,
        items: items
          .filter((i) => i.prompt.trim())
          .map((i, idx) => ({
            category: i.category,
            prompt: i.prompt.trim(),
            sortOrder: idx,
            photoRequired: i.photoRequired,
          })),
      };
      if (payload.items.length === 0) throw new Error("Add at least one checklist item");
      if (selectedId == null) {
        const res = await apiRequest("POST", "/api/security-surveys/templates", payload);
        return res.json() as Promise<SurveyTemplateDetail>;
      }
      const res = await apiRequest("PATCH", `/api/security-surveys/templates/${selectedId}`, payload);
      return res.json() as Promise<SurveyTemplateDetail>;
    },
    onSuccess: (saved) => {
      setSelectedId(saved.id);
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys/templates"] });
      toast({ title: "Template saved" });
    },
    onError: (err: Error) =>
      toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (selectedId == null) return;
      await apiRequest("DELETE", `/api/security-surveys/templates/${selectedId}`);
    },
    onSuccess: () => {
      setSelectedId(null);
      startNew();
      void qc.invalidateQueries({ queryKey: ["/api/security-surveys/templates"] });
      toast({ title: "Template deleted" });
    },
    onError: (err: Error) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4" data-testid="survey-library">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={startNew}>
          <Plus className="h-4 w-4 mr-1" />
          New template
        </Button>
        {templates.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={selectedId === t.id ? "default" : "secondary"}
            onClick={() => setSelectedId(t.id)}
          >
            {t.name}
          </Button>
        ))}
      </div>

      {(selectedId != null && isLoading) ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} id="tpl-default" />
            <Label htmlFor="tpl-default">Default template</Label>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Checklist items</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setItems((prev) => [
                    ...prev,
                    {
                      key: `n_${Date.now()}`,
                      category: "General Observations",
                      prompt: "",
                      photoRequired: false,
                    },
                  ])
                }
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Item
              </Button>
            </div>
            {items.map((item, idx) => (
              <div key={item.key} className="rounded-md border p-2 space-y-2">
                <div className="flex gap-2">
                  <Select
                    value={item.category}
                    onValueChange={(v) =>
                      setItems((prev) =>
                        prev.map((p, i) =>
                          i === idx ? { ...p, category: v as SurveyCategory } : p,
                        ),
                      )
                    }
                  >
                    <SelectTrigger className="w-[160px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SURVEY_CATEGORIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  placeholder="Prompt"
                  value={item.prompt}
                  onChange={(e) =>
                    setItems((prev) =>
                      prev.map((p, i) => (i === idx ? { ...p, prompt: e.target.value } : p)),
                    )
                  }
                />
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={item.photoRequired}
                    onChange={(e) =>
                      setItems((prev) =>
                        prev.map((p, i) =>
                          i === idx ? { ...p, photoRequired: e.target.checked } : p,
                        ),
                      )
                    }
                  />
                  Photo required
                </label>
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save template
            </Button>
            {selectedId != null && (
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
