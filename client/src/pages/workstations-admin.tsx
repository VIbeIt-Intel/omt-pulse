import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Location, WorkstationWithDetails } from "@shared/schema";
import { WORKSTATION_TYPE_LABELS, WORKSTATION_TYPES } from "@shared/workstations";
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
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Copy, Eye, Loader2, MonitorSmartphone, Plus, RefreshCw } from "lucide-react";

type OrgCommand = { id: number; name: string; isCentral: boolean };

export default function WorkstationsAdminPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<(typeof WORKSTATION_TYPES)[number]>("gate_desk");
  const [locationId, setLocationId] = useState("");
  const [commandId, setCommandId] = useState("");
  const [enrolDialog, setEnrolDialog] = useState<{ code: string; name: string; expiresAt: string } | null>(null);
  const [reenrolConfirm, setReenrolConfirm] = useState<WorkstationWithDetails | null>(null);

  const { data: workstations = [], isLoading } = useQuery<WorkstationWithDetails[]>({
    queryKey: ["/api/workstations"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: commands = [] } = useQuery<OrgCommand[]>({
    queryKey: ["/api/commands"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const loc = parseInt(locationId, 10);
      if (!name.trim() || !Number.isFinite(loc)) throw new Error("Name and premises are required");
      const res = await apiRequest("POST", "/api/workstations", {
        name: name.trim(),
        type,
        locationId: loc,
        commandId: commandId ? parseInt(commandId, 10) : null,
        kioskMode: type === "gate_desk",
        isActive: true,
      });
      return res.json();
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ["/api/workstations"] });
      setDialogOpen(false);
      setName("");
      setLocationId("");
      setCommandId("");
      setEnrolDialog({
        code: data.enrolmentCode,
        name: data.name,
        expiresAt: data.enrolmentExpiresAt,
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  /** Non-destructive: reveal existing code (or issue one if missing/expired). Never unbinds. */
  const showCodeMutation = useMutation({
    mutationFn: async (ws: WorkstationWithDetails) => {
      const res = await apiRequest("GET", `/api/workstations/${ws.id}/enrolment-code`);
      return { ...(await res.json()), name: ws.name };
    },
    onSuccess: (data) => {
      if (data.issuedNew) {
        void qc.invalidateQueries({ queryKey: ["/api/workstations"] });
      }
      setEnrolDialog({
        code: data.enrolmentCode,
        name: data.name,
        expiresAt: data.enrolmentExpiresAt,
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  /** Destructive: unbind device + new code (only after confirm). */
  const regenerateMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/workstations/${id}/regenerate-code`, {});
      return res.json();
    },
    onSuccess: (data, id) => {
      void qc.invalidateQueries({ queryKey: ["/api/workstations"] });
      const ws = workstations.find((w) => w.id === id) ?? reenrolConfirm;
      setReenrolConfirm(null);
      setEnrolDialog({
        code: data.enrolmentCode,
        name: ws?.name ?? "Position",
        expiresAt: data.enrolmentExpiresAt,
      });
      toast({
        title: "Device unbound",
        description: "Enter this new code on the phone to enrol again.",
      });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  function copyCode(code: string) {
    void navigator.clipboard.writeText(code);
    toast({ title: "Code copied" });
  }

  const actionPending = showCodeMutation.isPending || regenerateMutation.isPending;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <MonitorSmartphone className="h-7 w-7" />
            Positions
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Dedicated company phones bound to a post (East Gate, Romeo 1, …). Create a position, then enrol the device with the code — no shift PIN.
          </p>
        </div>
        <Button type="button" onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Add position
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : workstations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No positions yet. Add East Gate Access Control, Romeo 1 Patrol, etc. to generate an enrolment code.
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Premises</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workstations.map((ws) => (
              <TableRow key={ws.id}>
                <TableCell className="font-medium">{ws.name}</TableCell>
                <TableCell>{WORKSTATION_TYPE_LABELS[ws.type as keyof typeof WORKSTATION_TYPE_LABELS] ?? ws.type}</TableCell>
                <TableCell>{ws.locationName ?? "—"}</TableCell>
                <TableCell>
                  {ws.enrolledAt ? (
                    <Badge variant="default">Enrolled</Badge>
                  ) : ws.enrolmentCode ? (
                    <Badge variant="secondary">Awaiting enrolment</Badge>
                  ) : (
                    <Badge variant="outline">Not enrolled</Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {ws.currentOperatorName ?? "—"}
                </TableCell>
                <TableCell className="text-right">
                  {ws.enrolledAt ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => setReenrolConfirm(ws)}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Re-enrol
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => showCodeMutation.mutate(ws)}
                    >
                      <Eye className="h-3.5 w-3.5 mr-1" />
                      Show code
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add position</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="East Gate Access Control" />
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WORKSTATION_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {WORKSTATION_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Premises *</Label>
              <Select value={locationId} onValueChange={setLocationId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select premises" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={String(loc.id)}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Group (optional)</Label>
              <Select value={commandId || "none"} onValueChange={(v) => setCommandId(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Any group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Any group</SelectItem>
                  {commands.map((cmd) => (
                    <SelectItem key={cmd.id} value={String(cmd.id)}>
                      {cmd.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create & get code"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!enrolDialog} onOpenChange={(open) => !open && setEnrolDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enrolment code — {enrolDialog?.name}</DialogTitle>
          </DialogHeader>
          {enrolDialog && (
            <div className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                On the dedicated phone, open Enrol device from the login screen (or go to{" "}
                <span className="font-mono">/positions/enrol</span>). Code expires in 48 hours. After enrol, the phone signs in as this position — no PIN.
              </p>
              <p className="text-xs text-muted-foreground">
                Showing this code does not unbind a device. Use Re-enrol only when you need to replace the phone.
              </p>
              <div className="flex items-center gap-2">
                <Input readOnly value={enrolDialog.code} className="font-mono text-lg tracking-widest text-center" />
                <Button type="button" variant="outline" size="icon" onClick={() => copyCode(enrolDialog.code)}>
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!reenrolConfirm} onOpenChange={(open) => !open && setReenrolConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Re-enrol {reenrolConfirm?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This unbinds the current phone and issues a new enrolment code. The old device will stop working as this position until someone enrols again with the new code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenerateMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={regenerateMutation.isPending || !reenrolConfirm}
              onClick={(e) => {
                e.preventDefault();
                if (reenrolConfirm) regenerateMutation.mutate(reenrolConfirm.id);
              }}
            >
              {regenerateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Unbind & new code"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
