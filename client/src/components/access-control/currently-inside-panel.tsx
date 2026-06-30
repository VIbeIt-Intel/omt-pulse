import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessLogWithDetails } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import { Car, Clock, Loader2, LogOut, MapPin, User } from "lucide-react";

function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function EntryCard({ entry, onExit }: { entry: AccessLogWithDetails; onExit: (id: number) => void }) {
  const categoryLabel =
    entry.category in ACCESS_CATEGORY_LABELS
      ? ACCESS_CATEGORY_LABELS[entry.category as keyof typeof ACCESS_CATEGORY_LABELS]
      : entry.category;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold leading-tight">{entry.personFullName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{categoryLabel}</p>
          </div>
          <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full shrink-0">
            Inside
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          {entry.destinationName}
        </div>
        {entry.personIdNumber && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <User className="h-3.5 w-3.5 shrink-0" />
            {entry.personIdNumber}
          </div>
        )}
        {entry.vehicle?.registration && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Car className="h-3.5 w-3.5 shrink-0" />
            {entry.vehicle.registration}
            {entry.vehicle.make ? ` · ${entry.vehicle.make}` : ""}
          </div>
        )}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          In since {formatTime(entry.timeIn)}
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full mt-2 h-10"
          onClick={() => onExit(entry.id)}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Mark exit
        </Button>
      </CardContent>
    </Card>
  );
}

export function CurrentlyInsidePanel() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: entries = [], isLoading, refetch } = useQuery<AccessLogWithDetails[]>({
    queryKey: ["/api/access-control/currently-inside"],
    refetchInterval: 30_000,
  });

  const exitMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/access-control/entries/${id}/exit`, {}),
    onSuccess: () => {
      toast({ title: "Exit logged" });
      void qc.invalidateQueries({ queryKey: ["/api/access-control/currently-inside"] });
    },
    onError: () => {
      toast({ title: "Could not mark exit", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
        <p className="font-medium text-foreground">Nobody inside right now</p>
        <p className="text-sm mt-1">Active entries will appear here until marked exit.</p>
        <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => void refetch()}>
          Refresh
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-6">
      <p className="text-sm text-muted-foreground">
        {entries.length} {entries.length === 1 ? "person" : "people"} currently inside
      </p>
      {entries.map((entry) => (
        <EntryCard
          key={entry.id}
          entry={entry}
          onExit={(id) => {
            if (exitMutation.isPending) return;
            exitMutation.mutate(id);
          }}
        />
      ))}
      {exitMutation.isPending && (
        <div className="flex justify-center py-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Updating…
        </div>
      )}
    </div>
  );
}
