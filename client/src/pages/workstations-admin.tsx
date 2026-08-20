import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
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
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { ExpandablePhoto } from "@/components/photo-lightbox";
import { GeoMapPreview } from "@/components/incident-location-sheet";
import {
  Copy,
  Eye,
  Loader2,
  MapPin,
  Phone,
  Plus,
  RefreshCw,
  Settings,
} from "lucide-react";

type OrgCommand = { id: number; name: string; isCentral: boolean };

function groupPositionsByPremises(
  workstations: WorkstationWithDetails[],
  locations: Location[],
): Array<{ location: Location | null; fallbackName: string | null; positions: WorkstationWithDetails[] }> {
  const locById = new Map(locations.map((l) => [l.id, l]));
  const groups = new Map<number | "none", WorkstationWithDetails[]>();
  for (const ws of workstations) {
    const key = ws.locationId ?? "none";
    const list = groups.get(key) ?? [];
    list.push(ws);
    groups.set(key, list);
  }
  const named = [...groups.entries()]
    .filter(([key]) => key !== "none")
    .map(([key, positions]) => ({
      location: locById.get(key as number) ?? null,
      fallbackName: positions[0]?.locationName ?? null,
      positions,
    }))
    .sort((a, b) =>
      (a.location?.name ?? a.fallbackName ?? "").localeCompare(b.location?.name ?? b.fallbackName ?? ""),
    );
  const unassigned = groups.get("none");
  if (unassigned?.length) {
    named.push({ location: null, fallbackName: null, positions: unassigned });
  }
  return named;
}

