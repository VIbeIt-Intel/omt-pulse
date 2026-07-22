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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

type AssigneeCandidate = {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
};

type ScheduleForm = {
  isEnabled: boolean;
  intervalMinutes: number;
  jitterMinutes: number;
  startWithinMinutes: number;
  quietStartHour: string;
  quietEndHour: string;
  assigneeUserIds: string[];
};

const defaultScheduleForm = (): ScheduleForm => ({
  isEnabled: false,
  intervalMinutes: 60,
  jitterMinutes: 12,
  startWithinMinutes: 15,
  quietStartHour: "none",
  quietEndHour: "none",
  assigneeUserIds: [],
});

type PatrolRouteAdminSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: PatrolRoute[];
  commands: OrgCommand[];
  /** When set, open directly into create/edit (parent owns the route list). */
  launchIntent?: { mode: "create" } | { mode: "edit"; routeId: number } | null;
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

type SerializedCheckpoint = ReturnType<typeof serializeCheckpoints>[number];

/**
 * Compare the edited checkpoints against what the route was loaded with. The
 * server refuses checkpoint edits once a route has patrol history, so we must
 * only send the checkpoints PUT when they genuinely changed — otherwise saving
 * an unrelated tweak (like turning scheduled prompts off) would be blocked.
 */
function checkpointsChanged(
  next: SerializedCheckpoint[],
  route: PatrolRouteWithCheckpoints | undefined,
): boolean {
  if (!route) return true;
  const current = serializeCheckpoints(toDraftsFromRoute(route));
  if (current.length !== next.length) return true;
  return next.some((cp, i) => {
    const prev = current[i];
    return (
      !prev ||
      prev.name !== cp.name ||
      (prev.instructions ?? null) !== (cp.instructions ?? null) ||
      prev.photoRequired !== cp.photoRequired ||
      (prev.latitude ?? null) !== (cp.latitude ?? null) ||
      (prev.longitude ?? null) !== (cp.longitude ?? null)
    );
  });
}

