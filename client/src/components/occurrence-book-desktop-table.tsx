import type { Incident, FormField, Category, Location } from "@shared/schema";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Eye, Pencil, Paperclip, Trash2, Map as MapIcon } from "lucide-react";
import {
  resolveEffectiveSeverity,
  getReporterDisplayName,
  incidentHasViewableLocation,
  type IncidentWithMeta,
} from "@/lib/incident-display";

type LocationDisplay = { type: "customMap" | "text"; label: string };

type Props = {
  incidents: IncidentWithMeta[];
  incidentNumberMap: Map<number, string>;
  categories: Category[];
  locations: Location[];
  showDateTime: boolean;
  showCategory: boolean;
  showLocation: boolean;
  tableCustomFields: FormField[];
  getCategoryName: (incident: Incident) => string;
  getLocationDisplay: (incident: Incident) => LocationDisplay;
  canEdit: boolean;
  canDelete: boolean;
  onView: (incident: IncidentWithMeta) => void;
  onEdit: (incident: IncidentWithMeta) => void;
  onAttachments: (incidentId: number) => void;
  onDelete: (incidentId: number) => void;
  onLocationClick: (incident: IncidentWithMeta) => void;
};

function EvidenceBadge({ hasEvidence, incidentId }: { hasEvidence: boolean; incidentId: number }) {
  if (hasEvidence) {
    return (
      <span
        className="inline-flex items-center rounded-full border border-green-500/30 bg-green-500/15 px-2.5 py-0.5 text-xs font-semibold text-green-700 dark:text-green-400"
        data-testid={`badge-evidence-${incidentId}`}
      >
        Yes
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
      data-testid={`badge-evidence-${incidentId}`}
    >
      No
    </span>
  );
}

function SeverityBadge({ severity, incidentId }: { severity: string; incidentId: number }) {
  const tone =
    severity === "red"
      ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
      : severity === "orange"
        ? "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30"
        : "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/30";
  const dot =
    severity === "red" ? "bg-red-500" : severity === "orange" ? "bg-orange-500" : "bg-yellow-400";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold border ${tone}`}
      data-testid={`badge-severity-${incidentId}`}
    >
      <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dot}`} />
      {severity.charAt(0).toUpperCase() + severity.slice(1)}
    </span>
  );
}

function stopRowClick(e: React.MouseEvent) {
  e.stopPropagation();
}

