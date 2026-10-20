import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Plus } from "lucide-react";
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

type FleetAddVehicleSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  users: OrgUser[];
  commands: Command[];
  onCreated?: (deviceId: number) => void;
};

const emptyForm = {
  imei: "",
  label: "",
  vehicleRegistration: "",
  vehicleMake: "",
  vehicleModel: "",
  odometerKm: "",
  simPhone: "",
  assignedUserId: "",
  commandId: "",
  notes: "",
};

export function FleetAddVehicleSheet({
  open,
  onOpenChange,
  users,
  commands,
  onCreated,
}: FleetAddVehicleSheetProps) {
  const { toast } = useToast();
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (open) setForm(emptyForm);
  }, [open]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const imei = form.imei.trim().replace(/[\s-]/g, "");
      if (!/^\d{10,20}$/.test(imei)) {
        throw new Error("IMEI must be 10–20 digits");
      }

      let lastMileageKm: number | null = null;
      const odoRaw = form.odometerKm.trim().replace(",", ".");
      if (odoRaw) {
        const km = Number(odoRaw);
        if (!Number.isFinite(km) || km < 0 || km > 10_000_000) {
          throw new Error("Enter a valid odometer reading");
        }
        lastMileageKm = Math.round(km * 10) / 10;
      }

      const res = await apiRequest("POST", "/api/trackers", {
        imei,
        label: form.label.trim() || null,
        vehicleRegistration: form.vehicleRegistration.trim() || null,
        vehicleMake: form.vehicleMake.trim() || null,
        vehicleModel: form.vehicleModel.trim() || null,
        simPhone: form.simPhone.trim() || null,
        assignedUserId: form.assignedUserId || null,
        commandId: form.commandId ? Number(form.commandId) : null,
        notes: form.notes.trim() || null,
        lastMileageKm,
      });
      return (await res.json()) as { id: number };
    },
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/trackers"] });
      toast({ title: "Vehicle added", description: "It will show online when the tracker connects on port 7711." });
      onOpenChange(false);
      onCreated?.(created.id);
    },
    onError: (err: Error) =>
      toast({ title: "Could not add vehicle", description: err.message, variant: "destructive" }),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Add vehicle</SheetTitle>
          <SheetDescription>
            Register a tracker IMEI and vehicle details now. Tracking starts when the unit connects to OMT
            (port 7711).
          </SheetDescription>
        </SheetHeader>

        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            createMutation.mutate();
          }}
        >
          <div className="rounded-lg border border-border/70 bg-muted/20 p-3 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Tracker &amp; SIM
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="add-fleet-imei">IMEI *</Label>
              <Input
                id="add-fleet-imei"
                inputMode="numeric"
                autoComplete="off"
                value={form.imei}
                onChange={(e) => setForm((f) => ({ ...f, imei: e.target.value }))}
                placeholder="15-digit tracker IMEI"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-fleet-sim">SIM phone</Label>
              <Input
                id="add-fleet-sim"
                value={form.simPhone}
                onChange={(e) => setForm((f) => ({ ...f, simPhone: e.target.value }))}
                placeholder="e.g. 065 755 4693"
              />
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="add-fleet-label">Display name</Label>
              <Input
                id="add-fleet-label"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder="e.g. Patrol vehicle 2"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-fleet-reg">Registration</Label>
              <Input
                id="add-fleet-reg"
                value={form.vehicleRegistration}
                onChange={(e) => setForm((f) => ({ ...f, vehicleRegistration: e.target.value }))}
                placeholder="Number plate"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-fleet-odometer">Odometer (km)</Label>
              <Input
                id="add-fleet-odometer"
                inputMode="decimal"
                value={form.odometerKm}
                onChange={(e) => setForm((f) => ({ ...f, odometerKm: e.target.value }))}
                placeholder="Current dash reading"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-fleet-make">Make</Label>
              <Input
                id="add-fleet-make"
                value={form.vehicleMake}
                onChange={(e) => setForm((f) => ({ ...f, vehicleMake: e.target.value }))}
                placeholder="Ford"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-fleet-model">Model</Label>
              <Input
                id="add-fleet-model"
                value={form.vehicleModel}
                onChange={(e) => setForm((f) => ({ ...f, vehicleModel: e.target.value }))}
                placeholder="Figo"
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
                value={form.commandId || "__none__"}
                onValueChange={(v) => setForm((f) => ({ ...f, commandId: v === "__none__" ? "" : v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No group</SelectItem>
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
              <Label htmlFor="add-fleet-notes">Notes</Label>
              <Input
                id="add-fleet-notes"
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Optional"
              />
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={createMutation.isPending}>
            <Plus className="h-4 w-4 mr-1" />
            {createMutation.isPending ? "Adding…" : "Add vehicle"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
