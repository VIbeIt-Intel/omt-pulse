import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Destination } from "@shared/schema";
import { Button } from "@/components/ui/button";
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
import { DESTINATION_TYPE_OPTIONS } from "@/lib/access-control-labels";
import { Loader2, Plus } from "lucide-react";

type DestinationAdminSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  destinations: Destination[];
};

export function DestinationAdminSheet({ open, onOpenChange, destinations }: DestinationAdminSheetProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [type, setType] = useState("building");

  const createMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/access-control/destinations", { name: name.trim(), type, active: true }),
    onSuccess: () => {
      toast({ title: "Destination added" });
      setName("");
      void qc.invalidateQueries({ queryKey: ["/api/access-control/destinations"] });
    },
    onError: (e: Error) => {
      toast({ title: "Failed", description: e.message, variant: "destructive" });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) =>
      apiRequest("PATCH", `/api/access-control/destinations/${id}`, { active }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["/api/access-control/destinations"] });
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
        <SheetHeader>
          <SheetTitle>Manage destinations</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div className="space-y-2 rounded-lg border p-4">
            <Label>Add destination</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Office, Warehouse A"
            />
            <Select value={type} onValueChange={setType}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DESTINATION_TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              className="w-full"
              disabled={!name.trim() || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Plus className="h-4 w-4 mr-2" />
                  Add destination
                </>
              )}
            </Button>
          </div>
          <div className="space-y-2">
            <Label>Existing ({destinations.length})</Label>
            {destinations.length === 0 ? (
              <p className="text-sm text-muted-foreground">No destinations yet — add one above.</p>
            ) : (
              destinations.map((d) => (
                <div
                  key={d.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                >
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground capitalize">{d.type}</p>
                  </div>
                  <Button
                    type="button"
                    variant={d.active ? "outline" : "secondary"}
                    size="sm"
                    disabled={toggleMutation.isPending}
                    onClick={() =>
                      toggleMutation.mutate({ id: d.id, active: !d.active })
                    }
                  >
                    {d.active ? "Active" : "Inactive"}
                  </Button>
                </div>
              ))
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
