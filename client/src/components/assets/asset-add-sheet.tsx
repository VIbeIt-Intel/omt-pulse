import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ASSET_TYPES, ASSET_TYPE_LABELS, type AssetType } from "@shared/assets";
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
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

type OrgUser = { id: string; firstName: string; lastName: string; role: string };
type Command = { id: number; name: string; isCentral: boolean };

type AssetAddSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: OrgUser[];
  commands: Command[];
};

const emptyForm = {
  name: "",
  assetType: "tablet" as AssetType,
  assetTag: "",
  assignedUserId: "",
  commandId: "",
  notes: "",
};

export function AssetAddSheet({ open, onOpenChange, users, commands }: AssetAddSheetProps) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const name = form.name.trim();
      if (!name) throw new Error("Enter a name");
      const res = await apiRequest("POST", "/api/assets", {
        name,
        assetType: form.assetType,
        assetTag: form.assetTag.trim() || null,
        assignedUserId: form.assignedUserId || null,
        commandId: form.commandId ? Number(form.commandId) : null,
        notes: form.notes.trim() || null,
      });
      return res.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset added" });
      onOpenChange(false);
    },
    onError: (err: Error) =>
      toast({ title: "Could not add asset", description: err.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add asset</SheetTitle>
          <SheetDescription>
            Register a tablet, generator, or other company property. Location shows here once the asset reports in.
          </SheetDescription>
        </SheetHeader>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="add-asset-name">Name *</Label>
            <Input
              id="add-asset-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Gate tablet 1"
              required
            />
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={form.assetType}
                onValueChange={(v) => setForm((f) => ({ ...f, assetType: v as AssetType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ASSET_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {ASSET_TYPE_LABELS[type]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-asset-tag">Asset tag</Label>
              <Input
                id="add-asset-tag"
                value={form.assetTag}
                onChange={(e) => setForm((f) => ({ ...f, assetTag: e.target.value }))}
                placeholder="Serial or tag"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Assigned to</Label>
              <Select
                value={form.assignedUserId || "__none__"}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, assignedUserId: v === "__none__" ? "" : v }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.firstName} {u.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Group</Label>
              <Select
                value={form.commandId || "__current__"}
                onValueChange={(v) => setForm((f) => ({ ...f, commandId: v === "__current__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Current group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__current__">Current group</SelectItem>
                  {commands.map((c) => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name}
                      {c.isCentral ? " (Central)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="add-asset-notes">Notes</Label>
              <Input
                id="add-asset-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" />
            {createMutation.isPending ? "Adding…" : "Add asset"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