export function PatrolRouteAdminSheet({
  open,
  onOpenChange,
  routes,
  commands,
  launchIntent = null,
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
  const [schedule, setSchedule] = useState<ScheduleForm>(defaultScheduleForm);
  const [mapSettled, setMapSettled] = useState(false);
  const parentOwnsList = launchIntent != null;

  const { data: editingRoute, isLoading: editingLoading } = useQuery<PatrolRouteWithCheckpoints>({
    queryKey: ["/api/patrol/routes", editingRouteId],
    enabled: open && mode === "edit" && editingRouteId != null,
    queryFn: async () => {
      const res = await fetch(`/api/patrol/routes/${editingRouteId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load route");
      return res.json();
    },
  });

  const { data: scheduleData } = useQuery({
    queryKey: ["/api/patrol/routes", editingRouteId, "schedule"],
    enabled: open && mode === "edit" && editingRouteId != null,
    queryFn: async () => {
      const res = await fetch(`/api/patrol/routes/${editingRouteId}/schedule`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load schedule");
      return res.json() as Promise<{
        isEnabled: boolean;
        intervalMinutes: number;
        jitterMinutes: number;
        startWithinMinutes: number;
        quietStartHour: number | null;
        quietEndHour: number | null;
        assigneeUserIds: string[];
      }>;
    },
  });

  const { data: assigneeCandidates = [] } = useQuery<AssigneeCandidate[]>({
    queryKey: ["/api/patrol/assignee-candidates"],
    enabled: open && (mode === "create" || mode === "edit"),
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

  useEffect(() => {
    if (mode !== "edit" || !scheduleData) return;
    setSchedule({
      isEnabled: scheduleData.isEnabled,
      intervalMinutes: scheduleData.intervalMinutes,
      jitterMinutes: scheduleData.jitterMinutes,
      startWithinMinutes: scheduleData.startWithinMinutes,
      quietStartHour: scheduleData.quietStartHour != null ? String(scheduleData.quietStartHour) : "none",
      quietEndHour: scheduleData.quietEndHour != null ? String(scheduleData.quietEndHour) : "none",
      assigneeUserIds: scheduleData.assigneeUserIds ?? [],
    });
  }, [mode, scheduleData]);

  function resetForm() {
    setMode("list");
    setEditingRouteId(null);
    setName("");
    setDescription("");
    setCommandId("all");
    setCheckpoints([emptyPatrolCheckpoint()]);
    setSelectedIndex(0);
    setSchedule(defaultScheduleForm());
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next) resetForm();
    onOpenChange(next);
  }

  function startCreate() {
    setEditingRouteId(null);
    setName("");
    setDescription("");
    setCommandId("all");
    setSchedule(defaultScheduleForm());
    setMode("create");
    setCheckpoints([emptyPatrolCheckpoint()]);
    setSelectedIndex(0);
  }

  function startEdit(routeId: number) {
    setEditingRouteId(routeId);
    setMode("edit");
  }

  function leaveForm() {
    if (parentOwnsList) {
      handleSheetOpenChange(false);
      return;
    }
    resetForm();
  }

  useEffect(() => {
    if (!open || !launchIntent) return;
    if (launchIntent.mode === "create") startCreate();
    else startEdit(launchIntent.routeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when sheet opens with a new intent
  }, [open, launchIntent]);

  // Delay map mount until the dialog is painted — avoids Google Maps letterboxing
  // inside animated / transformed overlays.
  useEffect(() => {
    if (!open || (mode !== "create" && mode !== "edit")) {
      setMapSettled(false);
      return;
    }
    if (mode === "edit" && editingLoading) {
      setMapSettled(false);
      return;
    }
    const t = window.setTimeout(() => setMapSettled(true), 400);
    return () => {
      window.clearTimeout(t);
      setMapSettled(false);
    };
  }, [open, mode, editingLoading]);

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
      const schedulePayload = {
        isEnabled: schedule.isEnabled,
        intervalMinutes: schedule.intervalMinutes,
        jitterMinutes: schedule.jitterMinutes,
        startWithinMinutes: schedule.startWithinMinutes,
        quietStartHour: schedule.quietStartHour === "none" ? null : parseInt(schedule.quietStartHour, 10),
        quietEndHour: schedule.quietEndHour === "none" ? null : parseInt(schedule.quietEndHour, 10),
        assigneeUserIds: schedule.assigneeUserIds,
      };

      if (mode === "create") {
        const res = await apiRequest("POST", "/api/patrol/routes", {
          name: name.trim(),
          description: description.trim() || null,
          commandId: commandId === "all" ? null : parseInt(commandId, 10),
          isActive: true,
          checkpoints: payload,
        });
        const created = (await res.json()) as { id: number };
        await apiRequest("PUT", `/api/patrol/routes/${created.id}/schedule`, schedulePayload);
        return res;
      }

      if (mode === "edit" && editingRouteId != null) {
        await apiRequest("PATCH", `/api/patrol/routes/${editingRouteId}`, {
          name: name.trim(),
          description: description.trim() || null,
          commandId: commandId === "all" ? null : parseInt(commandId, 10),
        });
        // Only rewrite checkpoints when they actually changed — the server blocks
        // checkpoint edits on routes that already have patrol history, and that
        // must not stop unrelated edits (e.g. turning off scheduled prompts).
        if (checkpointsChanged(payload, editingRoute)) {
          await apiRequest("PUT", `/api/patrol/routes/${editingRouteId}/checkpoints`, {
            checkpoints: payload,
          });
        }
        await apiRequest("PUT", `/api/patrol/routes/${editingRouteId}/schedule`, schedulePayload);
      }
    },
    onSuccess: () => {
      toast({ title: mode === "create" ? "Route created" : "Route updated" });
      void qc.invalidateQueries({ queryKey: ["/api/patrol/routes"] });
      if (editingRouteId != null) {
        void qc.invalidateQueries({ queryKey: ["/api/patrol/routes", editingRouteId] });
      }
      handleSheetOpenChange(false);
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
    <Dialog open={open} onOpenChange={handleSheetOpenChange}>
      <DialogContent
        className={cn(
          "gap-0 p-0 duration-0 data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100",
          // Avoid translate transforms — Google Maps letterboxes inside transformed ancestors.
          "!left-4 !right-4 !top-4 !bottom-4 !translate-x-0 !translate-y-0 sm:!left-[max(2vw,calc(50%-550px))] sm:!right-[max(2vw,calc(50%-550px))] sm:!top-[4vh] sm:!bottom-auto",
          isForm
            ? "flex !h-auto max-h-[min(92vh,900px)] w-auto max-w-none flex-col overflow-hidden sm:!h-[min(92vh,900px)]"
            : "max-h-[min(92vh,720px)] w-auto max-w-none overflow-y-auto p-6 sm:!h-auto",
        )}
      >
        {isForm ? (
          <>
            <DialogHeader className="shrink-0 space-y-1 border-b px-4 py-3 pr-12 text-left">
              <DialogTitle>
                {mode === "create" ? "Create patrol route" : "Edit patrol route"}
              </DialogTitle>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2 h-8 w-fit px-2 text-muted-foreground"
                onClick={leaveForm}
              >
                <ArrowLeft className="h-4 w-4 mr-1" />
                {parentOwnsList ? "Close" : "Back to routes"}
              </Button>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-4 sm:px-6">
                {mode === "edit" && editingLoading ? (
                  <div className="flex items-center justify-center py-12 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin mr-2" />
                    Loading route…
                  </div>
                ) : (
                  <>
                    <section className="space-y-3 rounded-xl border bg-card/40 p-4">
                      <div>
                        <p className="text-sm font-semibold">Route details</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Name, notes, and which group can run this route.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Name</Label>
                        <Input
                          value={name}
                          onChange={(e) => setName(e.target.value)}
                          placeholder="Route name, e.g. Perimeter round"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Description</Label>
                        <Textarea
                          value={description}
                          onChange={(e) => setDescription(e.target.value)}
                          placeholder="Optional description"
                          rows={2}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label className="text-xs text-muted-foreground">Group</Label>
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
                    </section>

                    <section className="rounded-xl border bg-card/40 p-4">
                      <PatrolRouteMapEditor
                        active={open && isForm && mapSettled}
                        checkpoints={checkpoints}
                        selectedIndex={selectedIndex}
                        onSelectCheckpoint={setSelectedIndex}
                        onUpdateCheckpoint={updateCheckpoint}
                        onAddCheckpoint={addCheckpoint}
                      />
                    </section>

                    <section className="space-y-3 rounded-xl border bg-card/40 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Checkpoints</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Ordered stops officers must clock on the run.
                          </p>
                        </div>
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="shrink-0"
                          onClick={() => {
                            const next = emptyPatrolCheckpoint();
                            addCheckpoint(next);
                            setSelectedIndex(checkpoints.length);
                          }}
                        >
                          <Plus className="h-4 w-4 mr-1" />
                          Add
                        </Button>
                      </div>
                      {checkpoints.map((cp, i) => (
                        <div
                          key={i}
                          className={cn(
                            "rounded-lg border bg-background/50 p-3 space-y-2 transition-colors",
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
                    </section>

                    <section className="space-y-3 rounded-xl border bg-card/40 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">Scheduled prompts</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Push to a patroller about every hour (±jitter)
                          </p>
                        </div>
                        <Switch
                          checked={schedule.isEnabled}
                          onCheckedChange={(v) => setSchedule((s) => ({ ...s, isEnabled: v }))}
                        />
                      </div>

                      {schedule.isEnabled && (
                        <div className="space-y-3 pt-1">
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Interval (min)</Label>
                              <Input
                                type="number"
                                min={30}
                                max={180}
                                value={schedule.intervalMinutes}
                                onChange={(e) =>
                                  setSchedule((s) => ({
                                    ...s,
                                    intervalMinutes: parseInt(e.target.value, 10) || 60,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Jitter ±</Label>
                              <Input
                                type="number"
                                min={0}
                                max={30}
                                value={schedule.jitterMinutes}
                                onChange={(e) =>
                                  setSchedule((s) => ({
                                    ...s,
                                    jitterMinutes: parseInt(e.target.value, 10) || 0,
                                  }))
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Start within</Label>
                              <Input
                                type="number"
                                min={5}
                                max={60}
                                value={schedule.startWithinMinutes}
                                onChange={(e) =>
                                  setSchedule((s) => ({
                                    ...s,
                                    startWithinMinutes: parseInt(e.target.value, 10) || 15,
                                  }))
                                }
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Quiet from (SA)</Label>
                              <Select
                                value={schedule.quietStartHour}
                                onValueChange={(v) => setSchedule((s) => ({ ...s, quietStartHour: v }))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {Array.from({ length: 24 }, (_, h) => (
                                    <SelectItem key={h} value={String(h)}>
                                      {String(h).padStart(2, "0")}:00
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Quiet until (SA)</Label>
                              <Select
                                value={schedule.quietEndHour}
                                onValueChange={(v) => setSchedule((s) => ({ ...s, quietEndHour: v }))}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="None" />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="none">None</SelectItem>
                                  {Array.from({ length: 24 }, (_, h) => (
                                    <SelectItem key={h} value={String(h)}>
                                      {String(h).padStart(2, "0")}:00
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>

                          <div className="space-y-2">
                            <Label className="text-xs">Assignees (optional)</Label>
                            <p className="text-[11px] text-muted-foreground">
                              Leave empty to use the route group / all patrol-capable users. One person is
                              prompted per cycle (round-robin).
                            </p>
                            <div className="max-h-36 overflow-y-auto space-y-1.5 rounded-md border p-2">
                              {assigneeCandidates.length === 0 ? (
                                <p className="text-xs text-muted-foreground px-1 py-2">
                                  No patrol-capable users found
                                </p>
                              ) : (
                                assigneeCandidates.map((u) => {
                                  const checked = schedule.assigneeUserIds.includes(u.id);
                                  return (
                                    <label
                                      key={u.id}
                                      className="flex items-center gap-2 text-sm px-1 py-0.5 cursor-pointer"
                                    >
                                      <input
                                        type="checkbox"
                                        className="rounded border-input"
                                        checked={checked}
                                        onChange={() =>
                                          setSchedule((s) => ({
                                            ...s,
                                            assigneeUserIds: checked
                                              ? s.assigneeUserIds.filter((id) => id !== u.id)
                                              : [...s.assigneeUserIds, u.id],
                                          }))
                                        }
                                      />
                                      <span className="truncate">
                                        {u.firstName} {u.lastName}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground ml-auto shrink-0">
                                        {u.role.replace("_", " ")}
                                      </span>
                                    </label>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </section>
                  </>
                )}
              </div>
            </div>

            {!(mode === "edit" && editingLoading) && (
              <div className="shrink-0 border-t bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
                <div className="mx-auto max-w-5xl">
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
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <DialogHeader className="mb-2 px-0">
              <DialogTitle>Patrol routes</DialogTitle>
            </DialogHeader>
            {parentOwnsList ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                Opening…
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
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
