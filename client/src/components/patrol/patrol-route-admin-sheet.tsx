import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PatrolRoute } from "@shared/schema";
import type { PatrolDetail, PatrolHistoryItem } from "@/lib/patrol-types";
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
import { Loader2, Plus, Trash2 } from "lucide-react";

type CheckpointDraft = {
  name: string;
  instructions: string;
  photoRequired: boolean;
};

type OrgCommand = { id: number; name: string };

type PatrolRouteAdminSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  routes: PatrolRoute[];
  commands: OrgCommand[];
};

const emptyCheckpoint = (): CheckpointDraft => ({
  name: "",
  instructions: "",
  photoRequired: false,
});

export function PatrolRouteAdminSheet({
  open,
  onOpenChange,
  routes,
  commands,
}: PatrolRouteAdminSheetProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [commandId, setCommandId] = useState<string>("all");
  const [checkpoints, setCheckpoints] = useState<CheckpointDraft[]>([emptyCheckpoint()]);

  const createMutation = useMutation({
    mutationFn: () => {
      const ready = checkpoints.filter((c) => c.name.trim());
      if (!name.trim()) throw new Error("Route name is required");
      if (ready.length === 0) throw new Error("Add at least one checkpoint");
      return apiRequest("POST", "/api/patrol/routes", {
        name: name.trim(),
        description: description.trim() || null,
        commandId: commandId === "all" ? null : parseInt(commandId, 10),
        isActive: true,
        checkpoints: ready.map((c, i) => ({
          name: c.name.trim(),
          orderIndex: i,
          instructions: c.instructions.trim() || null,
          photoRequired: c.photoRequired,
        })),
      });
    },
    onSuccess: () => {
      toast({ title: "Route created" });
      setName("");
      setDescription("");
      setCommandId("all");
      setCheckpoints([emptyCheckpoint()]);
      void qc.invalidateQueries({ queryKey: ["/api/patrol/routes"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiRequest("PATCH", `/api/patrol/routes/${id}`, { isActive }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["/api/patrol/routes"] }),
  });

  function updateCheckpoint(index: number, patch: Partial<CheckpointDraft>) {
    setCheckpoints((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Patrol routes</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="space-y-3 rounded-lg border p-4">
            <Label>New route</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Perimeter round" />
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

            <div className="space-y-2">
              <Label>Checkpoints (in order)</Label>
              {checkpoints.map((cp, i) => (
                <div key={i} className="rounded-md border p-3 space-y-2">
                  <div className="flex gap-2">
                    <Input
                      value={cp.name}
                      onChange={(e) => updateCheckpoint(i, { name: e.target.value })}
                      placeholder={`Checkpoint ${i + 1}`}
                      className="flex-1"
                    />
                    {checkpoints.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => setCheckpoints((prev) => prev.filter((_, j) => j !== i))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <Input
                    value={cp.instructions}
                    onChange={(e) => updateCheckpoint(i, { instructions: e.target.value })}
                    placeholder="Instructions (optional)"
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={cp.photoRequired}
                      onCheckedChange={(v) => updateCheckpoint(i, { photoRequired: v })}
                    />
                    <span className="text-xs text-muted-foreground">Photo required</span>
                  </div>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setCheckpoints((prev) => [...prev, emptyCheckpoint()])}
              >
                <Plus className="h-4 w-4 mr-1" />
                Add checkpoint
              </Button>
            </div>

            <Button
              type="button"
              className="w-full"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create route"}
            </Button>
          </div>

          {routes.length > 0 && (
            <div className="space-y-2">
              <Label>Existing routes</Label>
              <ul className="space-y-2">
                {routes.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{r.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {r.isActive ? "Active" : "Inactive"}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={toggleMutation.isPending}
                      onClick={() => toggleMutation.mutate({ id: r.id, isActive: !r.isActive })}
                    >
                      {r.isActive ? "Deactivate" : "Activate"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
