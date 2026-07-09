import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PatrolRoute } from "@shared/schema";
import type { PatrolRouteWithCheckpoints } from "@/lib/patrol-types";
import { PatrolRouteMapEditor } from "@/components/patrol/patrol-route-map-editor";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  emptyPatrolCheckpoint,
  hasCheckpointCoords,
  type PatrolCheckpointDraft,
} from "@/lib/patrol-route-draft";
import { cn } from "@/lib/utils";
import { ArrowLeft, Loader2, MapPin, Pencil, Plus, Trash2 } from "lucide-react";

type OrgCommand = { id: number; name: string };

type PatrolRouteAdminSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: PatrolRoute[];
  commands: OrgCommand[];
};

type FormMode = "list" | "create" | "edit";

function toDraftsFromRoute(route: PatrolRouteWithCheckpoints): PatrolCheckpointDraft[] {
  if (route.checkpoints.length === 0) return [emptyPatrolCheckpoint()];
  return route.checkpoints
    .sort((a, b) => a.orderIndex - b.orderIndex)
    .map((cp) => ({
      name: cp.name,
      instructions: cp.instructions ?? "",
      photoRequired: cp.photoRequired,
      latitude: cp.latitude,
      longitude: cp.longitude,
    }));
}

function serializeCheckpoints(ready: PatrolCheckpointDraft[]) {
  return ready.map((c, i) => ({
    name: c.name.trim(),
    orderIndex: i,
    instructions: c.instructions.trim() || null,
    photoRequired: c.photoRequired,
    latitude: c.latitude,
    longitude: c.longitude,
  }));
}

