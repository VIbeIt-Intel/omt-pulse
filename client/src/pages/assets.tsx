import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Package, Plus, Trash2, User } from "lucide-react";
import { ASSET_TYPE_LABELS, type AssetType } from "@shared/assets";
import { AssetAddSheet } from "@/components/assets/asset-add-sheet";
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
  createdAt: string;
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

export default function AssetsPage() {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CompanyAsset | null>(null);

  const { data: me } = useQuery<{ role: string }>({ queryKey: ["/api/auth/me"] });
  const canManage =
    me?.role === "administrator" || me?.role === "control_room" || me?.role === "supervisor";

  const { data: assets = [], isLoading } = useQuery<CompanyAsset[]>({
    queryKey: ["/api/assets"],
    refetchInterval: 30_000,
  });
  const { data: users = [] } = useQuery<OrgUser[]>({ queryKey: ["/api/trackers/assignees"] });
  const { data: commands = [] } = useQuery<Command[]>({ queryKey: ["/api/commands"] });

  const counts = useMemo(() => {
    let reporting = 0;
    for (const asset of assets) {
      if (asset.lastSeenAt) reporting += 1;
    }
    return { reporting, silent: assets.length - reporting };
  }, [assets]);

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/assets/${id}`);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/assets"] });
      toast({ title: "Asset removed" });
      setPendingDelete(null);
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
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {assets.map((asset) => (
              <Card key={asset.id} className="p-4 space-y-3" data-testid={`asset-card-${asset.id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{asset.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {ASSET_TYPE_LABELS[asset.assetType] ?? asset.assetType}
                      {asset.assetTag ? ` · ${asset.assetTag}` : ""}
                    </p>
                  </div>
                  {canManage && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-muted-foreground"
                      onClick={() => setPendingDelete(asset)}
                      aria-label={`Remove ${asset.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
                <div className="space-y-1 text-sm">
                  <p className={asset.lastSeenAt ? "text-foreground" : "text-muted-foreground"}>
                    {formatLastSeen(asset.lastSeenAt)}
                  </p>
                  <p className="flex items-center gap-1.5 text-muted-foreground truncate">
                    <User className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{asset.assignedUserName ?? "Unassigned"}</span>
                  </p>
                  {asset.commandName && (
                    <p className="text-xs text-muted-foreground truncate">{asset.commandName}</p>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <AssetAddSheet open={addOpen} onOpenChange={setAddOpen} users={users} commands={commands} />

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
