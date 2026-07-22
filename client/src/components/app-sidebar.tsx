import { BookOpen, Settings, BarChart3, LogOut, Users, Upload, Bell, Radio, LayoutDashboard, MessageSquare, Shield, Network, Car, ShieldCheck, Footprints, ChevronRight, MonitorSmartphone } from "lucide-react";
import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { HeartbeatLine } from "@/components/heartbeat-line";
import { OmtShield } from "@/components/omt-shield";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { canViewAccessControlModule, isDispatchStaff, canUseLiveIncidentWorkflow, canAccessPatrolModule } from "@shared/user-roles";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarHeader,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type NavItem = { title: string; url: string; icon: typeof BookOpen };

type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  isSuperadmin?: boolean;
};

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

function NotificationsButton() {
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">(
    () => ("Notification" in window ? Notification.permission : "unsupported")
  );
  const [busy, setBusy] = useState(false);
  const [blockedHint, setBlockedHint] = useState(false);

  useEffect(() => {
    if (!("Notification" in window)) return;
    setPermission(Notification.permission);
  }, []);

  if (permission === "unsupported" || permission === "granted") return null;

  async function requestPush() {
    if (busy) return;
    setBusy(true);
    setBlockedHint(false);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== "granted") {
        setBlockedHint(true);
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" });
      await navigator.serviceWorker.ready;
      const vapidRes = await fetch("/api/push/vapid-public-key", { credentials: "include" });
      if (!vapidRes.ok) return;
      const { vapidPublicKey } = await vapidRes.json();
      const existing = await reg.pushManager.getSubscription();
      const sub = existing ?? await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(sub.toJSON()),
      });
      if (/android/i.test(navigator.userAgent)) {
        try {
          if (localStorage.getItem("omt_battery_hint_shown") !== "1" &&
              sessionStorage.getItem("omt_battery_hint_snoozed") !== "1") {
            window.dispatchEvent(new CustomEvent("omt:battery-hint-show"));
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={requestPush}
        disabled={busy}
        data-testid="button-enable-notifications"
      >
        <Bell className="h-4 w-4" />
        Enable Notifications
      </Button>
      {blockedHint && (
        <p className="text-xs text-muted-foreground px-1" data-testid="text-notifications-blocked">
          Blocked by browser — open site settings and allow notifications, then try again.
        </p>
      )}
    </div>
  );
}

type MyCommandsResponse = {
  commands: Array<{ id: number; name: string; isCentral: boolean }>;
  activeCommandId: number | "all" | null;
  canSeeAll: boolean;
  otherCommands: Array<{ id: number; name: string; isCentral: boolean }>;
};

function CommandSwitcher() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery<MyCommandsResponse>({ queryKey: ["/api/me/commands"] });

  const mutation = useMutation({
    mutationFn: (commandId: number | "all") =>
      apiRequest("PATCH", "/api/me/active-command", { commandId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/me/commands"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents/live"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/form-fields"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trackers"] });
      queryClient.invalidateQueries({ queryKey: ["/api/custom-maps"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commands/visibility-grants"] });
      queryClient.invalidateQueries({ queryKey: ["/api/commands/visibility-requests"] });
    },
  });

  if (isLoading || !data) return null;
  const showAll = data.canSeeAll;
  const options = data.commands;
  const hasOthersToRequest = (data.otherCommands?.length ?? 0) > 0;
  if (!showAll && options.length <= 1 && !hasOthersToRequest) return null;

  const currentValue = data.activeCommandId === "all" ? "all" : data.activeCommandId == null ? "" : String(data.activeCommandId);

  return (
    <div className="px-2 pb-2" data-testid="container-command-switcher">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground mb-1 px-1">
        <Network className="h-3 w-3" /> Active Group
      </div>
      <Select
        value={currentValue}
        onValueChange={(v) => mutation.mutate(v === "all" ? "all" : Number(v))}
      >
        <SelectTrigger className="h-9 text-sm" data-testid="select-command">
          <SelectValue placeholder="Select a Group" />
        </SelectTrigger>
        <SelectContent>
          {showAll && (
            <SelectItem value="all" data-testid="option-command-all">All Groups</SelectItem>
          )}
          {options.map((c) => (
            <SelectItem key={c.id} value={String(c.id)} data-testid={`option-command-${c.id}`}>
              {c.name}{c.isCentral ? " (Central)" : ""}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasOthersToRequest && (
        <Link
          href="/visibility"
          className="block mt-1.5 text-[11px] text-muted-foreground hover:text-primary px-1"
          data-testid="link-request-visibility"
        >
          Request access to another Group →
        </Link>
      )}
    </div>
  );
}

interface AppSidebarProps {
  user: AuthUser;
  onLogout: () => void;
  avatarPreview?: string | null;
}

function getNavItems(role: string, isSuperadmin: boolean): {
  primary: NavItem[];
  admin: NavItem[];
  secondary: NavItem[];
} {
  const primary: NavItem[] = [
    { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
    { title: "Occurrence Book", url: "/occurrence-book", icon: BookOpen },
  ];
  if (canViewAccessControlModule(role)) {
    primary.push({ title: "Access Control", url: "/access-control", icon: ShieldCheck });
  }
  if (canAccessPatrolModule(role)) {
    primary.push({ title: "Patrol", url: "/patrol", icon: Footprints });
  }
  if (isDispatchStaff(role)) {
    primary.push({ title: "Analytics", url: "/analytics", icon: BarChart3 });
    primary.push({ title: "Live Monitor", url: "/live-monitor", icon: Radio });
    primary.push({ title: "Fleet", url: "/fleet", icon: Car });
  }
  if (canUseLiveIncidentWorkflow(role) && !isDispatchStaff(role)) {
    primary.push({ title: "Live Incident", url: "/live-incident", icon: Radio });
  }

  const admin: NavItem[] = [];
  if (role === "administrator") {
    admin.push({ title: "Users", url: "/user-admin", icon: Users });
    admin.push({ title: "Positions", url: "/positions", icon: MonitorSmartphone });
    admin.push({ title: "Field setup", url: "/admin", icon: Settings });
    admin.push({ title: "Import Data", url: "/import", icon: Upload });
  }
  if (role === "administrator" || isSuperadmin) {
    admin.push({ title: "Groups", url: "/commands", icon: Shield });
  }

  const secondary: NavItem[] = [
    { title: "Chat", url: "/chat", icon: MessageSquare },
    { title: "Notifications", url: "/notifications", icon: Bell },
  ];
  return { primary, admin, secondary };
}

function VersionLabel() {
  const { data } = useQuery<{ build: string }>({
    queryKey: ["/api/version"],
    refetchInterval: false,
    staleTime: Infinity,
  });
  if (!data?.build) return null;
  return (
    <p className="text-center text-[10px] text-muted-foreground/50 select-none" data-testid="text-app-version">
      v{data.build}
    </p>
  );
}

export function AppSidebar({ user, onLogout, avatarPreview }: AppSidebarProps) {
  const [location] = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();
  const { primary: navItems, admin: adminItems, secondary: secondaryItems } = getNavItems(user.role, !!user.isSuperadmin);
  const adminActive = adminItems.some((item) => location === item.url);
  const [adminOpen, setAdminOpen] = useState(adminActive);

  useEffect(() => {
    if (adminActive) setAdminOpen(true);
  }, [adminActive]);

  function closeOnMobile() {
    if (isMobile) setOpenMobile(false);
  }

  const { data: liveIncidents = [] } = useQuery<unknown[]>({
    queryKey: ["/api/incidents/live"],
    refetchInterval: 5000,
  });
  const liveCount = liveIncidents.length;

  const { data: chatConvos = [] } = useQuery<Array<{ unreadCount: number }>>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 5000,
  });
  const chatUnread = chatConvos.reduce((sum, c) => sum + c.unreadCount, 0);

  return (
    <Sidebar className="border-r border-slate-800/80">
      <SidebarHeader className="p-3">
        <div className="flex flex-col items-center gap-1.5 pb-0.5">
          <OmtShield variant="mark" className="h-11 w-11 rounded-xl" />
          <div className="text-center">
            <div className="flex items-center justify-center gap-1.5">
              <h2 className="text-sm font-bold tracking-tight" data-testid="text-app-title">OMT Pulse</h2>
              <HeartbeatLine className="w-12 h-3.5" />
            </div>
            <div className="flex items-center justify-center gap-1.5 mt-0.5">
              <div className="h-px w-4 bg-gradient-to-r from-transparent to-primary/40" />
              <span className="text-[8px] text-muted-foreground/40 font-light">powered by</span>
              <span className="text-[9px] font-semibold tracking-[0.1em] uppercase text-primary/50">IntelAfri</span>
              <div className="h-px w-4 bg-gradient-to-l from-transparent to-primary/40" />
            </div>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <CommandSwitcher />
        <SidebarGroup>
          <SidebarGroupLabel className="text-[10px] uppercase tracking-wider">Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    <Link href={item.url} onClick={closeOnMobile}>
                      <item.icon />
                      <span className="flex-1">{item.title}</span>
                      {(item.url === "/live-monitor" || item.url === "/live-incident") && liveCount > 0 && (
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}

              {adminItems.length > 0 && (
                <Collapsible open={adminOpen} onOpenChange={setAdminOpen} className="group/admin-nav">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={adminActive}
                        data-testid="link-nav-admin"
                      >
                        <Settings />
                        <span className="flex-1">Admin</span>
                        <ChevronRight className={`h-4 w-4 transition-transform ${adminOpen ? "rotate-90" : ""}`} />
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {adminItems.map((item) => (
                          <SidebarMenuSubItem key={item.url}>
                            <SidebarMenuSubButton
                              asChild
                              isActive={location === item.url}
                              data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, '-')}`}
                            >
                              <Link href={item.url} onClick={closeOnMobile}>
                                <item.icon />
                                <span>{item.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}

              {secondaryItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={location === item.url}
                    data-testid={`link-nav-${item.title.toLowerCase().replace(/\s/g, '-')}`}
                  >
                    <Link href={item.url} onClick={closeOnMobile}>
                      <item.icon />
                      <span className="flex-1">{item.title}</span>
                      {item.url === "/chat" && chatUnread > 0 && (
                        <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-semibold leading-none" data-testid="badge-sidebar-chat-unread">
                          {chatUnread > 99 ? "99+" : chatUnread}
                        </span>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-3 space-y-2">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 border border-border" data-testid="avatar-sidebar">
            {(avatarPreview || user.avatarUrl) ? (
              <img src={avatarPreview ?? user.avatarUrl!} alt={user.firstName} className="h-full w-full object-cover" />
            ) : (
              <span className="text-xs font-semibold text-primary select-none">
                {`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()}
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium truncate" data-testid="text-user-name">
                {user.firstName} {user.lastName}
              </p>
              <Badge variant="secondary" className="text-xs shrink-0 capitalize" data-testid="text-user-role">
                {user.role}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground truncate" data-testid="text-user-email">{user.email}</p>
          </div>
        </div>
        <NotificationsButton />
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={onLogout}
          data-testid="button-sign-out"
        >
          <LogOut className="h-4 w-4" />
          Sign Out
        </Button>
        <VersionLabel />
        <Link
          href="/privacy"
          className="block text-center text-[10px] text-muted-foreground hover:text-foreground hover:underline"
          data-testid="link-sidebar-privacy"
        >
          Privacy Policy
        </Link>
      </SidebarFooter>
    </Sidebar>
  );
}
