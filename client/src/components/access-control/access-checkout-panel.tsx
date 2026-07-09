import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AccessLogWithDetails } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import {
  currentlyInsideQueryKey,
  currentlyInsideQueryOptions,
} from "@/lib/access-control-queries";
import {
  describeBinaryEyeFailure,
  scanViaBinaryEye,
} from "@/lib/binary-eye-scanner";
import {
  matchInsideEntries,
  matchInsideEntriesFromSearch,
  type CheckoutMatchQuery,
} from "@/lib/match-inside-entries";
import { Car, Clock, Loader2, LogOut, MapPin, ScanLine, Search, User } from "lucide-react";

function formatTime(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function categoryLabel(category: string): string {
  return category in ACCESS_CATEGORY_LABELS
    ? ACCESS_CATEGORY_LABELS[category as keyof typeof ACCESS_CATEGORY_LABELS]
    : category;
}

function EntryCard({
  entry,
  highlight,
  onExit,
  exiting,
}: {
  entry: AccessLogWithDetails;
  highlight?: boolean;
  onExit: (id: number) => void;
  exiting: boolean;
}) {
  return (
    <Card className={highlight ? "overflow-hidden border-primary ring-1 ring-primary/30" : "overflow-hidden"}>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold leading-tight">{entry.personFullName}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {categoryLabel(entry.category)}
              {entry.partyRole === "driver"
                ? " · Driver"
                : entry.partyRole === "passenger"
                  ? " · Passenger"
                  : ""}
            </p>
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
          variant={highlight ? "default" : "outline"}
          className="w-full mt-2 h-10"
          disabled={exiting}
          onClick={() => onExit(entry.id)}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Confirm check out
        </Button>
      </CardContent>
    </Card>
  );
}

export function AccessCheckoutPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const scanBusyRef = useRef(false);

  const [search, setSearch] = useState("");
  const [scanMatches, setScanMatches] = useState<AccessLogWithDetails[] | null>(null);
  const [scanBusy, setScanBusy] = useState(false);

  const { data: entries = [], isLoading, refetch } = useQuery<AccessLogWithDetails[]>({
    queryKey: currentlyInsideQueryKey,
    ...currentlyInsideQueryOptions,
  });

  const exitMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/access-control/entries/${id}/exit`, {}),
    onSuccess: () => {
      toast({ title: "Checked out", description: "Exit logged successfully." });
      setScanMatches(null);
      setSearch("");
      void qc.invalidateQueries({ queryKey: currentlyInsideQueryKey });
    },
    onError: () => {
      toast({ title: "Could not check out", variant: "destructive" });
    },
  });

  const exiting = exitMutation.isPending;

  const applyMatchQuery = useCallback(
    (query: CheckoutMatchQuery, source: "scan" | "search") => {
      const matches = matchInsideEntries(entries, query);
      setScanMatches(matches);

      if (matches.length === 1) {
        toast({
          title: "Match found",
          description: `Tap Confirm check out for ${matches[0]!.personFullName}.`,
        });
        return;
      }

      if (matches.length > 1) {
        toast({
          title: "Multiple matches",
          description: "Pick the correct person below.",
        });
        return;
      }

      toast({
        title: source === "scan" ? "No match inside" : "Nobody found",
        description:
          source === "scan"
            ? "This person is not marked as inside, or was already checked out."
            : "Try scanning their licence or ID, or search another name or plate.",
        variant: "destructive",
      });
    },
    [entries, toast],
  );

  const runLicenceOrIdScan = useCallback(async () => {
    if (scanBusyRef.current || exiting) return;
    scanBusyRef.current = true;
    setScanBusy(true);

    toast({
      title: "Check out scan",
      description: "Scan driver's licence or Smart ID with Binary Eye.",
    });

    try {
      const licence = await scanViaBinaryEye("drivers_licence");
      if (licence.ok) {
        applyMatchQuery(
          {
            personIdNumber: licence.parsed.personIdNumber,
            personFullName: licence.parsed.personFullName,
          },
          "scan",
        );
        return;
      }
      if (licence.reason === "cancelled") return;

      const idScan = await scanViaBinaryEye("national_id");
      if (idScan.ok) {
        applyMatchQuery(
          {
            personIdNumber: idScan.parsed.personIdNumber,
            personFullName: idScan.parsed.personFullName,
          },
          "scan",
        );
        return;
      }
      if (idScan.reason === "cancelled") return;

      toast({
        title: "Could not read barcode",
        description: describeBinaryEyeFailure("national_id", idScan),
        variant: "destructive",
      });
    } finally {
      scanBusyRef.current = false;
      setScanBusy(false);
    }
  }, [applyMatchQuery, exiting, toast]);

  const runDiscScan = useCallback(async () => {
    if (scanBusyRef.current || exiting) return;
    scanBusyRef.current = true;
    setScanBusy(true);

    toast({
      title: "Scan licence disc",
      description: "Match by vehicle registration.",
    });

    try {
      const disc = await scanViaBinaryEye("disc");
      if (disc.ok) {
        applyMatchQuery({ registration: disc.parsed.registration ?? disc.raw }, "scan");
        return;
      }
      if (disc.reason === "cancelled") return;
      toast({
        title: "Could not read disc",
        description: describeBinaryEyeFailure("disc", disc),
        variant: "destructive",
      });
    } finally {
      scanBusyRef.current = false;
      setScanBusy(false);
    }
  }, [applyMatchQuery, exiting, toast]);

  const searchMatches = useMemo(() => {
    if (!search.trim()) return null;
    return matchInsideEntriesFromSearch(entries, search);
  }, [entries, search]);

  const highlightedIds = useMemo(() => {
    const ids = new Set<number>();
    for (const e of scanMatches ?? []) ids.add(e.id);
    if (searchMatches) {
      for (const e of searchMatches) ids.add(e.id);
    }
    return ids;
  }, [scanMatches, searchMatches]);

  const showScanResults = scanMatches !== null && scanMatches.length > 0;
  const showSearchResults = searchMatches !== null && searchMatches.length > 0 && search.trim().length > 0;

  const listEntries = useMemo(() => {
    if (showScanResults) return scanMatches!;
    if (showSearchResults) return searchMatches!;
    return entries;
  }, [entries, scanMatches, searchMatches, showScanResults, showSearchResults]);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-28 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <p className="text-sm font-medium">Fast check out</p>
        <p className="text-xs text-muted-foreground">
          Scan the same licence or ID used at check in — we match who is still inside.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            className="flex-1 h-11"
            disabled={scanBusy || exiting || entries.length === 0}
            onClick={() => void runLicenceOrIdScan()}
          >
            {scanBusy ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ScanLine className="h-4 w-4 mr-2" />
            )}
            Scan licence or ID
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1 h-11"
            disabled={scanBusy || exiting || entries.length === 0}
            onClick={() => void runDiscScan()}
          >
            <Car className="h-4 w-4 mr-2" />
            Scan disc
          </Button>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9 h-11"
            placeholder="Search name, ID or plate"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setScanMatches(null);
            }}
            disabled={entries.length === 0}
          />
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          <p className="font-medium text-foreground">Nobody inside right now</p>
          <p className="text-sm mt-1">Check-ins will appear here until checked out.</p>
          <Button type="button" variant="ghost" size="sm" className="mt-3" onClick={() => void refetch()}>
            Refresh
          </Button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {showScanResults || showSearchResults
              ? `${listEntries.length} match${listEntries.length === 1 ? "" : "es"}`
              : `${entries.length} ${entries.length === 1 ? "person" : "people"} inside`}
          </p>
          <div className="space-y-3">
            {listEntries.map((entry) => (
              <EntryCard
                key={entry.id}
                entry={entry}
                highlight={highlightedIds.has(entry.id) && (showScanResults || showSearchResults)}
                exiting={exiting}
                onExit={(id) => {
                  if (exiting) return;
                  exitMutation.mutate(id);
                }}
              />
            ))}
          </div>
          {(showScanResults || showSearchResults) && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => {
                setScanMatches(null);
                setSearch("");
              }}
            >
              Show everyone inside
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** @deprecated Use AccessCheckoutPanel */
export const CurrentlyInsidePanel = AccessCheckoutPanel;