export function PatrolRouteAdminSheet({
  open,
  onOpenChange,
  routes,
  commands,
}: PatrolRouteAdminSheetProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [mode, setMode] = useState<FormMode>("list");
  const [editingRouteId, setEditingRouteId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commandId, setCommandId] = useState<string>("all");
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpointDraft[]>([emptyPatrolCheckpoint()]);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(0);

  const { data: editingRoute, isLoading: editingLoading } = useQuery<PatrolRouteWithCheckpoints>({
    queryKey: ["/api/patrol/routes", editingRouteId],
    enabled: open && mode === "edit" && editingRouteId != null,
    queryFn: async () => {
      const res = await fetch(`/api/patrol/routes/${editingRouteId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load route");
      return res.json();
    },
  });

  useEffect(() => {
    if (mode !== "edit" || !editingRoute) return;
    setName(editingRoute.name);
    setDescription(editingRoute.description ?? "");
    setCommandId(editingRoute.commandId != null ? String(editingRoute.commandId) : "all");
    const drafts = toDraftsFromRoute(editingRoute);
    setCheckpoints(drafts);
    setSelectedIndex(drafts.length > 0 ? 0 : null);
  }, [mode, editingRoute]);

  function resetForm() {
    setMode("list");
    setEditingRouteId(null);
    setName("");
    setDescription("");
    setCommandId("all");
    setCheckpoints([emptyPatrolCheckpoint()]);
    setSelectedIndex(0);
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function startCreate() {
    resetForm();
    setMode("create");
    setCheckpoints([emptyPatrolCheckpoint()]);
    setSelectedIndex(0);
  }

  function startEdit(routeId: number) {
    setEditingRouteId(routeId);
    setMode("edit");
  }

  function updateCheckpoint(index: number, patch: Partial<PatrolCheckpointDraft>) {
    setCheckpoints((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  function addCheckpoint(draft: PatrolCheckpointDraft) {
    setCheckpoints((prev) => [...prev, draft]);
  }

  function removeCheckpoint(index: number) {
    setCheckpoints((prev) => {
      const next = prev.filter((_, j) => j !== index);
      return next.length > 0 ? next : [emptyPatrolCheckpoint()];
    });
    setSelectedIndex((prev) => {
      if (prev == null) return null;
      if (prev === index) return Math.max(0, index - 1);
      if (prev > index) return prev - 1;
      return prev;
    });
  }

  const saveMutation = useMutation({
    mutationFn: async () => {
      const ready = checkpoints.filter((c) => c.name.trim());
      if (!name.trim()) throw new Error("Route name is required");
      if (ready.length === 0) throw new Error("Add at least one checkpoint");
      const payload = serializeCheckpoints(ready);

      if (mode === "create") {
        const res = await apiRequest("POST", "/api/patrol/routes", {
          name: name.trim(),
          description: description.trim() || null,
          commandId: commandId === "all" ? null : parseInt(commandId, 10),
          isActive: true,
          checkpoints: payload,
        });
        return res;
      }

      if (mode === "edit" && editingRouteId != null) {
        await apiRequest("PATCH", `/api/patrol/routes/${editingRouteId}`, {
          name: name.trim(),
          description: description.trim() || null,
          commandId: commandId === "all" ? null : parseInt(commandId, 10),
        });
        await apiRequest("PUT", `/api/patrol/routes/${editingRouteId}/checkpoints`, {
          checkpoints: payload,
        });
      }
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Route created" : "Route updated" });
      void qc.invalidateQueries({ queryKey: ["/api/patrol/routes"] });
      if (editingRouteId != null) {
        void qc.invalidateQueries({ queryKey: ["/api/patrol/routes", editingRouteId] });
      }
      resetForm();
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/patrol/routes/${id}`, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/patrol/routes"] }),
  });

  const isForm = mode === "create" || mode === "edit";

  return (
    <Sheet open={open} onOpenChange={handleSheetOpenChange}>
      <SheetContent side="bottom" className="max-h-[92vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>
            {mode === "list" && "Patrol routes"}
            {mode === "create" && "Create patrol route"}
            {mode === "edit" && "Edit patrol route"}
          </SheetTitle>
        </SheetHeader>

        {isForm ? (
          <div className="mt-4 space-y-4">
            <Button type="button" variant="ghost" size="sm" className="-ml-2" onClick={resetForm}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back to routes
            </Button>

            {mode === "edit" && editingLoading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Loading route…
              </div>
            ) : (
              <>
                <div className="space-y-3 rounded-lg border p-4">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Route name, e.g. Perimeter round"
                  />
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Optional description"
                    rows={2}
                  />
                  <Select value={commandId} onValueChange={setCommandId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Group scope" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All groups</SelectItem>
                      {commands.map((c) => (
                        <SelectItem key={c.id} value={String(c.id)}>
                          {c.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <PatrolRouteMapEditor
                  checkpoints={checkpoints}
                  selectedIndex={selectedIndex}
                  onSelectCheckpoint={setSelectedIndex}
                  onUpdateCheckpoint={updateCheckpoint}
                  onAddCheckpoint={addCheckpoint}
                />

                <div className="space-y-2">
                  <Label>Checkpoints (in order)</Label>
                  {checkpoints.map((cp, i) => (
                    <div
                      key={i}
                      className={cn(
                        "rounded-md border p-3 space-y-2 transition-colors",
                        selectedIndex === i && "border-primary/60 bg-primary/5",
                      )}
                    >
                      <button
                        type="button"
                        className="w-full text-left"
                        onClick={() => setSelectedIndex(i)}
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <span className="text-xs font-medium text-muted-foreground">
                            #{i + 1}
                            {hasCheckpointCoords(cp) && (
                              <span className="ml-2 inline-flex items-center gap-0.5 text-primary">
                                <MapPin className="h-3 w-3" />
                                Pinned
                              </span>
                            )}
                          </span>
                          {checkpoints.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeCheckpoint(i);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </button>
                      <Input
                        value={cp.name}
                        onChange={(e) => updateCheckpoint(i, { name: e.target.value })}
                        onFocus={() => setSelectedIndex(i)}
                        placeholder={`Checkpoint ${i + 1}`}
                      />
                      <Input
                        value={cp.instructions}
                        onChange={(e) => updateCheckpoint(i, { instructions: e.target.value })}
                        onFocus={() => setSelectedIndex(i)}
                        placeholder="Instructions (optional)"
                      />
                      <div className="flex items-center gap-2">
                        <Switch
                          checked={cp.photoRequired}
                          onCheckedChange={(v) => updateCheckpoint(i, { photoRequired: v })}
                        />
                        <span className="text-xs text-muted-foreground">Photo required</span>
                      </div>
                      {hasCheckpointCoords(cp) && (
                        <p className="text-[11px] text-muted-foreground tabular-nums">
                          {cp.latitude!.toFixed(5)}, {cp.longitude!.toFixed(5)}
                        </p>
                      )}
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      const next = emptyPatrolCheckpoint();
                      addCheckpoint(next);
                      setSelectedIndex(checkpoints.length);
                    }}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add checkpoint
                  </Button>
                </div>

                <Button
                  type="button"
                  className="w-full"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate()}
                >
                  {saveMutation.isPending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : mode === "create" ? (
                    "Create route"
                  ) : (
                    "Save changes"
                  )}
                </Button>
              </>
            )}
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            <Button type="button" className="w-full" onClick={startCreate}>
              <Plus className="h-4 w-4 mr-1" />
              Create new route
            </Button>

            {routes.length > 0 ? (
              <ul className="space-y-2">
                {routes.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-medium truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.isActive ? "Active" : "Inactive"}
                      </p>
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      <Button type="button" variant="outline" size="sm" onClick={() => startEdit(r.id)}>
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={toggleMutation.isPending}
                        onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                      >
                        {r.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-6">
                No routes yet. Create your first patrol route above.
              </p>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