export function OccurrenceBookDesktopTable({
  incidents,
  incidentNumberMap,
  categories,
  locations,
  showDateTime,
  showCategory,
  showLocation,
  tableCustomFields,
  getCategoryName,
  getLocationDisplay,
  canEdit,
  canDelete,
  onView,
  onEdit,
  onAttachments,
  onDelete,
  onLocationClick,
}: Props) {
  return (
    <div
      className="hidden md:block max-h-[calc(100dvh-16rem)] overflow-auto rounded-b-lg border-t"
      data-testid="occurrence-book-desktop-table"
    >
      <Table className="table-fixed min-w-[1180px]">
        <TableHeader className="sticky top-0 z-10 bg-card shadow-[0_1px_0_0_hsl(var(--border))]">
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[128px] pl-6 text-xs uppercase tracking-wide">Incident #</TableHead>
            {showDateTime && <TableHead className="w-[118px] text-xs uppercase tracking-wide">Date & Time</TableHead>}
            {showCategory && <TableHead className="w-[160px] text-xs uppercase tracking-wide">Type</TableHead>}
            {showLocation && <TableHead className="text-xs uppercase tracking-wide">Location</TableHead>}
            <TableHead className="w-[168px] text-xs uppercase tracking-wide">Reporter</TableHead>
            {tableCustomFields.map((cf) => (
              <TableHead key={cf.fieldKey} className="w-[120px] text-xs uppercase tracking-wide truncate">
                {cf.label}
              </TableHead>
            ))}
            <TableHead className="w-[108px] text-xs uppercase tracking-wide">Severity</TableHead>
            <TableHead className="w-[100px] text-xs uppercase tracking-wide">Evidence</TableHead>
            <TableHead className="w-[152px] pr-6 text-xs uppercase tracking-wide text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {incidents.map((incident, rowIndex) => {
            const customData = (incident.customFields as Record<string, string | number | null>) || {};
            const cat = categories.find((c) => c.id === incident.categoryId);
            const severity = resolveEffectiveSeverity(incident, cat);
            const reporter = getReporterDisplayName(incident);
            const hasEvidence = incident.attachmentCount > 0;

            return (
              <TableRow
                key={incident.id}
                data-testid={`row-incident-${incident.id}`}
                className={`cursor-pointer transition-colors hover:bg-muted/60 ${rowIndex % 2 === 1 ? "bg-muted/15" : ""}`}
                onClick={() => onView(incident)}
              >
                <TableCell className="pl-6 py-3 font-mono text-sm font-semibold whitespace-nowrap" data-testid={`text-incident-number-${incident.id}`}>
                  {incidentNumberMap.get(incident.id) ?? incident.id}
                </TableCell>
                {showDateTime && (
                  <TableCell className="py-3">
                    <p className="text-sm font-medium leading-tight">{incident.incidentDate}</p>
                    <p className="text-xs text-muted-foreground">{incident.incidentTime}</p>
                  </TableCell>
                )}
                {showCategory && (
                  <TableCell className="py-3">
                    <div className="flex flex-col items-start gap-1">
                      <span className="text-sm font-medium leading-snug line-clamp-2">{getCategoryName(incident)}</span>
                      {incident.isLive && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" data-testid={`badge-live-${incident.id}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                          LIVE
                        </span>
                      )}
                      {!incident.isLive && Boolean((incident as { panicClosedAt?: string | null }).panicClosedAt) && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" data-testid={`badge-panic-${incident.id}`}>
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          PANIC
                        </span>
                      )}
                    </div>
                  </TableCell>
                )}
                {showLocation && (() => {
                  const locDisplay = getLocationDisplay(incident);
                  const canOpenMap = incidentHasViewableLocation(incident, locations);
                  return (
                    <TableCell className="py-3 text-sm" data-testid={`text-location-${incident.id}`}>
                      {locDisplay.type === "customMap" ? (
                        canOpenMap ? (
                          <button
                            type="button"
                            className="flex items-center gap-1.5 min-w-0 text-left text-primary hover:underline"
                            onClick={(e) => {
                              stopRowClick(e);
                              onLocationClick(incident);
                            }}
                            data-testid={`link-location-${incident.id}`}
                          >
                            <MapIcon className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{locDisplay.label}</span>
                          </button>
                        ) : (
                          <span className="flex items-center gap-1.5 min-w-0">
                            <MapIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate">{locDisplay.label}</span>
                          </span>
                        )
                      ) : canOpenMap ? (
                        <button
                          type="button"
                          className="truncate block text-left text-primary hover:underline"
                          onClick={(e) => {
                            stopRowClick(e);
                            onLocationClick(incident);
                          }}
                          data-testid={`link-location-${incident.id}`}
                        >
                          {locDisplay.label}
                        </button>
                      ) : (
                        <span className="truncate block">{locDisplay.label}</span>
                      )}
                    </TableCell>
                  );
                })()}
                <TableCell className="py-3 text-sm" data-testid={`text-reporter-${incident.id}`}>
                  {reporter ? (
                    <span className="block whitespace-nowrap" title={reporter}>{reporter}</span>
                  ) : (
                    <span className="text-muted-foreground/50">—</span>
                  )}
                </TableCell>
                {tableCustomFields.map((cf) => {
                  const val = customData[cf.fieldKey]?.toString() || "";
                  return (
                    <TableCell key={cf.fieldKey} className="py-3 text-sm">
                      {val ? (
                        cf.fieldType === "file" ? (
                          <a href={val} target="_blank" rel="noopener noreferrer" onClick={stopRowClick} data-testid={`btn-file-custom-${cf.fieldKey}`}>
                            <Button variant="outline" size="sm" className="h-7 px-2" type="button" tabIndex={-1}>
                              <Paperclip className="h-3.5 w-3.5 mr-1" />
                              File
                            </Button>
                          </a>
                        ) : (
                          <span className="line-clamp-2" title={val}>{val}</span>
                        )
                      ) : (
                        <span className="text-muted-foreground/50">—</span>
                      )}
                    </TableCell>
                  );
                })}
                <TableCell className="py-3" data-testid={`cell-severity-${incident.id}`}>
                  {severity ? (
                    <SeverityBadge severity={severity} incidentId={incident.id} />
                  ) : (
                    <span className="text-muted-foreground text-xs">—</span>
                  )}
                </TableCell>
                <TableCell className="py-3" data-testid={`cell-evidence-${incident.id}`}>
                  <EvidenceBadge hasEvidence={hasEvidence} incidentId={incident.id} />
                </TableCell>
                <TableCell className="py-3 pr-6">
                  <div className="flex items-center justify-end gap-0.5" onClick={stopRowClick}>
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onView(incident)} title="View" data-testid={`button-view-${incident.id}`}>
                      <Eye className="h-4 w-4" />
                    </Button>
                    {canEdit && (
                      <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onEdit(incident)} title="Edit" data-testid={`button-edit-${incident.id}`}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onAttachments(incident.id)} title="Attachments" data-testid={`button-attachments-${incident.id}`}>
                      <Paperclip className="h-4 w-4" />
                    </Button>
                    {canDelete && (
                      <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => onDelete(incident.id)} title="Delete" data-testid={`button-delete-${incident.id}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
