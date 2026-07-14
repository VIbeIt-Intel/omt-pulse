import { useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, ChevronRight, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import type { Category } from "@shared/schema";

const LIVE_SEV_KEY = "omt_live_severity_sel";
const LIVE_CAT_KEY = "omt_live_category_sel";

type Severity = "red" | "orange" | "yellow";

const SEVERITY_CONFIG: Record<
  Severity,
  {
    label: string;
    stripeClass: string;
    dotClass: string;
    tileClass: string;
    textClass: string;
    chevronClass: string;
    description: string;
    noticeText: string;
  }
> = {
  red: {
    label: "Red Alert",
    stripeClass: "bg-red-600",
    dotClass: "bg-red-600",
    tileClass: "bg-red-500/8 border-red-500/40 dark:border-red-500/30",
    textClass: "text-red-600 dark:text-red-400",
    chevronClass: "text-red-500",
    description: "Immediate threat",
    noticeText: "All users notified with push alert",
  },
  orange: {
    label: "Orange Alert",
    stripeClass: "bg-orange-500",
    dotClass: "bg-orange-500",
    tileClass: "bg-orange-500/8 border-orange-400/40 dark:border-orange-400/30",
    textClass: "text-orange-600 dark:text-orange-400",
    chevronClass: "text-orange-400",
    description: "High priority",
    noticeText: "Supervisors & admins notified",
  },
  yellow: {
    label: "Yellow Alert",
    stripeClass: "bg-yellow-400",
    dotClass: "bg-yellow-500",
    tileClass: "bg-yellow-400/8 border-yellow-400/40 dark:border-yellow-400/30",
    textClass: "text-yellow-700 dark:text-yellow-400",
    chevronClass: "text-yellow-500",
    description: "Monitoring",
    noticeText: "Silent tracking, no push notification",
  },
};

export default function LiveSeverityPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Severity | null>(null);
  const [notifying, setNotifying] = useState(false);

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const severityCategories = (sev: Severity) =>
    categories.filter((c) => c.severity === sev);

  async function handleSelectCategory(sev: Severity, cat: Category) {
    if (notifying) return;
    try {
      setNotifying(true);
      try {
        localStorage.setItem(LIVE_SEV_KEY, sev);
        localStorage.setItem(LIVE_CAT_KEY, String(cat.id));
        localStorage.setItem("omt_live_autostart", "1");
      } catch { /* ignore storage errors */ }

      if (sev !== "yellow") {
        const resp = await apiRequest("POST", "/api/live-incidents/notify-severity", {
          categoryId: cat.id,
          severity: sev,
        });
        await resp.json();
      }

      navigate("/live-incident");
    } catch (e: unknown) {
      toast({
        title: "Notification failed",
        description: e instanceof Error ? e.message : "Could not send alert. Proceeding anyway.",
        variant: "destructive",
      });
      navigate("/live-incident");
    } finally {
      setNotifying(false);
    }
  }

  function toggleExpand(sev: Severity) {
    setExpanded((prev) => (prev === sev ? null : sev));
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header — back button + title inside the black bar */}
      <div className="px-3 py-3 bg-black text-white shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate("/")}
            className="flex items-center justify-center h-9 w-9 rounded-lg text-white/80 hover:text-white hover:bg-white/10 transition-colors shrink-0"
            data-testid="button-back-severity"
            aria-label="Back"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="text-base font-semibold leading-tight">Select Incident Severity</div>
            <div className="text-xs text-white/60 mt-0.5">Tap a severity, then choose a category</div>
          </div>
        </div>
      </div>

      {/* Severity tiles */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {(["red", "orange", "yellow"] as Severity[]).map((sev) => {
          const cfg = SEVERITY_CONFIG[sev];
          const cats = severityCategories(sev);
          const isOpen = expanded === sev;

          return (
            <div
              key={sev}
              className={`rounded-2xl border overflow-hidden transition-all ${cfg.tileClass}`}
              data-testid={`severity-tile-${sev}`}
            >
              <button
                className="w-full flex items-center gap-0 text-left transition-colors active:bg-black/5 dark:active:bg-white/5"
                onClick={() => toggleExpand(sev)}
                data-testid={`button-expand-severity-${sev}`}
              >
                {/* Left colour stripe */}
                <span className={`self-stretch w-1.5 shrink-0 rounded-l-2xl ${cfg.stripeClass}`} />

                <div className="flex items-center gap-4 px-4 py-4 flex-1 min-w-0">
                  {/* Coloured dot */}
                  <span className={`h-11 w-11 rounded-full shrink-0 ${cfg.dotClass} shadow-md flex items-center justify-center`}>
                    <span className="text-white text-lg font-bold">
                      {sev === "red" ? "R" : sev === "orange" ? "O" : "Y"}
                    </span>
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className={`text-base font-bold ${cfg.textClass}`}>{cfg.label}</div>
                    <div className="text-sm text-foreground/70 font-medium">{cfg.description}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{cfg.noticeText}</div>
                    <div className="text-xs text-muted-foreground mt-1 font-medium">
                      {isLoading
                        ? "Loading…"
                        : cats.length === 0
                        ? "No categories assigned"
                        : `${cats.length} categor${cats.length === 1 ? "y" : "ies"}`}
                    </div>
                  </div>

                  {isOpen ? (
                    <ChevronDown className={`h-5 w-5 shrink-0 ${cfg.chevronClass}`} />
                  ) : (
                    <ChevronRight className={`h-5 w-5 shrink-0 ${cfg.chevronClass}`} />
                  )}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border/40 divide-y divide-border/30">
                  {isLoading ? (
                    <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span className="text-sm">Loading…</span>
                    </div>
                  ) : cats.length === 0 ? (
                    <div className="px-5 py-6 text-center">
                      <p className="text-sm text-muted-foreground">
                        No categories have been assigned to this severity level.
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Ask your administrator to assign categories in Field Admin.
                      </p>
                    </div>
                  ) : (
                    cats.map((cat) => (
                      <button
                        key={cat.id}
                        className="w-full flex items-center gap-3 pl-6 pr-5 py-3.5 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors disabled:opacity-60 active:bg-black/8"
                        onClick={() => handleSelectCategory(sev, cat)}
                        disabled={notifying}
                        data-testid={`button-select-category-${cat.id}`}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0 border border-white/20 shadow-sm"
                          style={{ backgroundColor: cat.color ?? "#6B7280" }}
                        />
                        <span className="font-medium text-sm flex-1">{cat.name}</span>
                        {notifying ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                        ) : (
                          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Skip link — de-emphasised */}
        <div className="pt-4 pb-2 flex justify-center">
          <button
            onClick={() => navigate("/live-incident")}
            className="text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline"
            data-testid="button-skip-severity"
          >
            Skip — proceed without severity
          </button>
        </div>
      </div>
    </div>
  );
}