function formatCoords(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

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
  const [mapPreview, setMapPreview] = useState<Location | null>(null);

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

  const enrolledCount = workstations.filter((ws) => ws.enrolledAt).length;
  const premisesGroups = useMemo(
    () => groupPositionsByPremises(workstations, locations),
    [workstations, locations],
  );
  const selectedLocation = locations.find((l) => String(l.id) === locationId) ?? null;

  return (
    <div className={cn(OPS_PAGE_SHELL, "py-4 md:py-6 space-y-6")}>
      <PageHero
        eyebrow="Positions"
        badge="Admin"
        total={workstations.length}
        totalLabel={workstations.length === 1 ? "Position" : "Positions"}
        actions={
          <Button type="button" size="sm" className="h-8" onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Add position
          </Button>
        }
        insights={[
          { label: "Enrolled", value: String(enrolledCount) },
          { label: "Pending", value: String(workstations.length - enrolledCount) },
        ]}
      />

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : workstations.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground space-y-3">
          <p>No positions yet. Positions sit on a Field Setup location (premises).</p>
          {locations.length === 0 ? (
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/admin#field-setup-locations">Add a location in Field setup</Link>
            </Button>
          ) : (
            <p className="text-xs">Then add East Gate Access Control, Romeo 1 Patrol, and similar posts to that site.</p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {premisesGroups.map((group) => {
            const loc = group.location;
            const title = loc?.name ?? group.fallbackName ?? "Unassigned premises";
            const hasCoords = loc?.latitude != null && loc?.longitude != null;
            return (
              <section
                key={loc?.id ?? "unassigned"}
                className="overflow-hidden rounded-xl border bg-card"
                data-testid={loc ? `premises-card-${loc.id}` : "premises-card-unassigned"}
              >
                <div className="grid md:grid-cols-[240px_1fr]">
                  <div className="bg-muted/30 min-h-[160px] md:min-h-full">
                    <ExpandablePhoto
                      photoUrl={loc?.photoUrl}
                      className="h-full min-h-[160px] w-full md:min-h-[220px]"
                      title={`${title} site photo`}
                      fallback={
                        <div className="flex h-full min-h-[160px] w-full items-center justify-center md:min-h-[220px]">
                          <MapPin className="h-10 w-10 text-muted-foreground/35" />
                        </div>
                      }
                    />
                  </div>
                  <div className="p-4 md:p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                          Field setup location
                        </p>
                        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                      </div>
                      <Button type="button" variant="outline" size="sm" className="h-8 shrink-0" asChild>
                        <Link href="/admin#field-setup-locations">
                          <Settings className="h-3.5 w-3.5 mr-1.5" />
                          Edit premises
                        </Link>
                      </Button>
                    </div>
                    <dl className="grid gap-2 sm:grid-cols-2 text-sm">
                      <div className="min-w-0">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Address</dt>
                        <dd className="mt-0.5 text-foreground">
                          {loc?.address ? (
                            hasCoords ? (
                              <button
                                type="button"
                                className="text-left text-primary hover:underline"
                                onClick={() => setMapPreview(loc)}
                              >
                                {loc.address}
                              </button>
                            ) : (
                              loc.address
                            )
                          ) : (
                            <span className="text-muted-foreground">Not recorded</span>
                          )}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Telephone</dt>
                        <dd className="mt-0.5">
                          {loc?.phone ? (
                            <a
                              href={`tel:${loc.phone.replace(/\s+/g, "")}`}
                              className="inline-flex items-center gap-1.5 text-primary hover:underline"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              {loc.phone}
                            </a>
                          ) : (
                            <span className="text-muted-foreground">Not recorded</span>
                          )}
                        </dd>
                      </div>
                      <div className="min-w-0 sm:col-span-2">
                        <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Coordinates</dt>
                        <dd className="mt-0.5 font-mono text-xs">
                          {hasCoords ? (
                            <button
                              type="button"
                              className="text-primary hover:underline"
                              onClick={() => setMapPreview(loc)}
                            >
                              {formatCoords(loc.latitude!, loc.longitude!)}
                            </button>
                          ) : (
                            <span className="font-sans text-sm text-muted-foreground">Not recorded</span>
                          )}
                        </dd>
                      </div>
                    </dl>
                  </div>
                </div>
                <div className="border-t">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Position</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Operator</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {group.positions.map((ws) => (
                        <TableRow key={ws.id}>
                          <TableCell className="font-medium">{ws.name}</TableCell>
                          <TableCell>
                            {WORKSTATION_TYPE_LABELS[ws.type as keyof typeof WORKSTATION_TYPE_LABELS] ?? ws.type}
                          </TableCell>
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
                </div>
              </section>
            );
          })}
        </div>
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
              {locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Add the site in{" "}
                  <Link href="/admin#field-setup-locations" className="text-primary hover:underline">
                    Field setup
                  </Link>{" "}
                  first — positions attach to that location.
                </p>
              ) : (
                <>
                  <Select value={locationId} onValueChange={setLocationId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select Field setup location" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={String(loc.id)}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedLocation && (
                    <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
                      <ExpandablePhoto
                        photoUrl={selectedLocation.photoUrl}
                        className="h-14 w-20 rounded-md border"
                        title={`${selectedLocation.name} site photo`}
                        fallback={
                          <div className="flex h-14 w-20 items-center justify-center rounded-md border bg-muted">
                            <MapPin className="h-5 w-5 text-muted-foreground/50" />
                          </div>
                        }
                      />
                      <div className="min-w-0 text-xs space-y-0.5">
                        <p className="font-medium text-sm text-foreground">{selectedLocation.name}</p>
                        <p className="text-muted-foreground truncate">
                          {selectedLocation.address || "Address not recorded"}
                        </p>
                        {selectedLocation.phone && (
                          <p className="text-muted-foreground">{selectedLocation.phone}</p>
                        )}
                        {selectedLocation.latitude != null && selectedLocation.longitude != null && (
                          <p className="font-mono text-[11px] text-muted-foreground">
                            {formatCoords(selectedLocation.latitude, selectedLocation.longitude)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}
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
              disabled={createMutation.isPending || locations.length === 0}
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

      <Dialog open={mapPreview != null} onOpenChange={(open) => { if (!open) setMapPreview(null); }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle>{mapPreview?.name ?? "Premises map"}</DialogTitle>
          </DialogHeader>
          {mapPreview?.latitude != null && mapPreview?.longitude != null ? (
            <GeoMapPreview
              lat={mapPreview.latitude}
              lng={mapPreview.longitude}
              label={mapPreview.name}
              open={mapPreview != null}
              className="min-h-[420px] rounded-none border-0"
              testId="positions-premises-map"
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
