import { useState, useMemo, useRef, useEffect } from "react";
import { useSearch, useLocation, Link } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Incident, Category, Location, FormField, CustomMap } from "@shared/schema";

type IncidentWithCount = Incident & { attachmentCount: number };
import { IncidentDialog, AttachmentsDialog } from "@/components/incident-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Plus, Pencil, Trash2, BookOpen, Eye, Paperclip, Map as MapIcon, X, CalendarRange, Download, ArrowLeft, ClipboardList, FileText, Radio, BarChart2, Siren, MessageSquare, ChevronRight } from "lucide-react";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { PanicBanner, type PanicAlert } from "@/components/panic-banner";
import { HeartbeatLine } from "@/components/heartbeat-line";
import omtLogo from "@/assets/omt-logo-v2.png";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import * as XLSX from "xlsx";

function isFieldVisible(fields: FormField[], key: string, fieldsLoaded: boolean): boolean {
  const field = fields.find((f) => f.fieldKey === key);
  if (field) return field.isVisible;
  return !fieldsLoaded;
}

export default function OccurrenceBook() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIncident, setEditingIncident] = useState<Incident | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [attachmentsIncidentId, setAttachmentsIncidentId] = useState<number | null>(null);
  const [viewingIncident, setViewingIncident] = useState<IncidentWithCount | null>(null);
  const [selectedMapId, setSelectedMapId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [severityFilter, setSeverityFilter] = useState<string>("any");
  const [showMyIncidents, setShowMyIncidents] = useState(false);
  const [dismissedLiveAlert, setDismissedLiveAlert] = useState(false);
  const [dismissedPanicAlertIds, setDismissedPanicAlertIds] = useState<Set<number>>(() => {
    try {
      const stored = localStorage.getItem("dismissedPanicIds");
      return stored ? new Set<number>(JSON.parse(stored)) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  const dismissPanic = (id: number) => {
    setDismissedPanicAlertIds((prev) => {
      const next = new Set([...prev, id]);
      try { localStorage.setItem("dismissedPanicIds", JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  const [panicOpen, setPanicOpen] = useState(false);
  const [panicking, setPanicking] = useState(false);
  const search = useSearch();
  const [, setLocation] = useLocation();
  const importBatchIdFilter = useMemo(() => {
    const params = new URLSearchParams(search);
    const v = params.get("importBatchId");
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [search]);
  const clearImportBatchFilter = () => setLocation("/");
  const deepLinkIncidentId = useMemo(() => {
    const params = new URLSearchParams(search);
    const v = params.get("incident");
    const n = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(n) ? n : null;
  }, [search]);
  const { toast } = useToast();

  const { data: incidents = [], isLoading } = useQuery<IncidentWithCount[]>({
    queryKey: ["/api/incidents"],
    refetchInterval: 20000,
  });

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: customMaps = [] } = useQuery<CustomMap[]>({
    queryKey: ["/api/custom-maps"],
  });

  const { data: currentUser } = useQuery<{
    id: string;
    role: string;
    firstName: string;
    canEditIncidents: boolean;
    canManageAttachments: boolean;
    canDeleteIncidents: boolean;
  }>({
    queryKey: ["/api/auth/me"],
  });

  const { data: formFields = [], isLoading: fieldsLoading } = useQuery<FormField[]>({
    queryKey: ["/api/form-fields"],
  });
  const fieldsLoaded = !fieldsLoading;
  type LiveIncidentBrief = Incident & { responderFirstName?: string | null; responderLastName?: string | null };
  const { data: liveIncidents = [] } = useQuery<LiveIncidentBrief[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 5000,
    enabled: !!(currentUser?.role === "administrator" || currentUser?.role === "supervisor"),
  });

  const { data: recentPanicAlerts = [] } = useQuery<PanicAlert[]>({
    queryKey: ["/api/panic/recent"],
    refetchInterval: 10000,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });
  const visiblePanicAlerts = recentPanicAlerts.filter((a) => !dismissedPanicAlertIds.has(a.id));

  type IncidentResponder = { id: number; userId: string; firstName: string; lastName: string; joinedAt: string; arrivedAt: string | null; arrivalNote: string | null; leftAt?: string | null };
  const { data: viewingIncidentResponders = [] } = useQuery<IncidentResponder[]>({
    queryKey: ["/api/incidents", viewingIncident?.id, "responders"],
    queryFn: async () => {
      if (!viewingIncident?.id) return [];
      const res = await fetch(`/api/incidents/${viewingIncident.id}/responders`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!(viewingIncident?.id && (currentUser?.role === "administrator" || currentUser?.role === "supervisor")),
  });

  type ChatConversation = { recipientId: string | null; recipientFirstName: string | null; recipientLastName: string | null; unreadCount: number };
  const { data: chatConvos = [] } = useQuery<ChatConversation[]>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 15000,
  });
  const totalUnread = chatConvos.reduce((sum, c) => sum + c.unreadCount, 0);
  const unreadSenders = chatConvos
    .filter((c) => c.unreadCount > 0)
    .map((c) => [c.recipientFirstName, c.recipientLastName].filter(Boolean).join(" "))
    .filter(Boolean);

  const prevPanicIdsRef = useRef<Set<number>>(new Set());
  useEffect(() => {
    const newIds = recentPanicAlerts.filter((a) => !prevPanicIdsRef.current.has(a.id)).map((a) => a.id);
    if (newIds.length > 0) {
      setDismissedPanicAlertIds((prev) => {
        const next = new Set(prev);
        newIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    prevPanicIdsRef.current = new Set(recentPanicAlerts.map((a) => a.id));
  }, [recentPanicAlerts]);

  useEffect(() => {
    if (!navigator.serviceWorker) return;
    const handler = (event: MessageEvent) => {
      if (event.data?.type === "INVALIDATE_PANIC") {
        queryClient.invalidateQueries({ queryKey: ["/api/panic/recent"] });
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  const autoDismissTimersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    recentPanicAlerts.forEach((alert) => {
      if (
        alert.panicAcknowledgedAt &&
        !dismissedPanicAlertIds.has(alert.id) &&
        !autoDismissTimersRef.current.has(alert.id)
      ) {
        const timer = setTimeout(() => {
          autoDismissTimersRef.current.delete(alert.id);
          setDismissedPanicAlertIds((prev) => {
            const next = new Set([...prev, alert.id]);
            try { localStorage.setItem("dismissedPanicIds", JSON.stringify([...next])); } catch {}
            return next;
          });
          toast({ title: "Panic alert auto-dismissed", description: "The acknowledged alert has been automatically removed from the banner." });
        }, 60000);
        autoDismissTimersRef.current.set(alert.id, timer);
      }
    });
  }, [recentPanicAlerts, dismissedPanicAlertIds]);

  useEffect(() => {
    return () => {
      autoDismissTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  const isAdmin = currentUser?.role === "administrator";
  const isSupervisor = currentUser?.role === "supervisor";
  const isReporter = currentUser?.role === "reporter";

  useEffect(() => {
    if ((isAdmin || isSupervisor) && !showMyIncidents) {
      setShowMyIncidents(true);
    }
  }, [isAdmin, isSupervisor, showMyIncidents]);

  const prevLiveCountRef = useRef(0);
  useEffect(() => {
    if (liveIncidents.length > 0 && prevLiveCountRef.current === 0) {
      setDismissedLiveAlert(false);
    }
    prevLiveCountRef.current = liveIncidents.length;
  }, [liveIncidents.length]);

  const deepLinkHandledRef = useRef<number | null>(null);
  useEffect(() => {
    if (!deepLinkIncidentId || isLoading || incidents.length === 0) return;
    if (deepLinkHandledRef.current === deepLinkIncidentId) return;
    deepLinkHandledRef.current = deepLinkIncidentId;
    const target = incidents.find((inc) => inc.id === deepLinkIncidentId);
    if (target) {
      setEditingIncident(target);
      setDialogOpen(true);
    }
    const params = new URLSearchParams(search);
    params.delete("incident");
    const remaining = params.toString();
    setLocation(remaining ? `/occurrence-book?${remaining}` : "/occurrence-book");
  }, [deepLinkIncidentId, isLoading, incidents, search, setLocation]);
  const canEdit = isAdmin || (currentUser?.canEditIncidents ?? true);
  const canManageAtts = isAdmin || (currentUser?.canManageAttachments ?? true);
  const canDelete = !isReporter && (isAdmin || (currentUser?.canDeleteIncidents ?? true));

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest("DELETE", `/api/incidents/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Incident deleted", description: "The incident has been removed from the occurrence book." });
      setDeleteId(null);
    },
  });

  const getCategoryName = (incident: Incident) => {
    const cat = categories.find((c) => c.id === incident.categoryId);
    if (!cat) return "-";
    if (incident.otherCategoryNote) return `${cat.name} (${incident.otherCategoryNote})`;
    return cat.name;
  };
  const getCategoryColor = (id: number | null) => categories.find((c) => c.id === id)?.color || "#3B82F6";
  const getLocationDisplay = (incident: Incident) => {
    if (incident.customMapId != null) {
      const cm = customMaps.find((m) => m.id === incident.customMapId);
      const mapName = cm?.name ?? "Custom Map";
      return { type: "customMap" as const, label: mapName };
    }
    if (incident.customMapX != null || incident.customMapY != null) {
      return { type: "text" as const, label: "Map removed" };
    }
    if (incident.locationName) return { type: "text" as const, label: incident.locationName };
    if (incident.locationId) {
      const loc = locations.find((l) => l.id === incident.locationId);
      return { type: "text" as const, label: loc?.name || "-" };
    }
    if (incident.latitude != null && incident.longitude != null) {
      return { type: "text" as const, label: `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}` };
    }
    return { type: "text" as const, label: "-" };
  };
  const getGoogleMapsUrl = (incident: Incident) => {
    if (incident.latitude == null || incident.longitude == null) return null;
    return `https://www.google.com/maps?q=${incident.latitude},${incident.longitude}`;
  };

  const showDateTime = isFieldVisible(formFields, "incidentDate", fieldsLoaded) || isFieldVisible(formFields, "incidentTime", fieldsLoaded);
  const showCategory = isFieldVisible(formFields, "categoryId", fieldsLoaded);
  const showLocation = isFieldVisible(formFields, "location", fieldsLoaded);

  const visibleCustomFields = formFields.filter((f) => !f.isSystem && f.isVisible);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      if (selectedMapId !== null && inc.customMapId !== selectedMapId) return false;
      if (dateFrom && inc.incidentDate < dateFrom) return false;
      if (dateTo && inc.incidentDate > dateTo) return false;
      if (importBatchIdFilter !== null && inc.importBatchId !== importBatchIdFilter) return false;
      if (severityFilter !== "any" && inc.severity !== severityFilter) return false;
      return true;
    });
  }, [incidents, selectedMapId, dateFrom, dateTo, importBatchIdFilter, severityFilter, isReporter, showMyIncidents, currentUser?.id]);

  const hasDateFilter = dateFrom !== "" || dateTo !== "";
  const clearDateFilter = () => { setDateFrom(""); setDateTo(""); };

  async function sendPanic() {
    setPanicking(true);
    try {
      let lat: number | undefined;
      let lng: number | undefined;
      try {
        const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 10000 })
        );
        lat = pos.coords.latitude;
        lng = pos.coords.longitude;
      } catch { /* GPS unavailable — alert fires anyway */ }
      const res = await apiRequest("POST", "/api/panic", { lat, lng });
      const { sent, found } = await res.json() as { sent: number; found: number };
      setPanicOpen(false);
      if (found === 0) {
        toast({
          title: "🆘 Panic alert stored",
          description: "No team members have push notifications enabled — they will not receive a push alert. Ask your team to enable notifications in the app.",
          variant: "destructive",
        });
      } else if (sent === 0) {
        toast({
          title: "🆘 Panic alert sent",
          description: "Alert dispatched — delivery may be delayed on some devices. In-app alarms are active.",
        });
      } else {
        toast({ title: "🆘 Panic alert sent", description: `Push notification delivered to ${sent} device${sent === 1 ? "" : "s"} in your organisation.` });
      }
    } catch (e: unknown) {
      toast({
        title: "Failed to send panic alert",
        description: e instanceof Error ? e.message : "Please try again or contact someone immediately.",
        variant: "destructive",
      });
    } finally {
      setPanicking(false);
    }
  }

  const exportToCSV = () => {
    const headers: string[] = ["Incident #"];
    if (showDateTime) {
      headers.push("Date", "Time");
    }
    if (showCategory) headers.push("Type");
    if (showLocation) headers.push("Location");
    for (const cf of visibleCustomFields) {
      headers.push(cf.label);
    }

    const dataRows = filteredIncidents.map((incident) => {
      const customData = (incident.customFields as Record<string, string | number | null>) || {};
      const row: (string | number)[] = [incidentNumberMap.get(incident.id) ?? String(incident.id)];
      if (showDateTime) {
        row.push(incident.incidentDate ?? "", incident.incidentTime ?? "");
      }
      if (showCategory) row.push(getCategoryName(incident));
      if (showLocation) {
        const locDisplay = getLocationDisplay(incident);
        if (locDisplay.type === "customMap") {
          row.push(`${locDisplay.label} — pin placed`);
        } else {
          row.push(locDisplay.label);
        }
      }
      for (const cf of visibleCustomFields) {
        const val = customData[cf.fieldKey]?.toString() || "";
        row.push(val);
      }
      return row;
    });

    const aoa: (string | number)[][] = [headers, ...dataRows];
    const worksheet = XLSX.utils.aoa_to_sheet(aoa);
    worksheet["!cols"] = headers.map((h) => {
      const maxLen = Math.max(
        h.length,
        ...dataRows.map((r, i) => String(r[headers.indexOf(h)] ?? "").length),
      );
      return { wch: Math.min(Math.max(maxLen + 2, 10), 40) };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Occurrence Book");
    const dateStr = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `occurrence-book-${dateStr}.xlsx`);
  };

  const incidentNumberMap = useMemo(() => {
    const sorted = [...incidents].sort((a, b) =>
      a.incidentDate < b.incidentDate ? -1 : a.incidentDate > b.incidentDate ? 1 : a.id - b.id
    );
    const dayCounts: Record<string, number> = {};
    const map = new Map<number, string>();
    for (const inc of sorted) {
      dayCounts[inc.incidentDate] = (dayCounts[inc.incidentDate] ?? 0) + 1;
      const dateFormatted = inc.incidentDate.replaceAll("-", "/");
      map.set(inc.id, `${dateFormatted}-${dayCounts[inc.incidentDate]}`);
    }
    return map;
  }, [incidents]);

  // Reporter landing dashboard — shown before they choose to review
  if (isReporter && !showMyIncidents) {
    const myCount = incidents.filter((inc) => inc.userId === currentUser?.id).length;
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0">
          <SidebarTrigger />
        </div>
        <div className="p-6 flex flex-col items-center justify-center flex-1 gap-6">
          <div className="text-center max-w-sm">
            <div className="flex justify-center mb-1">
              <img src={omtLogo} alt="OMT Pulse" className="w-20 h-20 object-contain" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <div style={{ transform: "scaleX(-1)" }}>
                <HeartbeatLine className="w-20 h-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">OMT Pulse</h1>
              <HeartbeatLine className="w-20 h-5" />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {currentUser?.firstName ? `Welcome, ${currentUser.firstName}.` : "Welcome."} What would you like to do?
            </p>
          </div>
          <div className="w-full max-w-sm">
            <PanicBanner
              alerts={recentPanicAlerts}
              currentUserId={currentUser?.id}
              dismissedIds={dismissedPanicAlertIds}
              onDismiss={dismissPanic}
              testIdSuffix="reporter"
            />
          </div>

          {totalUnread > 0 && (
            <button
              type="button"
              onClick={() => setLocation("/chat")}
              className="w-full max-w-sm text-left rounded-lg border-2 border-primary/60 bg-primary/5 hover:bg-primary/10 transition-colors overflow-hidden shadow"
              data-testid="banner-unread-chat-reporter"
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="relative shrink-0">
                  <MessageSquare className="h-5 w-5 text-primary" />
                  <span className="absolute -top-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground leading-none">
                    {totalUnread > 99 ? "99+" : totalUnread}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    {totalUnread} unread message{totalUnread !== 1 ? "s" : ""}
                  </p>
                  {unreadSenders.length > 0 && (
                    <p className="text-xs text-muted-foreground truncate" data-testid="text-unread-senders-reporter">
                      From: {unreadSenders.join(", ")}
                    </p>
                  )}
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
              </div>
            </button>
          )}

          <Card className="w-full max-w-sm">
            <CardContent className="pt-6 pb-6 flex flex-col gap-5">
              <Link href="/live-severity" className="w-full">
                <Button
                  size="lg"
                  className="w-full h-20 text-base font-bold bg-orange-500 hover:bg-orange-600 text-white border-orange-500 hover:border-orange-600"
                  data-testid="button-live-incident"
                >
                  <Radio className="h-6 w-6 mr-2" />
                  Live Incident
                </Button>
              </Link>
              <Button
                size="lg"
                className="w-full h-20 text-base font-bold"
                onClick={() => {
                  setEditingIncident(null);
                  setDialogOpen(true);
                }}
                data-testid="button-new-incident"
              >
                <Plus className="h-6 w-6 mr-2" />
                Report Incident
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="w-full h-16 text-muted-foreground border-border/60 hover:bg-muted/50 hover:text-foreground"
                onClick={() => setShowMyIncidents(true)}
                data-testid="button-review-my-incidents"
              >
                <FileText className="h-5 w-5 mr-2" />
                Review my Incidents
                {myCount > 0 && (
                  <Badge variant="secondary" className="ml-2">{myCount}</Badge>
                )}
              </Button>
            </CardContent>
          </Card>

          {/* Inline SOS button — part of the page flow, between card and footer */}
          <div className="flex flex-col items-center gap-1.5">
            <button
              onClick={() => setPanicOpen(true)}
              disabled={panicking}
              data-testid="button-panic"
              className="h-20 w-20 rounded-full bg-red-600 hover:bg-red-700 active:scale-95 shadow-[0_0_0_4px_rgba(220,38,38,0.3)] hover:shadow-[0_0_0_6px_rgba(220,38,38,0.4)] transition-all duration-150 flex items-center justify-center touch-manipulation"
              aria-label="Send panic alert"
            >
              <Siren className="h-9 w-9 text-white" />
            </button>
            <span className="text-[11px] font-bold tracking-widest text-red-600 dark:text-red-400 uppercase select-none">SOS</span>
          </div>
        </div>
        <div className="pb-6 text-center shrink-0 select-none">
          <div className="flex items-center justify-center gap-2">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-primary/30" />
            <span className="text-[8px] text-muted-foreground/30 font-light">powered by</span>
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-primary/45">IntelAfri</span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-primary/30" />
          </div>
        </div>

        <IncidentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          incident={editingIncident}
        />

        {/* Full-screen panic confirmation overlay — reporter branch */}
        {panicOpen && (
          <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm px-6" data-testid="overlay-panic-confirm">
            <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
              <div className="relative flex items-center justify-center">
                <span className="absolute h-28 w-28 rounded-full bg-red-600/20 animate-ping" />
                <span className="absolute h-20 w-20 rounded-full bg-red-600/30" />
                <div className="relative h-24 w-24 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
                  <Siren className="h-12 w-12 text-white" />
                </div>
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold text-white tracking-tight">Send PANIC Alert?</h2>
                <p className="text-sm text-white/70 leading-relaxed">
                  This will immediately alert <strong className="text-white">everyone</strong> in your organisation that you need urgent assistance. Your GPS location will be shared.
                </p>
              </div>
              {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
                <div className="w-full flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-500/40 px-4 py-3 text-xs text-amber-300 text-left">
                  <Siren className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>Push notifications are not enabled — team members may not be alerted instantly.</span>
                </div>
              )}
              <div className="w-full space-y-3 pt-2">
                <button
                  onClick={() => { setPanicOpen(false); sendPanic(); }}
                  disabled={panicking}
                  data-testid="button-confirm-panic"
                  className="w-full h-14 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-bold text-base tracking-wide shadow-lg transition-all touch-manipulation disabled:opacity-60"
                >
                  {panicking ? "Sending alert…" : "CONFIRM — Send Alert"}
                </button>
                <button
                  onClick={() => setPanicOpen(false)}
                  disabled={panicking}
                  className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all touch-manipulation"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if ((isAdmin || isSupervisor) && !showMyIncidents) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-6 flex flex-col items-center justify-center flex-1 gap-6">
          <div className="w-full max-w-sm">
            <PanicBanner
              alerts={recentPanicAlerts}
              currentUserId={currentUser?.id}
              dismissedIds={dismissedPanicAlertIds}
              onDismiss={dismissPanic}
              testIdSuffix="admin"
            />
          </div>
          {liveIncidents.length > 0 && !dismissedLiveAlert && (
            <div className="w-full max-w-sm rounded-lg border-2 border-red-500 bg-red-500/10 overflow-hidden shadow-lg" data-testid="banner-live-incidents">
              <div className="bg-red-500 px-4 py-2 flex items-center gap-2">
                <span className="inline-block w-2.5 h-2.5 rounded-full bg-white animate-ping" />
                <span className="text-white font-bold text-sm uppercase tracking-wide">
                  ⚠ Live Emergency
                </span>
                <button
                  onClick={() => setDismissedLiveAlert(true)}
                  className="ml-auto text-white/80 hover:text-white transition-colors"
                  data-testid="button-dismiss-live-alert"
                  aria-label="Dismiss"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-4 py-3 space-y-2">
                <p className="text-sm font-semibold text-red-700 dark:text-red-400">
                  {liveIncidents.length} person{liveIncidents.length > 1 ? "s are" : " is"} in a live situation — possible life threat.
                </p>
                {liveIncidents.slice(0, 3).map((inc) => {
                  const first = inc.responderFirstName ?? "";
                  const last = inc.responderLastName ?? "";
                  const name = `${first} ${last}`.trim() || `Incident #${inc.id}`;
                  return (
                    <p key={inc.id} className="text-xs text-red-600/80 dark:text-red-400/80 font-medium">
                      • {name}{inc.locationName ? ` — ${inc.locationName}` : ""}
                    </p>
                  );
                })}
                {liveIncidents.length > 3 && (
                  <p className="text-xs text-muted-foreground">+ {liveIncidents.length - 3} more…</p>
                )}
                <Link href="/live-monitor" className="block">
                  <Button size="sm" className="w-full bg-red-600 hover:bg-red-700 text-white border-0" data-testid="button-monitor-live">
                    <Radio className="h-4 w-4 mr-2 animate-pulse" />
                    Monitor Now
                  </Button>
                </Link>
              </div>
            </div>
          )}
          <div className="text-center max-w-sm">
            <div className="flex justify-center mb-1">
              <img src={omtLogo} alt="OMT Pulse" className="w-20 h-20 object-contain" />
            </div>
            <div className="flex items-center justify-center gap-2">
              <div style={{ transform: "scaleX(-1)" }}>
                <HeartbeatLine className="w-20 h-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">OMT Pulse</h1>
              <HeartbeatLine className="w-20 h-5" />
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              {currentUser?.firstName ? `Welcome, ${currentUser.firstName}.` : "Welcome."} What would you like to do?
            </p>
          </div>
          <Card className="w-full max-w-sm">
            <CardContent className="pt-6 pb-6 flex flex-col gap-5">
              <Button
                size="lg"
                className="w-full bg-red-700 hover:bg-red-800 text-white"
                onClick={() => { setEditingIncident(null); setDialogOpen(true); }}
                data-testid="button-new-incident"
              >
                <Plus className="h-5 w-5 mr-2" />
                Report Incident
              </Button>
              <Button
                size="lg"
                className="w-full bg-red-600 hover:bg-red-700 text-white"
                onClick={() => setPanicOpen(true)}
                data-testid="button-panic"
              >
                <Siren className="h-5 w-5 mr-2" />
                PANIC
              </Button>
              <Link href="/analytics" className="w-full">
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full border-green-500/50 text-green-600 hover:bg-green-500/10 hover:text-green-700 dark:text-green-400 dark:hover:text-green-300"
                  data-testid="button-view-analytics"
                >
                  <BarChart2 className="h-5 w-5 mr-2" />
                  View Analytics
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="w-full text-muted-foreground border-border/60 hover:bg-muted/50 hover:text-foreground"
                onClick={() => setShowMyIncidents(true)}
                data-testid="button-view-incident-log"
              >
                <BookOpen className="h-5 w-5 mr-2" />
                View Incident Log
              </Button>
            </CardContent>
          </Card>
        </div>
        <div className="pb-6 text-center shrink-0 select-none">
          <div className="flex items-center justify-center gap-2">
            <div className="h-px w-8 bg-gradient-to-r from-transparent to-primary/30" />
            <span className="text-[8px] text-muted-foreground/30 font-light">powered by</span>
            <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-primary/45">IntelAfri</span>
            <div className="h-px w-8 bg-gradient-to-l from-transparent to-primary/30" />
          </div>
        </div>

        <IncidentDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          incident={editingIncident}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-3 py-2 border-b shrink-0">
        <SidebarTrigger />
        {isReporter && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setShowMyIncidents(false)} data-testid="button-back-to-dashboard">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        )}
        <span className="text-sm font-semibold flex-1 truncate px-1" data-testid="text-page-title">
          {isReporter ? "My Incidents" : "Occurrence Book"}
        </span>
        {!isReporter && (
          <Button size="sm" onClick={() => { setEditingIncident(null); setDialogOpen(true); }} data-testid="button-new-incident">
            <Plus className="h-4 w-4 mr-1" /> Report
          </Button>
        )}
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1">

        {(isAdmin || isSupervisor) && (
          <PanicBanner
            alerts={recentPanicAlerts}
            currentUserId={currentUser?.id}
            dismissedIds={dismissedPanicAlertIds}
            onDismiss={dismissPanic}
            testIdSuffix="log"
          />
        )}

        {(isAdmin || isSupervisor) && liveIncidents.length > 0 && !dismissedLiveAlert && (
          <div className="flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/8 px-4 py-3" data-testid="banner-live-incidents-log">
            <Radio className="h-5 w-5 text-amber-500 shrink-0 animate-pulse" />
            <Link href="/map" className="flex-1 min-w-0 no-underline">
              <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                {liveIncidents.length} active live incident{liveIncidents.length > 1 ? "s" : ""}
              </p>
              <p className="text-xs text-muted-foreground">Tap to view on map →</p>
            </Link>
            <button
              onClick={() => setDismissedLiveAlert(true)}
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 rounded"
              data-testid="button-dismiss-live-alert-log"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <CardTitle className="flex items-center gap-2 text-base">
                <BookOpen className="h-4 w-4" />
                Incident Log
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <CalendarRange className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                  <Input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    max={dateTo || undefined}
                    className="h-8 w-28 text-sm px-2"
                    aria-label="From date"
                    data-testid="input-date-from"
                  />
                  <span className="text-xs text-muted-foreground">to</span>
                  <Input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    min={dateFrom || undefined}
                    className="h-8 w-28 text-sm px-2"
                    aria-label="To date"
                    data-testid="input-date-to"
                  />
                  {hasDateFilter && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={clearDateFilter}
                      data-testid="button-all-dates"
                    >
                      All Dates
                    </Button>
                  )}
                </div>
                {customMaps.length > 0 && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm text-muted-foreground font-medium whitespace-nowrap">Site Map:</span>
                    <Select
                      value={selectedMapId !== null ? String(selectedMapId) : "all"}
                      onValueChange={(val) => setSelectedMapId(val === "all" ? null : Number(val))}
                    >
                      <SelectTrigger className="w-44 h-8 text-sm" data-testid="select-map-filter">
                        <MapIcon className="h-3.5 w-3.5 mr-1.5 flex-shrink-0 text-muted-foreground" />
                        <SelectValue placeholder="All Site Maps" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Site Maps</SelectItem>
                        {customMaps.map((m) => (
                          <SelectItem key={m.id} value={String(m.id)} data-testid={`option-map-${m.id}`}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Select
                  value={severityFilter}
                  onValueChange={setSeverityFilter}
                >
                  <SelectTrigger className="w-36 h-8 text-sm" data-testid="select-severity-filter">
                    <SelectValue placeholder="Any Severity" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any Severity</SelectItem>
                    <SelectItem value="red" data-testid="option-severity-red">
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0" />
                        Red
                      </span>
                    </SelectItem>
                    <SelectItem value="orange" data-testid="option-severity-orange">
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-orange-500 flex-shrink-0" />
                        Orange
                      </span>
                    </SelectItem>
                    <SelectItem value="yellow" data-testid="option-severity-yellow">
                      <span className="flex items-center gap-2">
                        <span className="inline-block w-2.5 h-2.5 rounded-full bg-yellow-400 flex-shrink-0" />
                        Yellow
                      </span>
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={exportToCSV}
                  disabled={filteredIncidents.length === 0}
                  data-testid="button-export-csv"
                  className="h-8 w-8 shrink-0"
                  title="Export CSV"
                >
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {(selectedMapId !== null || hasDateFilter || importBatchIdFilter !== null || severityFilter !== "any") && (
              <div className="flex items-center gap-2 mt-2 flex-wrap" data-testid="active-filters-row">
                {importBatchIdFilter !== null && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-xs pl-2 pr-1 py-1" data-testid="chip-import-batch-filter">
                    <BookOpen className="h-3 w-3" />
                    Import #{importBatchIdFilter}
                    <button
                      onClick={clearImportBatchFilter}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear import batch filter"
                      data-testid="button-clear-import-batch-filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {hasDateFilter && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-xs pl-2 pr-1 py-1" data-testid="chip-date-filter">
                    <CalendarRange className="h-3 w-3" />
                    {dateFrom && dateTo
                      ? `${dateFrom} – ${dateTo}`
                      : dateFrom
                      ? `From ${dateFrom}`
                      : `To ${dateTo}`}
                    <button
                      onClick={clearDateFilter}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear date filter"
                      data-testid="button-clear-date-filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
                {selectedMapId !== null && (() => {
                  const activeMap = customMaps.find((m) => m.id === selectedMapId);
                  return (
                    <Badge variant="secondary" className="flex items-center gap-1 text-xs pl-2 pr-1 py-1" data-testid="chip-map-filter">
                      <MapIcon className="h-3 w-3" />
                      {activeMap?.name ?? "Map"}
                      <button
                        onClick={() => setSelectedMapId(null)}
                        className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                        aria-label="Clear map filter"
                        data-testid="button-clear-map-filter"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  );
                })()}
                {severityFilter !== "any" && (
                  <Badge variant="secondary" className="flex items-center gap-1 text-xs pl-2 pr-1 py-1" data-testid="chip-severity-filter">
                    <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${severityFilter === "red" ? "bg-red-500" : severityFilter === "orange" ? "bg-orange-500" : "bg-yellow-400"}`} />
                    {severityFilter.charAt(0).toUpperCase() + severityFilter.slice(1)}
                    <button
                      onClick={() => setSeverityFilter("any")}
                      className="ml-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5"
                      aria-label="Clear severity filter"
                      data-testid="button-clear-severity-filter"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                )}
              </div>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="p-12 text-center">
                <BookOpen className="mx-auto h-12 w-12 text-muted-foreground/30" />
                {(selectedMapId !== null || hasDateFilter || importBatchIdFilter !== null) ? (
                  <>
                    <h3 className="mt-4 text-lg font-medium" data-testid="text-empty-state">No incidents match the selected filters</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Try adjusting the date range or site map filter.
                    </p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => { setSelectedMapId(null); clearDateFilter(); clearImportBatchFilter(); setSeverityFilter("any"); }}
                      data-testid="button-clear-filter-empty"
                    >
                      Clear all filters
                    </Button>
                  </>
                ) : (
                  <>
                    <h3 className="mt-4 text-lg font-medium" data-testid="text-empty-state">No incidents found</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Start by reporting your first incident.
                    </p>
                    <Button
                      className="mt-4"
                      onClick={() => {
                        setEditingIncident(null);
                        setDialogOpen(true);
                      }}
                      data-testid="button-first-incident"
                    >
                      <Plus className="h-4 w-4 mr-1.5" />
                      Report First Incident
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-center">Incident #</TableHead>
                      {showDateTime && <TableHead className="text-center">Date & Time</TableHead>}
                      {showCategory && <TableHead className="text-center">Type</TableHead>}
                      {showLocation && <TableHead className="text-center">Location</TableHead>}
                      {visibleCustomFields.map((cf) => (
                        <TableHead key={cf.fieldKey} className="text-center">{cf.label}</TableHead>
                      ))}
                      <TableHead className="text-center">Severity</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredIncidents.map((incident) => {
                      const customData = (incident.customFields as Record<string, string | number | null>) || {};
                      return (
                        <TableRow key={incident.id} data-testid={`row-incident-${incident.id}`}>
                          <TableCell className="text-sm font-medium text-center whitespace-nowrap" data-testid={`text-incident-number-${incident.id}`}>
                            {incidentNumberMap.get(incident.id) ?? incident.id}
                          </TableCell>
                          {showDateTime && (
                            <TableCell className="text-center">
                              <div>
                                <p className="text-sm font-medium">{incident.incidentDate}</p>
                                <p className="text-xs text-muted-foreground">{incident.incidentTime}</p>
                              </div>
                            </TableCell>
                          )}
                          {showCategory && (
                            <TableCell className="text-center">
                              <div className="flex flex-col items-center gap-1">
                                <span className="text-sm">{getCategoryName(incident)}</span>
                                {incident.isLive && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/25 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide" data-testid={`badge-live-${incident.id}`}>
                                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                                    LIVE
                                  </span>
                                )}
                                {!incident.isLive && (incident as any).panicClosedAt && (
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
                            const mapsUrl = getGoogleMapsUrl(incident) ||
                              (locDisplay.type === "text" && /^-?\d+\.\d+, -?\d+\.\d+$/.test(locDisplay.label?.trim() ?? "")
                                ? `https://www.google.com/maps?q=${locDisplay.label!.trim()}`
                                : null);
                            return (
                              <TableCell className="text-sm max-w-[160px] text-center" data-testid={`text-location-${incident.id}`}>
                                {locDisplay.type === "customMap" ? (
                                  <span className="flex items-center justify-center gap-1 truncate">
                                    <MapIcon className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                                    <span className="truncate">{locDisplay.label} — pin placed</span>
                                  </span>
                                ) : mapsUrl ? (
                                  <a
                                    href={mapsUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="truncate block text-primary hover:underline"
                                    data-testid={`link-location-${incident.id}`}
                                  >
                                    {locDisplay.label}
                                  </a>
                                ) : (
                                  <span className="truncate block">{locDisplay.label}</span>
                                )}
                              </TableCell>
                            );
                          })()}
                          {visibleCustomFields.map((cf) => {
                            const val = customData[cf.fieldKey]?.toString() || "";
                            return (
                              <TableCell key={cf.fieldKey} className="text-sm text-center">
                                {val ? (
                                  cf.fieldType === "file" ? (
                                    <a href={val} target="_blank" rel="noopener noreferrer" data-testid={`btn-file-custom-${cf.fieldKey}`}>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" type="button" tabIndex={-1}>
                                        <Paperclip className="h-4 w-4 text-muted-foreground" />
                                      </Button>
                                    </a>
                                  ) : (
                                    <Popover>
                                      <PopoverTrigger asChild>
                                        <Button variant="ghost" size="icon" className="h-7 w-7" data-testid={`btn-view-custom-${cf.fieldKey}`}>
                                          <Eye className="h-4 w-4 text-muted-foreground" />
                                        </Button>
                                      </PopoverTrigger>
                                      <PopoverContent className="max-w-sm whitespace-pre-wrap text-sm" data-testid={`popover-custom-${cf.fieldKey}`}>
                                        {val}
                                      </PopoverContent>
                                    </Popover>
                                  )
                                ) : (
                                  "-"
                                )}
                              </TableCell>
                            );
                          })}
                          <TableCell className="text-center" data-testid={`cell-severity-${incident.id}`}>
                            {incident.severity ? (
                              <span
                                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold border ${
                                  incident.severity === "red"
                                    ? "bg-red-500/15 text-red-700 dark:text-red-400 border-red-500/30"
                                    : incident.severity === "orange"
                                    ? "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30"
                                    : "bg-yellow-400/15 text-yellow-700 dark:text-yellow-400 border-yellow-400/30"
                                }`}
                                data-testid={`badge-severity-${incident.id}`}
                              >
                                <span
                                  className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${
                                    incident.severity === "red"
                                      ? "bg-red-500"
                                      : incident.severity === "orange"
                                      ? "bg-orange-500"
                                      : "bg-yellow-400"
                                  }`}
                                />
                                {incident.severity.charAt(0).toUpperCase() + incident.severity.slice(1)}
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-xs">—</span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setViewingIncident(incident)}
                                data-testid={`button-view-${incident.id}`}
                                title="View"
                              >
                                <Eye className="h-3.5 w-3.5" />
                              </Button>
                              {canEdit && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => {
                                  setEditingIncident(incident);
                                  setDialogOpen(true);
                                }}
                                data-testid={`button-edit-${incident.id}`}
                                title="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              )}
                              {canManageAtts && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setAttachmentsIncidentId(incident.id)}
                                data-testid={`button-attachments-${incident.id}`}
                                title="Attachments"
                              >
                                <Paperclip className="h-3.5 w-3.5" />
                              </Button>
                              )}
                              {canDelete && (
                              <Button
                                size="icon"
                                variant="ghost"
                                onClick={() => setDeleteId(incident.id)}
                                data-testid={`button-delete-${incident.id}`}
                                title="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
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
            )}
          </CardContent>
        </Card>
      </div>

      <IncidentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        incident={editingIncident}
      />

      {attachmentsIncidentId !== null && (
        <AttachmentsDialog
          open={true}
          onOpenChange={(open) => { if (!open) setAttachmentsIncidentId(null); }}
          incidentId={attachmentsIncidentId}
        />
      )}

      <Sheet open={viewingIncident !== null} onOpenChange={(open) => { if (!open) setViewingIncident(null); }}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {viewingIncident && (() => {
            const inc = viewingIncident;
            const cat = categories.find((c) => c.id === inc.categoryId);
            const locDisplay = getLocationDisplay(inc);
            const locationLabel = locDisplay.label !== "-" ? locDisplay.label : null;
            const isCoords = locationLabel ? /^-?\d+(\.\d+)?,\s*-?\d+(\.\d+)?$/.test(locationLabel.trim()) : false;
            const coordUrl = isCoords && locationLabel
              ? `https://www.google.com/maps?q=${locationLabel.trim()}`
              : null;
            return (
              <>
                <SheetHeader className="mb-4">
                  <SheetTitle className="text-base font-semibold">
                    Incident {incidentNumberMap.get(inc.id) ?? String(inc.id)}
                  </SheetTitle>
                </SheetHeader>

                <div className="space-y-4">
                  {inc.liveStartedAt && (
                    <div className="flex items-center gap-1.5">
                      {inc.isLive ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
                          Live — Active
                        </span>
                      ) : (inc as any).panicClosedAt ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                          Panic — Closed
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-muted text-muted-foreground border border-border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50 shrink-0" />
                          Live — Ended
                        </span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Date</p>
                      <p className="text-sm mt-0.5">{inc.incidentDate}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Time</p>
                      <p className="text-sm mt-0.5">{inc.incidentTime}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Reported by</p>
                    <p className="text-sm mt-0.5">
                      {(inc as any).reporterFirstName || (inc as any).reporterLastName
                        ? `${(inc as any).reporterFirstName ?? ""} ${(inc as any).reporterLastName ?? ""}`.trim()
                        : "Unknown"}
                    </p>
                  </div>

                  {showCategory && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Category</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? "#6B7280" }} />
                        <span className="text-sm">{cat?.name ?? "Uncategorised"}</span>
                      </div>
                      {inc.otherCategoryNote && (
                        <p className="text-xs text-muted-foreground mt-0.5 ml-4">Note: {inc.otherCategoryNote}</p>
                      )}
                    </div>
                  )}

                  {showLocation && locationLabel && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Location</p>
                      {coordUrl ? (
                        <a href={coordUrl} target="_blank" rel="noopener noreferrer" className="text-sm mt-0.5 text-primary hover:underline flex items-center gap-1">
                          {locationLabel} <span className="text-[10px] text-muted-foreground">↗</span>
                        </a>
                      ) : (
                        <p className="text-sm mt-0.5">{locationLabel}</p>
                      )}
                    </div>
                  )}

                  {inc.severity && inc.severity !== "none" && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Severity</p>
                      <div className="mt-0.5">
                        {inc.severity === "red" && <span className="inline-flex items-center gap-1 rounded-full bg-red-600 text-white text-xs font-bold px-2 py-0.5">🔴 Red</span>}
                        {inc.severity === "orange" && <span className="inline-flex items-center gap-1 rounded-full bg-orange-500 text-white text-xs font-bold px-2 py-0.5">🟠 Orange</span>}
                        {inc.severity === "yellow" && <span className="inline-flex items-center gap-1 rounded-full bg-yellow-400 text-black text-xs font-bold px-2 py-0.5">🟡 Yellow</span>}
                      </div>
                    </div>
                  )}

                  {inc.description && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Description</p>
                      <p className="text-sm mt-0.5 whitespace-pre-wrap">{inc.description}</p>
                    </div>
                  )}

                  {inc.customFields && visibleCustomFields.length > 0 && (
                    visibleCustomFields
                      .filter(f => (inc.customFields as Record<string, unknown>)[f.fieldKey] != null && (inc.customFields as Record<string, unknown>)[f.fieldKey] !== "")
                      .map(f => (
                        <div key={f.fieldKey}>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{f.label}</p>
                          <p className="text-sm mt-0.5">{String((inc.customFields as Record<string, unknown>)[f.fieldKey])}</p>
                        </div>
                      ))
                  )}

                  {inc.liveStartedAt && (
                    <div className="pt-3 border-t border-border/40">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        Live Timeline
                      </p>
                      <div className="space-y-1.5">
                        <div className="flex justify-between items-baseline">
                          <span className="text-[10px] text-muted-foreground">Started</span>
                          <span className="text-xs">{new Date(inc.liveStartedAt).toLocaleString()}</span>
                        </div>
                        {(inc as any).liveStartLat != null && (inc as any).liveStartLng != null && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] text-muted-foreground">Origin</span>
                            <a
                              href={`https://www.google.com/maps?q=${(inc as any).liveStartLat},${(inc as any).liveStartLng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              {Number((inc as any).liveStartLat).toFixed(4)}, {Number((inc as any).liveStartLng).toFixed(4)} ↗
                            </a>
                          </div>
                        )}
                        {(inc as any).responderArrivedAt && (
                          <>
                            <div className="flex justify-between items-baseline">
                              <span className="text-[10px] text-muted-foreground">Arrived</span>
                              <span className="text-xs">{new Date((inc as any).responderArrivedAt).toLocaleString()}</span>
                            </div>
                            <div className="flex justify-between items-baseline">
                              <span className="text-[10px] text-muted-foreground">Response</span>
                              <span className="text-xs font-semibold">{(() => {
                                const mins = (new Date((inc as any).responderArrivedAt).getTime() - new Date(inc.liveStartedAt!).getTime()) / 60000;
                                return mins < 1 ? "< 1 min" : `${Math.round(mins)} min`;
                              })()}</span>
                            </div>
                          </>
                        )}
                        {(inc as any).liveEndedAt && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] text-muted-foreground">Ended</span>
                            <span className="text-xs">{new Date((inc as any).liveEndedAt).toLocaleString()}</span>
                          </div>
                        )}
                        {(inc as any).liveEndedAt && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] text-muted-foreground">End Type</span>
                            <span className="text-xs font-medium">
                              {(inc as any).liveClosedManually ? "Manually closed" : "Converted to incident"}
                            </span>
                          </div>
                        )}
                        {(inc as any).liveEndedAt && (inc as any).liveConvertLat != null && (inc as any).liveConvertLng != null && (
                          <div className="flex justify-between items-baseline">
                            <span className="text-[10px] text-muted-foreground">Closure Coords</span>
                            <a
                              href={`https://www.google.com/maps?q=${(inc as any).liveConvertLat},${(inc as any).liveConvertLng}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-primary hover:underline"
                            >
                              {Number((inc as any).liveConvertLat).toFixed(4)}, {Number((inc as any).liveConvertLng).toFixed(4)} ↗
                            </a>
                          </div>
                        )}
                        {(inc as any).liveEndedAt && inc.liveStartedAt && (() => {
                          const totalMin = Math.round((new Date((inc as any).liveEndedAt).getTime() - new Date(inc.liveStartedAt).getTime()) / 60000);
                          const arrivedAt = (inc as any).responderArrivedAt ? new Date((inc as any).responderArrivedAt) : null;
                          const sceneMin = arrivedAt ? Math.round((new Date((inc as any).liveEndedAt).getTime() - arrivedAt.getTime()) / 60000) : null;
                          const fmt = (m: number) => m < 1 ? "< 1 min" : `${m} min`;
                          return (
                            <>
                              <div className="flex justify-between items-baseline">
                                <span className="text-[10px] text-muted-foreground">Total Duration</span>
                                <span className="text-xs font-semibold">{fmt(totalMin)}</span>
                              </div>
                              {sceneMin != null && (
                                <div className="flex justify-between items-baseline">
                                  <span className="text-[10px] text-muted-foreground">Time on Scene</span>
                                  <span className="text-xs font-semibold">{fmt(sceneMin)}</span>
                                </div>
                              )}
                            </>
                          );
                        })()}
                      </div>
                    </div>
                  )}

                  {inc.liveStartedAt && viewingIncidentResponders.length > 0 && (
                    <div className="pt-3 border-t border-border/40">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Responders</p>
                      <div className="space-y-2">
                        {viewingIncidentResponders.map((r) => (
                          <div key={r.id} className="text-sm">
                            <div className="flex items-center justify-between">
                              <span className="font-medium">{`${r.firstName} ${r.lastName}`.trim()}</span>
                              {r.arrivedAt && (
                                <span className="text-[10px] text-muted-foreground">
                                  Arrived {new Date(r.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              )}
                            </div>
                            {r.arrivalNote && (
                              <p className="text-xs text-muted-foreground mt-0.5 ml-0">{r.arrivalNote}</p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="pt-3 border-t border-border/40">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">Attachments</p>
                    {inc.attachmentCount > 0 ? (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={() => {
                          setViewingIncident(null);
                          setAttachmentsIncidentId(inc.id);
                        }}
                        data-testid={`button-view-attachments-${inc.id}`}
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        View {inc.attachmentCount} attachment{inc.attachmentCount !== 1 ? "s" : ""}
                      </Button>
                    ) : (
                      <p className="text-sm text-muted-foreground">No attachments</p>
                    )}
                  </div>
                </div>
              </>
            );
          })()}
        </SheetContent>
      </Sheet>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Incident</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this incident? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Full-screen panic confirmation overlay — shared by both mobile and desktop trigger buttons */}
      {panicOpen && (
        <div className="fixed inset-0 z-[300] flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm px-6" data-testid="overlay-panic-confirm">
          <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
            <div className="relative flex items-center justify-center">
              <span className="absolute h-28 w-28 rounded-full bg-red-600/20 animate-ping" />
              <span className="absolute h-20 w-20 rounded-full bg-red-600/30" />
              <div className="relative h-24 w-24 rounded-full bg-red-600 flex items-center justify-center shadow-lg">
                <Siren className="h-12 w-12 text-white" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white tracking-tight">Send PANIC Alert?</h2>
              <p className="text-sm text-white/70 leading-relaxed">
                This will immediately alert <strong className="text-white">everyone</strong> in your organisation that you need urgent assistance. Your GPS location will be shared.
              </p>
            </div>
            {typeof Notification !== "undefined" && Notification.permission !== "granted" && (
              <div className="w-full flex items-start gap-2 rounded-xl bg-amber-500/15 border border-amber-500/40 px-4 py-3 text-xs text-amber-300 text-left">
                <Siren className="h-4 w-4 shrink-0 mt-0.5" />
                <span>Push notifications are not enabled — team members may not be alerted instantly.</span>
              </div>
            )}
            <div className="w-full space-y-3 pt-2">
              <button
                onClick={() => { setPanicOpen(false); sendPanic(); }}
                disabled={panicking}
                data-testid="button-confirm-panic"
                className="w-full h-14 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-bold text-base tracking-wide shadow-lg transition-all touch-manipulation disabled:opacity-60"
              >
                {panicking ? "Sending alert…" : "CONFIRM — Send Alert"}
              </button>
              <button
                onClick={() => setPanicOpen(false)}
                disabled={panicking}
                className="w-full h-12 rounded-2xl bg-white/10 hover:bg-white/20 text-white font-medium text-sm transition-all touch-manipulation"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
