import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { ArrowLeft, ChevronRight, Copy, Package, Plus, Smartphone, Trash2, User } from "lucide-react";
import { ASSET_TYPE_LABELS, type AssetType } from "@shared/assets";
import { AssetAddSheet } from "@/components/assets/asset-add-sheet";
import { GeoMapPreview } from "@/components/incident-location-sheet";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type OrgUser = { id: string; firstName: string; lastName: string; role: string };
type Command = { id: number; name: string; isCentral: boolean };

type CompanyAsset = {
  id: number;
  name: string;
  assetType: AssetType;
  assetTag: string | null;
  notes: string | null;
  commandId: number | null;
  commandName: string | null;
  assignedUserId: string | null;
  assignedUserName: string | null;
  lastSeenAt: string | null;
  lastLat: number | null;
  lastLng: number | null;
  trackerLinked: boolean;
  createdAt: string;
};

type EnrolmentCode = {
  assetId: number;
  assetName: string;
  enrolmentCode: string;
  enrolmentExpiresAt: string;
  trackerLinked: boolean;
};

function formatLastSeen(value: string | null): string {
  if (!value) return "Not reporting";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "Not reporting";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

function formatTrackedClock(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function lastTrackedLabel(value: string | null): string {
  if (!value) return "Not tracked yet";
  const relative = formatLastSeen(value);
  if (relative === "Not reporting") return "Not tracked yet";
  return `Last tracked ${relative.charAt(0).toLowerCase()}${relative.slice(1)}`;
}

export default function AssetsPage() {
  const { toast } = useToast();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CompanyAsset | null>(null);
  const [trackerCode, setTrackerCode] = useState<EnrolmentCode | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data: me } = useQuery<{ role: string }>({ queryKey: ["/api/auth/me"] });
  const canManage =
    me?.role === "administrator" || me?.role === "control_room" || me?.role === "supervisor";

  const { data: assets = [], isLoading } = useQuery<CompanyAsset[]>({
    queryKey: ["/api/assets"],
    refetchInterval: 30_000,
  });
  const { data: users = [] } = useQuery<OrgUser[]>({ queryKey: ["/api/trackers/assignees"] });
  const { data: commands = [] } = useQuery<Command[]>({ queryKey: ["/api/commands"] });

  useEffect(() => {
    const id = parseInt(new URLSearchParams(search).get("asset") ?? "", 10);
    setSelectedId(Number.isFinite(id) ? id : null);
  }, [search]);

  const selected = assets.find((asset) => asset.id === selectedId) ?? null;

  function openAsset(id: number) {
    setLocation(`/assets?asset=${id}`);
  }

  function closeAsset() {
    setLocation("/assets");
  }

  const counts = useMemo(() => {
    let reporting = 0;
    for (const asset of assets) {
      if (asset.lastSeenAt) reporting += 1;
    }
    return { reporting, silent: assets.length - reporting };
  }, [assets]);

  const codeMutation = useMutation({
    mutationFn: async (asset: CompanyAsset) => {
      const res = await apiRequest("POST", `/api/assets/${asset.id}/enrolment-code`);
      const body = (await res.json()) as {
        enrolmentCode: string;
        enrolmentExpiresAt: string;
        trackerLinked: boolean;
      };
      return { asset, ...body };
    },
    onSuccess: (issued) => {
      setTrackerCode({
        assetId: issued.asset.id,
        assetName: issued.asset.name,
        enrolmentCode: issued.enrolmentCode,
        enrolmentExpiresAt: issued.enrolmentExpiresAt,
        trackerLinked: issued.trackerLinked,
      });
    },
    onError: (err: Error) =>
      toast({ title: "Could not create a tracker code", description: err.message, variant: "destructive" }),
  });

  const unlinkMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("POST", `/api/assets/${id}/unlink-tracker`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      setTrackerCode(null);
      toast({ title: "Tracker unlinked" });
    },
    onError: (err: Error) =>
      toast({ title: "Could not unlink tracker", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/assets/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset removed" });
      setPendingDelete(null);
      setLocation("/assets");
    },
    onError: (err: Error) =>
      toast({ title: "Could not remove asset", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="h-full overflow-y-auto bg-background" data-testid="assets-page">
      <div className={cn(OPS_PAGE_SHELL, "py-4 sm:py-6 space-y-5")}>
        <PageHero
          eyebrow="Assets"
          badge="Asset register"
          total={assets.length}
          totalLabel={assets.length === 1 ? "Asset" : "Assets"}
          actions={
            canManage ? (
              <Button size="sm" className="h-8" onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                <span className="md:hidden">Add</span>
                <span className="hidden md:inline">Add asset</span>
              </Button>
            ) : null
          }
          insights={
            assets.length === 0
              ? []
              : [
                  { label: "Reporting", value: String(counts.reporting) },
                  { label: "Not reporting", value: String(counts.silent) },
                ]
          }
        />

        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <Card className="p-8 text-center space-y-4">
            <Package className="h-8 w-8 mx-auto text-muted-foreground" />
            <div className="space-y-1">
              <p className="text-sm font-medium">No assets yet</p>
              <p className="text-sm text-muted-foreground">
                Add a tablet or other company property. Location appears once that asset reports in.
              </p>
            </div>
            {canManage && (
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="h-4 w-4 mr-1" />
                Add asset
              </Button>
            )}
          </Card>
        ) : selected ? (
          <Card className="p-5 space-y-5 max-w-4xl" data-testid="asset-detail">
            <Button variant="ghost" size="sm" className="-ml-2 h-8" onClick={closeAsset}>
              <ArrowLeft className="h-4 w-4 mr-1" />
              Assets
            </Button>
            <div className="space-y-1">
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <p className="text-sm text-muted-foreground">
                {ASSET_TYPE_LABELS[selected.assetType] ?? selected.assetType}
                {selected.assetTag ? ` · ${selected.assetTag}` : ""}
              </p>
            </div>
            <div className="space-y-2 text-sm">
              <div>
                <p className="font-medium">{lastTrackedLabel(selected.lastSeenAt)}</p>
                {formatTrackedClock(selected.lastSeenAt) && (
                  <p className="text-muted-foreground">{formatTrackedClock(selected.lastSeenAt)}</p>
                )}
              </div>
              <p className="flex items-center gap-1.5 text-muted-foreground">
                <User className="h-3.5 w-3.5 shrink-0" />
                {selected.assignedUserName ?? "Unassigned"}
              </p>
              {selected.commandName && <p className="text-muted-foreground">{selected.commandName}</p>}
              {selected.notes && <p className="text-muted-foreground whitespace-pre-wrap">{selected.notes}</p>}
            </div>
            {selected.lastLat != null && selected.lastLng != null ? (
              <GeoMapPreview
                lat={selected.lastLat}
                lng={selected.lastLng}
                label={`${selected.name} — last tracked`}
                open
                className="h-[320px] min-h-[280px] rounded-lg"
                testId="asset-last-position-map"
              />
            ) : (
              <p className="text-sm text-muted-foreground">No position recorded yet.</p>
            )}
            {canManage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={codeMutation.isPending}
                  onClick={() => codeMutation.mutate(selected)}
                >
                  <Smartphone className="h-4 w-4 mr-1" />
                  Tracker code
                </Button>
                <Button variant="outline" size="sm" onClick={() => setPendingDelete(selected)}>
                  <Trash2 className="h-4 w-4 mr-1" />
                  Remove
                </Button>
              </div>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {assets.map((asset) => (
              <Card key={asset.id} className="p-0" data-testid={`asset-card-${asset.id}`}>
                <button
                  type="button"
                  className="w-full p-4 text-left space-y-3 rounded-xl hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  onClick={() => openAsset(asset.id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium truncate">{asset.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                        {asset.assetTag ? ` · ${asset.assetTag}` : ""}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground mt-1" />
                  </div>
                  <div className="space-y-1 text-sm">
                    <p className={asset.lastSeenAt ? "text-foreground" : "text-muted-foreground"}>
                      {lastTrackedLabel(asset.lastSeenAt)}
                    </p>
                    {formatTrackedClock(asset.lastSeenAt) && (
                      <p className="text-xs text-muted-foreground">{formatTrackedClock(asset.lastSeenAt)}</p>
                    )}
                    <p className="flex items-center gap-1.5 text-muted-foreground truncate">
                      <User className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{asset.assignedUserName ?? "Unassigned"}</span>
                    </p>
                    {asset.commandName && (
                      <p className="text-xs text-muted-foreground truncate">{asset.commandName}</p>
                    )}
                  </div>
                </button>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AssetAddSheet open={addOpen} onOpenChange={setAddOpen} users={users} commands={commands} />

      <Dialog open={trackerCode != null} onOpenChange={(open) => !open && setTrackerCode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Tracker code for {trackerCode?.assetName}</DialogTitle>
            <DialogDescription>
              On the tablet, open omtpulse.com/asset-tracker and enter this code. It expires in 48 hours.
              {trackerCode?.trackerLinked
                ? " Entering it on a tablet links that tablet and replaces the previous tracker."
                : ""}
            </DialogDescription>
          </DialogHeader>
          <p className="text-center text-3xl font-mono tracking-[0.3em] py-2">{trackerCode?.enrolmentCode}</p>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => {
                if (!trackerCode) return;
                void navigator.clipboard.writeText(trackerCode.enrolmentCode);
                toast({ title: "Code copied" });
              }}
            >
              <Copy className="h-4 w-4 mr-1" />
              Copy code
            </Button>
            {trackerCode?.trackerLinked && (
              <Button
                type="button"
                variant="outline"
                disabled={unlinkMutation.isPending}
                onClick={() => unlinkMutation.mutate(trackerCode.assetId)}
              >
                {unlinkMutation.isPending ? "Unlinking…" : "Unlink current tracker"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingDelete != null} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {pendingDelete?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              This takes the asset off the register.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (pendingDelete) deleteMutation.mutate(pendingDelete.id);
              }}
            >
              {deleteMutation.isPending ? "Removing…" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
