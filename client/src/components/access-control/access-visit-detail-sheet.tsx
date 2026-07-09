import type { AccessLogWithDetails } from "@shared/schema";
import { formatAccessScanDetailLines, formatAccessScanSummary } from "@shared/access-scan-data";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import {
  Car,
  Clock,
  FileText,
  MapPin,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatDateTime(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function categoryLabel(category: string): string {
  return category in ACCESS_CATEGORY_LABELS
    ? ACCESS_CATEGORY_LABELS[category as keyof typeof ACCESS_CATEGORY_LABELS]
    : category;
}

function DetailRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm border-b border-border/40 last:border-0">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="font-medium text-right break-words">{value}</span>
    </div>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: typeof User;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

type AccessVisitDetailSheetProps = {
  entryId: number | null;
  onOpenChange: (open: boolean) => void;
  onSelectEntry?: (id: number) => void;
};

export function AccessVisitDetailSheet({
  entryId,
  onOpenChange,
  onSelectEntry,
}: AccessVisitDetailSheetProps) {
  const open = entryId != null;

  const { data: entry, isLoading } = useQuery<AccessLogWithDetails>({
    queryKey: ["/api/access-control/entries", entryId],
    queryFn: async () => {
      const res = await fetch(`/api/access-control/entries/${entryId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load visit");
      return res.json();
    },
    enabled: open,
  });

  const { data: history = [] } = useQuery<AccessLogWithDetails[]>({
    queryKey: [
      "/api/access-control/person-history",
      entry?.personIdNumber,
      entry?.personFullName,
      entryId,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ excludeId: String(entryId) });
      if (entry?.personIdNumber) params.set("personIdNumber", entry.personIdNumber);
      else if (entry?.personFullName) params.set("personFullName", entry.personFullName);
      const res = await fetch(`/api/access-control/person-history?${params}`, {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load history");
      return res.json();
    },
    enabled: open && !!entry,
  });

  const scanSummary = entry ? formatAccessScanSummary(entry.scanData) : null;
  const scanLines = entry ? formatAccessScanDetailLines(entry.scanData) : [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Visit record</SheetTitle>
          <SheetDescription>Individual access log for investigations and audit.</SheetDescription>
        </SheetHeader>

        {isLoading || !entry ? (
          <div className="mt-6 space-y-3">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="mt-6 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-lg font-semibold leading-tight">{entry.personFullName}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {categoryLabel(entry.category)}
                  {entry.partyRole === "driver"
                    ? " · Driver"
                    : entry.partyRole === "passenger"
                      ? " · Passenger"
                      : ""}
                </p>
              </div>
              <span
                className={cn(
                  "text-[10px] font-bold uppercase px-2 py-1 rounded-full shrink-0",
                  entry.status === "inside"
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground bg-muted",
                )}
              >
                {entry.status === "inside" ? "On site" : "Exited"}
              </span>
            </div>

            <Section title="Location & timing" icon={MapPin}>
              <DetailRow label="Destination" value={entry.destinationName} />
              <DetailRow label="Time in" value={formatDateTime(entry.timeIn)} />
              <DetailRow label="Time out" value={formatDateTime(entry.timeOut)} />
              <DetailRow label="Logged by" value={entry.loggedByName} />
            </Section>

            <Section title="Identity" icon={User}>
              <DetailRow label="ID number" value={entry.personIdNumber} />
              {scanSummary && <DetailRow label="Scan summary" value={scanSummary} />}
              {scanLines.map((line) => {
                const [label, ...rest] = line.split(": ");
                return (
                  <DetailRow
                    key={line}
                    label={label ?? "Detail"}
                    value={rest.join(": ") || line}
                  />
                );
              })}
            </Section>

            {(entry.companyName || entry.contactNumber || entry.purpose) && (
              <Section title="Visit details" icon={FileText}>
                <DetailRow label="Company" value={entry.companyName} />
                <DetailRow label="Contact" value={entry.contactNumber} />
                <DetailRow label="Purpose" value={entry.purpose} />
              </Section>
            )}

            {entry.vehicle && (
              <Section title="Vehicle" icon={Car}>
                <DetailRow label="Registration" value={entry.vehicle.registration} />
                <DetailRow label="Make" value={entry.vehicle.make} />
                <DetailRow label="Model" value={entry.vehicle.model} />
                <DetailRow label="Colour" value={entry.vehicle.colour} />
              </Section>
            )}

            {history.length > 0 && (
              <Section title="Previous visits" icon={Clock}>
                <div className="space-y-2">
                  {history.map((h) => (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => onSelectEntry?.(h.id)}
                      className="w-full text-left rounded-md border px-3 py-2 hover:bg-muted/40 transition-colors"
                    >
                      <p className="text-sm font-medium">{h.destinationName}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatDateTime(h.timeIn)}
                        {h.status === "exited" && h.timeOut ? ` → ${formatDateTime(h.timeOut)}` : ""}
                      </p>
                    </button>
                  ))}
                </div>
              </Section>
            )}

            <p className="text-[11px] text-muted-foreground">Record #{entry.id}</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
