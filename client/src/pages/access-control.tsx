import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Destination } from "@shared/schema";
import {
  hasAccessControlRole,
  usesAccessDeskUi,
  usesAccessOverviewUi,
} from "@shared/user-roles";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AccessEntryForm } from "@/components/access-control/access-entry-form";
import { AccessCheckoutPanel } from "@/components/access-control/access-checkout-panel";
import { AccessOverview } from "@/components/access-control/access-overview";
import { DestinationAdminSheet } from "@/components/access-control/destination-admin-sheet";
import {
  currentlyInsideQueryKey,
  currentlyInsideQueryOptions,
} from "@/lib/access-control-queries";
import {
  cacheAccessDestinations,
  readCachedAccessDestinations,
} from "@/lib/access-destinations-cache";
import { BarChart3, DoorOpen, LogOut, Plus, ShieldCheck } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";

type AccessControlPageProps = {
  userRole: string;
};

type PageView = "overview" | "desk";

export default function AccessControlPage({ userRole }: AccessControlPageProps) {
  const isDeskOnly = usesAccessDeskUi(userRole);
  const showOverview = usesAccessOverviewUi(userRole);
  const canUseDesk = hasAccessControlRole(userRole);
  const isOverviewOnly = showOverview && !canUseDesk;

  const [pageView, setPageView] = useState<PageView>(isDeskOnly ? "desk" : "overview");
  const [tab, setTab] = useState<"checkin" | "checkout">("checkin");
  const [destSheetOpen, setDestSheetOpen] = useState(false);
  const isAdmin = userRole === "administrator";
  const qc = useQueryClient();

  const { data: destinations = [], isLoading } = useQuery<Destination[]>({
    queryKey: ["/api/access-control/destinations", isAdmin ? "all" : "active"],
    queryFn: async () => {
      const url = isAdmin
        ? "/api/access-control/destinations?all=1"
        : "/api/access-control/destinations";
      try {
        const res = await fetch(url, { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load destinations");
        const data = (await res.json()) as Destination[];
        cacheAccessDestinations(data);
        return data;
      } catch (err) {
        const cached = readCachedAccessDestinations();
        if (cached && cached.length > 0) return cached;
        throw err;
      }
    },
  });

  const activeDestinations = destinations.filter((d) => d.active);

  const { data: inside = [] } = useQuery<{ id: number }[]>({
    queryKey: currentlyInsideQueryKey,
    ...currentlyInsideQueryOptions,
    enabled: canUseDesk,
  });

  useEffect(() => {
    if (tab === "checkout") {
      void qc.invalidateQueries({ queryKey: currentlyInsideQueryKey });
    }
  }, [tab, qc]);

  const subtitle =
    pageView === "overview"
      ? "Live occupancy, analytics, and visit audit log"
      : "Scan people & vehicles in, then check them out";

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className={cn("shrink-0 pt-3 pb-3", OPS_PAGE_SHELL)}>
        <PageHero
          eyebrow="Access Control"
          badge={pageView === "overview" ? "Overview" : "Gate desk"}
          total={canUseDesk ? inside.length : activeDestinations.length}
          totalLabel={canUseDesk ? "On site" : "Destinations"}
          emptyMessage={
            !canUseDesk && activeDestinations.length === 0
              ? "No active destinations configured yet."
              : undefined
          }
          description={subtitle}
          actions={
            <>
              {showOverview && canUseDesk && (
                <Button
                  type="button"
                  variant={pageView === "overview" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => setPageView("overview")}
                >
                  <BarChart3 className="h-4 w-4 mr-1" />
                  Overview
                </Button>
              )}
              {canUseDesk && !isDeskOnly && (
                <Button
                  type="button"
                  variant={pageView === "desk" ? "default" : "outline"}
                  size="sm"
                  className="h-8"
                  onClick={() => setPageView("desk")}
                >
                  <DoorOpen className="h-4 w-4 mr-1" />
                  Gate desk
                </Button>
              )}
              {isAdmin && (
                <Button type="button" variant="outline" size="sm" className="h-8" onClick={() => setDestSheetOpen(true)}>
                  <Plus className="h-4 w-4 mr-1" />
                  Destinations
                </Button>
              )}
            </>
          }
          insights={[
            { label: "Mode", value: pageView === "overview" ? "Analytics" : "Operations" },
            { label: "Destinations", value: String(activeDestinations.length) },
          ]}
        />
      </div>

      {pageView === "overview" || isOverviewOnly ? (
        <div className={cn("flex-1 overflow-y-auto pt-4", OPS_PAGE_SHELL)}>
          <AccessOverview />
        </div>
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as "checkin" | "checkout")}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="mx-4 mt-3 grid w-auto grid-cols-2 shrink-0">
            <TabsTrigger value="checkin" className="gap-1.5">
              <DoorOpen className="h-4 w-4" />
              Check in
            </TabsTrigger>
            <TabsTrigger value="checkout" className="gap-1.5">
              <LogOut className="h-4 w-4" />
              Check out
              {inside.length > 0 && (
                <span className="ml-1 rounded-full bg-primary text-primary-foreground text-[10px] px-1.5 py-0.5 min-w-[1.25rem]">
                  {inside.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto px-4 pt-4">
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-32 w-full" />
              </div>
            ) : activeDestinations.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <p className="font-medium">No destinations configured</p>
                <p className="text-sm text-muted-foreground mt-2">
                  An administrator must add destinations before guards can log entries.
                </p>
                {isAdmin && (
                  <Button type="button" className="mt-4" onClick={() => setDestSheetOpen(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add first destination
                  </Button>
                )}
              </div>
            ) : (
              <>
                <TabsContent value="checkin" className="mt-0">
                  <AccessEntryForm
                    destinations={activeDestinations}
                    onCreated={() => setTab("checkout")}
                  />
                </TabsContent>
                <TabsContent value="checkout" className="mt-0">
                  <AccessCheckoutPanel />
                </TabsContent>
              </>
            )}
          </div>
        </Tabs>
      )}

      {isAdmin && (
        <DestinationAdminSheet
          open={destSheetOpen}
          onOpenChange={setDestSheetOpen}
          destinations={destinations}
        />
      )}
    </div>
  );
}
