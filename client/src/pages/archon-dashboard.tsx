import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  ShieldAlert, LogOut, Loader2, Users, RefreshCw, KeyRound, Gift,
  UserCheck, UserX, Trash2, ChevronDown, ChevronRight, Plus, Building2,
  Pencil, ToggleLeft, ToggleRight, FileText, TrendingUp, UserPlus,
  Download, Activity, Paperclip, CalendarDays, UserRound, Bell, MapPin,
  Share2,
} from "lucide-react";
import { ArchonOnboardingShare } from "@/components/archon-onboarding-share";
import type { OnboardingUserInfo } from "@/lib/onboarding-messages";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Types ────────────────────────────────────────────────────────────────────

type UserCounts = { administrator: number; supervisor: number; control_room: number; reporter: number; access_controller: number; patrol_user: number; total: number };

type ArchonOrg = {
  id: string;
  name: string;
  address: string;
  phone: string;
  createdAt: string;
  trialEndsAt: string | null;
  subscriptionStatus: string;
  isComplimentary: boolean;
  contractRef: string | null;
  contractStartDate: string | null;
  contractRenewalDate: string | null;
  rateAdmin: number | null;
  rateSupervisor: number | null;
  rateReporter: number | null;
  rateAccessController: number | null;
  rateControlRoom: number | null;
  ratePatrolUser: number | null;
  storageLimitGb: number | null;
  billingNotes: string | null;
  companyRegistrationNumber: string | null;
  vatNumber: string | null;
  primaryContactFirstName: string | null;
  primaryContactLastName: string | null;
  primaryContactEmail: string | null;
  primaryContactPhone: string | null;
  userCounts: UserCounts;
  incidentCount: number;
  lastActivityAt: string | null;
};

type OrgUsageData = {
  userCounts: { administrator: number; supervisor: number; control_room: number; reporter: number; access_controller: number; patrol_user: number; total: number };
  incidentsTotal: number;
  incidentsThisMonth: number;
  activeUsers30d: number;
  attachmentCount: number;
  storageBytes: number;
  lastActivityAt: string | null;
  monthlyTotal: number | null;
  pushSentThisMonth: number;
  pushSentTotal: number;
  pushSubscriberCount: number;
  geocodedIncidentCount: number;
};

type ArchonSummary = {
  totalOrgCount: number;
  activeOrgCount: number;
  totalUsers: number;
  totalIncidents: number;
  incidentsThisMonth: number;
  estimatedMrrCents: number;
};

type ArchonUser = {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNumber: string | null;
  homeAddress: string | null;
  posting: string | null;
  role: string;
  isActive: boolean;
  orgName: string;
  orgIsComplimentary: boolean;
  orgSubscriptionStatus: string;
  orgTrialEndsAt: string | null;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRand(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return `R ${(cents / 100).toFixed(0)}`;
}

function calcMonthly(org: ArchonOrg): number | null {
  const { userCounts, rateAdmin, rateSupervisor, rateReporter, rateAccessController, rateControlRoom, ratePatrolUser } = org;
  if (rateAdmin == null && rateSupervisor == null && rateReporter == null && rateAccessController == null && rateControlRoom == null && ratePatrolUser == null) return null;
  const controlRoomRate = rateControlRoom ?? rateSupervisor ?? 0;
  const patrolRate = ratePatrolUser ?? rateReporter ?? 0;
  return (userCounts.administrator * (rateAdmin ?? 0)) +
    (userCounts.supervisor * (rateSupervisor ?? 0)) +
    (userCounts.control_room * controlRoomRate) +
    (userCounts.reporter * (rateReporter ?? 0)) +
    (userCounts.patrol_user * patrolRate) +
    (userCounts.access_controller * (rateAccessController ?? 0));
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

function renewalDays(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getOrgStatus(org: ArchonOrg): string {
  if (org.isComplimentary) return "complimentary";
  if (org.subscriptionStatus === "active") return "active";
  if (org.subscriptionStatus === "trial" && org.trialEndsAt && new Date(org.trialEndsAt).getTime() > Date.now()) return "trial";
  return "expired";
}

// ─── Small components ─────────────────────────────────────────────────────────

function OrgStatusBadge({ org }: { org: ArchonOrg }) {
  const s = getOrgStatus(org);
  if (s === "complimentary") return <Badge className="bg-emerald-600 text-white text-xs">Comp</Badge>;
  if (s === "active") return <Badge className="bg-green-700 text-white text-xs">Active</Badge>;
  if (s === "trial") return <Badge variant="secondary" className="text-xs">Trial</Badge>;
  return <Badge variant="destructive" className="text-xs">Expired</Badge>;
}

function RoleBadge({ role }: { role: string }) {
  const map: Record<string, string> = {
    administrator: "bg-purple-600 text-white",
    control_room: "bg-cyan-700 text-white",
    supervisor: "bg-blue-600 text-white",
    patrol_user: "bg-amber-700 text-white",
    access_controller: "bg-emerald-700 text-white",
    reporter: "bg-slate-600 text-white",
  };
  return <Badge className={`text-xs capitalize ${map[role] ?? "bg-muted"}`}>{role.replace(/_/g, " ")}</Badge>;
}

function UserStatusBadge({ isActive }: { isActive: boolean }) {
  return isActive
    ? <Badge className="bg-green-700 text-white text-xs">Active</Badge>
    : <Badge variant="destructive" className="text-xs">Inactive</Badge>;
}

// ─── New Client form state ────────────────────────────────────────────────────

type NewClientForm = {
  orgName: string; orgAddress: string; orgPhone: string;
  companyRegistrationNumber: string; vatNumber: string;
  primaryContactFirstName: string; primaryContactLastName: string;
  primaryContactEmail: string; primaryContactPhone: string;
  adminFirstName: string; adminLastName: string; adminEmail: string; adminPassword: string;
  contractRef: string; contractStartDate: string; contractRenewalDate: string;
  rateAdmin: string; rateSupervisor: string; rateReporter: string; rateAccessController: string;
  rateControlRoom: string; ratePatrolUser: string;
  storageLimitGb: string; billingNotes: string;
  groups: string[];
  sendWelcomeEmail: boolean;
};

const emptyNewClient = (): NewClientForm => ({
  orgName: "", orgAddress: "", orgPhone: "",
  companyRegistrationNumber: "", vatNumber: "",
  primaryContactFirstName: "", primaryContactLastName: "",
  primaryContactEmail: "", primaryContactPhone: "",
  adminFirstName: "", adminLastName: "", adminEmail: "", adminPassword: "",
  contractRef: "", contractStartDate: "", contractRenewalDate: "",
  rateAdmin: "300", rateSupervisor: "200", rateReporter: "50", rateAccessController: "75",
  rateControlRoom: "100", ratePatrolUser: "100",
  storageLimitGb: "50", billingNotes: "",
  groups: [],
  sendWelcomeEmail: true,
});

type EditContractForm = {
  name: string; address: string; phone: string;
  companyRegistrationNumber: string; vatNumber: string;
  primaryContactFirstName: string; primaryContactLastName: string;
  primaryContactEmail: string; primaryContactPhone: string;
  contractRef: string; contractStartDate: string; contractRenewalDate: string;
  rateAdmin: string; rateSupervisor: string; rateReporter: string; rateAccessController: string;
  rateControlRoom: string; ratePatrolUser: string;
  storageLimitGb: string; billingNotes: string;
};

function orgToEditForm(org: ArchonOrg): EditContractForm {
  return {
    name: org.name,
    address: org.address,
    phone: org.phone,
    companyRegistrationNumber: org.companyRegistrationNumber ?? "",
    vatNumber: org.vatNumber ?? "",
    primaryContactFirstName: org.primaryContactFirstName ?? "",
    primaryContactLastName: org.primaryContactLastName ?? "",
    primaryContactEmail: org.primaryContactEmail ?? "",
    primaryContactPhone: org.primaryContactPhone ?? "",
    contractRef: org.contractRef ?? "",
    contractStartDate: org.contractStartDate ?? "",
    contractRenewalDate: org.contractRenewalDate ?? "",
    rateAdmin: org.rateAdmin != null ? String(org.rateAdmin / 100) : "",
    rateSupervisor: org.rateSupervisor != null ? String(org.rateSupervisor / 100) : "",
    rateReporter: org.rateReporter != null ? String(org.rateReporter / 100) : "",
    rateAccessController: org.rateAccessController != null ? String(org.rateAccessController / 100) : "",
    rateControlRoom: org.rateControlRoom != null ? String(org.rateControlRoom / 100) : "",
    ratePatrolUser: org.ratePatrolUser != null ? String(org.ratePatrolUser / 100) : "",
    storageLimitGb: org.storageLimitGb != null ? String(org.storageLimitGb) : "",
    billingNotes: org.billingNotes ?? "",
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 items-start">
      <Label className="text-white/60 text-xs pt-2 col-span-1">{label}</Label>
      <div className="col-span-2">{children}</div>
    </div>
  );
}

function inputCls(extra?: string) {
  return `bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm ${extra ?? ""}`;
}

// ─── Org Usage Panel (lazy-loaded when org row is expanded) ──────────────────

function OrgUsagePanel({ org }: { org: ArchonOrg }) {
  const { data: usage, isLoading } = useQuery<OrgUsageData>({
    queryKey: ["/api/archon/orgs", org.id, "usage"],
    queryFn: async () => {
      const res = await fetch(`/api/archon/orgs/${org.id}/usage`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load usage");
      return res.json();
    },
    staleTime: 60_000,
  });

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const monthLabel = now.toLocaleDateString("en-ZA", { month: "long", year: "numeric" });

  const rateAdmin = org.rateAdmin ?? 0;
  const rateSupervisor = org.rateSupervisor ?? 0;
  const rateReporter = org.rateReporter ?? 0;
  const rateAccessController = org.rateAccessController ?? 0;
  const rateControlRoom = org.rateControlRoom ?? org.rateSupervisor ?? 0;
  const ratePatrolUser = org.ratePatrolUser ?? org.rateReporter ?? 0;

  const counts = usage?.userCounts ?? org.userCounts;
  const adminAmt = counts.administrator * rateAdmin;
  const supervisorAmt = counts.supervisor * rateSupervisor;
  const controlRoomAmt = counts.control_room * rateControlRoom;
  const reporterAmt = counts.reporter * rateReporter;
  const patrolUserAmt = counts.patrol_user * ratePatrolUser;
  const accessControllerAmt = counts.access_controller * rateAccessController;
  const totalCents = adminAmt + supervisorAmt + controlRoomAmt + reporterAmt + patrolUserAmt + accessControllerAmt;
  const hasRates = rateAdmin > 0 || rateSupervisor > 0 || rateReporter > 0 || rateAccessController > 0 || rateControlRoom > 0 || ratePatrolUser > 0;

  function downloadInvoice() {
    window.open(`/api/archon/orgs/${org.id}/invoice?month=${currentMonth}`, "_blank");
  }

  return (
    <div className="px-6 py-4 border-b border-white/5 space-y-3">
      {/* Billing summary */}
      <div className="grid grid-cols-2 gap-4">
        {/* Left: role breakdown */}
        <div className="rounded-lg border border-white/10 p-3 space-y-2" style={{ background: "rgba(0,0,0,0.3)" }}>
          <div className="flex items-center justify-between">
            <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Billing — {monthLabel}</p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 gap-1 text-xs text-primary hover:text-primary/80 hover:bg-primary/10 px-2"
              onClick={downloadInvoice}
              title="Download invoice"
              data-testid={`button-archon-invoice-${org.id}`}
            >
              <Download className="h-3 w-3" />
              Invoice
            </Button>
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-purple-400">{counts.administrator} × Admin</span>
              <span className="text-white/60">{fmtRand(rateAdmin)} = <span className="text-white font-medium">{fmtRand(adminAmt)}</span></span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-blue-400">{counts.supervisor} × Supervisor</span>
              <span className="text-white/60">{fmtRand(rateSupervisor)} = <span className="text-white font-medium">{fmtRand(supervisorAmt)}</span></span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-cyan-400">{counts.control_room} × Control room</span>
              <span className="text-white/60">{fmtRand(rateControlRoom)} = <span className="text-white font-medium">{fmtRand(controlRoomAmt)}</span></span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-amber-400">{counts.patrol_user} × Patroller</span>
              <span className="text-white/60">{fmtRand(ratePatrolUser)} = <span className="text-white font-medium">{fmtRand(patrolUserAmt)}</span></span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-emerald-400">{counts.access_controller} × Access controller</span>
              <span className="text-white/60">{fmtRand(rateAccessController)} = <span className="text-white font-medium">{fmtRand(accessControllerAmt)}</span></span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400">{counts.reporter} × Reporter</span>
              <span className="text-white/60">{fmtRand(rateReporter)} = <span className="text-white font-medium">{fmtRand(reporterAmt)}</span></span>
            </div>
            <div className="flex items-center justify-between text-xs border-t border-white/10 pt-1 mt-1">
              <span className="text-white/50">Monthly total</span>
              <span className={`font-semibold ${hasRates ? "text-primary" : "text-white/30"}`}>
                {hasRates ? `R ${(totalCents / 100).toFixed(0)}/mo` : "No rates set"}
              </span>
            </div>
          </div>
          {/* Renewal date with days-remaining indicator */}
          {org.contractRenewalDate && (() => {
            const days = renewalDays(org.contractRenewalDate);
            const color = days != null && days < 0 ? "text-red-400" : days != null && days <= 14 ? "text-amber-400" : "text-white/50";
            return (
              <div className={`flex items-center justify-between text-xs pt-1 border-t border-white/5 ${color}`}>
                <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" />Renewal</span>
                <span className="font-medium">
                  {fmtDate(org.contractRenewalDate)}{" "}
                  <span className="opacity-70">
                    ({days != null && days < 0 ? `${Math.abs(days)}d overdue` : days != null ? `${days}d` : "—"})
                  </span>
                </span>
              </div>
            );
          })()}
          {/* Contract meta */}
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/35 pt-1 border-t border-white/5">
            {org.contractStartDate && <span>Start: {fmtDate(org.contractStartDate)}</span>}
            {org.storageLimitGb != null && <span>Storage limit: {org.storageLimitGb} GB</span>}
            {org.address && <span>{org.address}</span>}
            {org.phone && <span>{org.phone}</span>}
            {org.billingNotes && <span className="italic">"{org.billingNotes}"</span>}
          </div>
        </div>

        {/* Right: usage metrics */}
        <div className="rounded-lg border border-white/10 p-3 space-y-2" style={{ background: "rgba(0,0,0,0.3)" }}>
          <p className="text-white/50 text-xs font-semibold uppercase tracking-widest">Usage</p>
          {isLoading ? (
            <div className="flex items-center gap-2 text-white/30 text-xs">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading…
            </div>
          ) : usage ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><FileText className="h-3 w-3" />Incidents (total)</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-incidents-total-${org.id}`}>{usage.incidentsTotal.toLocaleString()}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><CalendarDays className="h-3 w-3" />This month</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-incidents-month-${org.id}`}>{usage.incidentsThisMonth.toLocaleString()}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><UserRound className="h-3 w-3" />Active (30d)</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-active-users-${org.id}`}>{usage.activeUsers30d} / {usage.userCounts.total}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><Paperclip className="h-3 w-3" />Attachments</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-attachments-${org.id}`}>{usage.attachmentCount.toLocaleString()}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><Activity className="h-3 w-3" />Storage</p>
                <p className="text-white/60 text-xs" data-testid={`text-archon-storage-${org.id}`}>
                  {usage.storageBytes > 0
                    ? usage.storageBytes >= 1_073_741_824
                      ? `${(usage.storageBytes / 1_073_741_824).toFixed(2)} GB`
                      : `${(usage.storageBytes / 1_048_576).toFixed(1)} MB`
                    : "Not tracked"}
                </p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><Activity className="h-3 w-3" />Last activity</p>
                <p className="text-white/70 text-xs">{usage.lastActivityAt ? fmtDate(usage.lastActivityAt) : "—"}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><Bell className="h-3 w-3" />Pushes this month</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-push-month-${org.id}`}>{usage.pushSentThisMonth.toLocaleString()}</p>
              </div>
              <div className="space-y-0.5">
                <p className="text-white/40 text-xs flex items-center gap-1"><Bell className="h-3 w-3" />Pushes total</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-push-total-${org.id}`}>
                  {usage.pushSentTotal.toLocaleString()}
                  <span className="text-white/40 font-normal ml-1 text-xs">{usage.pushSubscriberCount} device{usage.pushSubscriberCount !== 1 ? "s" : ""}</span>
                </p>
              </div>
              <div className="space-y-0.5 col-span-2">
                <p className="text-white/40 text-xs flex items-center gap-1"><MapPin className="h-3 w-3" />Geocoded incidents</p>
                <p className="text-white font-semibold text-sm" data-testid={`text-archon-geocoded-${org.id}`}>
                  {usage.geocodedIncidentCount.toLocaleString()}
                  <span className="text-white/40 font-normal ml-1 text-xs">of {usage.incidentsTotal.toLocaleString()} total</span>
                </p>
              </div>
            </div>
          ) : (
            <p className="text-white/30 text-xs">Failed to load usage data</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ArchonDashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // UI state
  const [expandedOrg, setExpandedOrg] = useState<string | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [editOrgTarget, setEditOrgTarget] = useState<ArchonOrg | null>(null);
  const [newAdminTarget, setNewAdminTarget] = useState<ArchonOrg | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ArchonUser | null>(null);
  const [deleteOrgTarget, setDeleteOrgTarget] = useState<ArchonOrg | null>(null);
  const [deleteOrgConfirmName, setDeleteOrgConfirmName] = useState("");
  const [passwordTarget, setPasswordTarget] = useState<ArchonUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [onboardingShare, setOnboardingShare] = useState<OnboardingUserInfo | null>(null);
  const [showOnboardingShare, setShowOnboardingShare] = useState(false);

  // Form state
  const [newClientForm, setNewClientForm] = useState<NewClientForm>(emptyNewClient());
  const [editContractForm, setEditContractForm] = useState<EditContractForm | null>(null);
  const [newAdminForm, setNewAdminForm] = useState({ firstName: "", lastName: "", email: "", password: "", role: "administrator" });

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: me, isLoading: meLoading, isFetching: meFetching } = useQuery<{ authed: boolean }>({
    queryKey: ["/api/archon/me"],
    retry: false,
  });

  useEffect(() => {
    if (!meLoading && !meFetching && me && !me.authed) navigate("/archon");
  }, [me, meLoading, meFetching]);

  const { data: orgs, isLoading: orgsLoading, refetch: refetchOrgs } = useQuery<ArchonOrg[]>({
    queryKey: ["/api/archon/orgs"],
    enabled: !!me?.authed,
  });

  const { data: allUsers, isLoading: usersLoading, refetch: refetchUsers } = useQuery<ArchonUser[]>({
    queryKey: ["/api/archon/users"],
    enabled: !!me?.authed,
  });

  const { data: summary, refetch: refetchSummary } = useQuery<ArchonSummary>({
    queryKey: ["/api/archon/summary"],
    enabled: !!me?.authed,
  });

  function refetchAll() { refetchOrgs(); refetchUsers(); refetchSummary(); }

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const logoutMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/archon/logout", {})).json(),
    onSuccess: () => { queryClient.clear(); navigate("/archon"); },
  });

  const newClientMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) =>
      (await apiRequest("POST", "/api/archon/orgs", body)).json(),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archon/users"] });
      const f = newClientForm;
      const title = data.welcomeEmailSent
        ? `Client "${data.org.name}" created — welcome email sent`
        : `Client "${data.org.name}" created`;
      toast({ title, description: data.welcomeEmailSent ? undefined : f.sendWelcomeEmail ? "Welcome email could not be sent (check SendGrid config)." : undefined });
      setOnboardingShare({
        firstName: f.adminFirstName,
        email: f.adminEmail.trim().toLowerCase(),
        password: f.adminPassword,
        orgName: data.org.name,
      });
      setShowOnboardingShare(true);
      setShowNewClient(false);
      setNewClientForm(emptyNewClient());
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const editContractMutation = useMutation({
    mutationFn: async ({ orgId, body }: { orgId: string; body: Record<string, unknown> }) =>
      (await apiRequest("PATCH", `/api/archon/orgs/${orgId}`, body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      toast({ title: "Contract updated" });
      setEditOrgTarget(null);
      setEditContractForm(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const suspendMutation = useMutation({
    mutationFn: async ({ orgId, subscriptionStatus }: { orgId: string; subscriptionStatus: string }) =>
      (await apiRequest("PATCH", `/api/archon/orgs/${orgId}`, { subscriptionStatus })).json(),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      toast({ title: vars.subscriptionStatus === "active" ? "Organisation reactivated" : "Organisation suspended" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const complimentaryMutation = useMutation({
    mutationFn: async ({ orgId, isComplimentary }: { orgId: string; isComplimentary: boolean }) =>
      (await apiRequest("PATCH", `/api/archon/orgs/${orgId}/complimentary`, { isComplimentary })).json(),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archon/users"] });
      toast({ title: vars.isComplimentary ? "Complimentary plan enabled" : "Complimentary plan removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const newAdminMutation = useMutation({
    mutationFn: async ({ orgId, body }: { orgId: string; body: Record<string, unknown> }) =>
      (await apiRequest("POST", `/api/archon/orgs/${orgId}/users`, body)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      toast({ title: "User added successfully" });
      const f = newAdminForm;
      setOnboardingShare({
        firstName: f.firstName,
        email: f.email.trim().toLowerCase(),
        password: f.password,
        orgName: newAdminTarget?.name ?? null,
      });
      setShowOnboardingShare(true);
      setNewAdminTarget(null);
      setNewAdminForm({ firstName: "", lastName: "", email: "", password: "", role: "administrator" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) =>
      (await apiRequest("PATCH", `/api/archon/users/${id}/status`, { isActive })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/users"] });
      toast({ title: "User status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/archon/users/${id}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      toast({ title: "User deleted" });
      setDeleteTarget(null);
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  const passwordMutation = useMutation({
    mutationFn: async ({ id, password }: { id: string; password: string }) =>
      (await apiRequest("PATCH", `/api/archon/users/${id}/password`, { password })).json(),
    onSuccess: () => {
      toast({ title: "Password updated" });
      if (passwordTarget) {
        setOnboardingShare({
          firstName: passwordTarget.firstName,
          email: passwordTarget.email,
          password: newPassword,
          orgName: passwordTarget.orgName,
        });
        setShowOnboardingShare(true);
      }
      setPasswordTarget(null);
      setNewPassword("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteOrgMutation = useMutation({
    mutationFn: async (orgId: string) => (await apiRequest("DELETE", `/api/archon/orgs/${orgId}`)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/archon/orgs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archon/users"] });
      queryClient.invalidateQueries({ queryKey: ["/api/archon/summary"] });
      toast({ title: "Organisation deleted" });
      setDeleteOrgTarget(null);
      setDeleteOrgConfirmName("");
    },
    onError: (e: any) => {
      toast({ title: "Error", description: e.message, variant: "destructive" });
      setDeleteOrgTarget(null);
      setDeleteOrgConfirmName("");
    },
  });

  // ─── Loading / auth states ─────────────────────────────────────────────────

  if (meLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "#0a0a0f" }}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!me?.authed) return null;

  // ─── Derived data ──────────────────────────────────────────────────────────

  const totalUsers = (orgs ?? []).reduce((s, o) => s + o.userCounts.total, 0);
  const totalIncidents = (orgs ?? []).reduce((s, o) => s + o.incidentCount, 0);
  const totalMRR = (orgs ?? []).reduce((s, o) => {
    const m = calcMonthly(o);
    return m != null ? s + m : s;
  }, 0);

  const usersByOrg = (allUsers ?? []).reduce<Record<string, ArchonUser[]>>((acc, u) => {
    (acc[u.organizationId] ??= []).push(u);
    return acc;
  }, {});

  // ─── Submit handlers ───────────────────────────────────────────────────────

  function handleNewClientSubmit(e: React.FormEvent) {
    e.preventDefault();
    const f = newClientForm;
    if (!f.orgName.trim()) return toast({ title: "Organisation name required", variant: "destructive" });
    if (!f.adminFirstName.trim() || !f.adminLastName.trim()) return toast({ title: "Technical administrator name required", variant: "destructive" });
    if (!f.adminEmail.trim()) return toast({ title: "Technical administrator email required", variant: "destructive" });
    if (f.adminPassword.length < 6) return toast({ title: "Password must be at least 6 characters", variant: "destructive" });

    newClientMutation.mutate({
      orgName: f.orgName,
      orgAddress: f.orgAddress,
      orgPhone: f.orgPhone,
      companyRegistrationNumber: f.companyRegistrationNumber || undefined,
      vatNumber: f.vatNumber || undefined,
      primaryContactFirstName: f.primaryContactFirstName || undefined,
      primaryContactLastName: f.primaryContactLastName || undefined,
      primaryContactEmail: f.primaryContactEmail || undefined,
      primaryContactPhone: f.primaryContactPhone || undefined,
      adminFirstName: f.adminFirstName,
      adminLastName: f.adminLastName,
      adminEmail: f.adminEmail,
      adminPassword: f.adminPassword,
      contractRef: f.contractRef || undefined,
      contractStartDate: f.contractStartDate || undefined,
      contractRenewalDate: f.contractRenewalDate || undefined,
      rateAdmin: f.rateAdmin !== "" ? Number(f.rateAdmin) : undefined,
      rateSupervisor: f.rateSupervisor !== "" ? Number(f.rateSupervisor) : undefined,
      rateReporter: f.rateReporter !== "" ? Number(f.rateReporter) : undefined,
      rateAccessController: f.rateAccessController !== "" ? Number(f.rateAccessController) : undefined,
      rateControlRoom: f.rateControlRoom !== "" ? Number(f.rateControlRoom) : undefined,
      ratePatrolUser: f.ratePatrolUser !== "" ? Number(f.ratePatrolUser) : undefined,
      storageLimitGb: f.storageLimitGb !== "" ? Number(f.storageLimitGb) : undefined,
      billingNotes: f.billingNotes || undefined,
      groups: f.groups.filter(g => g.trim() !== ""),
      sendWelcomeEmail: f.sendWelcomeEmail,
    });
  }

  function handleEditContractSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editOrgTarget || !editContractForm) return;
    const f = editContractForm;
    editContractMutation.mutate({
      orgId: editOrgTarget.id,
      body: {
        name: f.name,
        address: f.address,
        phone: f.phone,
        companyRegistrationNumber: f.companyRegistrationNumber || null,
        vatNumber: f.vatNumber || null,
        primaryContactFirstName: f.primaryContactFirstName || null,
        primaryContactLastName: f.primaryContactLastName || null,
        primaryContactEmail: f.primaryContactEmail || null,
        primaryContactPhone: f.primaryContactPhone || null,
        contractRef: f.contractRef || null,
        contractStartDate: f.contractStartDate || null,
        contractRenewalDate: f.contractRenewalDate || null,
        rateAdmin: f.rateAdmin !== "" ? Number(f.rateAdmin) : null,
        rateSupervisor: f.rateSupervisor !== "" ? Number(f.rateSupervisor) : null,
        rateReporter: f.rateReporter !== "" ? Number(f.rateReporter) : null,
        rateAccessController: f.rateAccessController !== "" ? Number(f.rateAccessController) : null,
        rateControlRoom: f.rateControlRoom !== "" ? Number(f.rateControlRoom) : null,
        ratePatrolUser: f.ratePatrolUser !== "" ? Number(f.ratePatrolUser) : null,
        storageLimitGb: f.storageLimitGb !== "" ? Number(f.storageLimitGb) : null,
        billingNotes: f.billingNotes || null,
      },
    });
  }

  function openEditContract(org: ArchonOrg) {
    setEditOrgTarget(org);
    setEditContractForm(orgToEditForm(org));
  }

  // ─── Shared input style ────────────────────────────────────────────────────

  const panelBg = { background: "rgba(10,10,15,0.95)", backdropFilter: "blur(20px)" };
  const inputStyle = "bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm";

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen relative" style={{ background: "#0a0a0f" }}>
      {/* Background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full opacity-8 blur-3xl" style={{ background: "radial-gradient(circle, #1a6b3c, transparent)" }} />
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "60px 60px" }} />
      </div>

      <div className="relative z-10 flex flex-col h-screen">
        {/* ── Header ── */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-white/10" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(12px)" }}>
          <div className="flex items-center gap-3">
            <div className="rounded-lg p-2 border border-primary/30" style={{ background: "rgba(26,107,60,0.15)" }}>
              <ShieldAlert className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white tracking-tight" data-testid="text-archon-dashboard-title">OMT Archon — System Administration</h1>
              <p className="text-xs text-white/40">IntelAfri super-admin panel</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-4 text-xs text-white/50 mr-2">
              <span data-testid="text-archon-org-count"><Building2 className="h-3.5 w-3.5 inline mr-1" />{summary ? `${summary.activeOrgCount}/${summary.totalOrgCount}` : (orgs ?? []).length} active</span>
              <span data-testid="text-archon-user-count"><Users className="h-3.5 w-3.5 inline mr-1" />{summary?.totalUsers ?? totalUsers} users</span>
              <span data-testid="text-archon-incident-count"><FileText className="h-3.5 w-3.5 inline mr-1" />{summary?.incidentsThisMonth ?? "—"} this month</span>
              {(summary?.estimatedMrrCents ?? totalMRR) > 0 && (
                <span data-testid="text-archon-mrr" className="text-primary font-medium">
                  <TrendingUp className="h-3.5 w-3.5 inline mr-1" />R {((summary?.estimatedMrrCents ?? totalMRR) / 100).toFixed(0)}/mo
                </span>
              )}
            </div>
            <Button
              className="bg-primary hover:bg-primary/90 text-white gap-1.5 h-8 text-sm"
              onClick={() => setShowNewClient(true)}
              data-testid="button-archon-new-client"
            >
              <Plus className="h-3.5 w-3.5" />
              New Client
            </Button>
            <Button variant="ghost" size="sm" className="text-white/60 hover:text-white gap-1.5" onClick={refetchAll} data-testid="button-archon-refresh">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="border-white/20 text-white/70 hover:text-white hover:bg-white/10 gap-1.5"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              data-testid="button-archon-logout"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </Button>
          </div>
        </header>

        {/* ── Main content ── */}
        <div className="flex-1 overflow-auto p-6">
          {(orgsLoading || usersLoading) ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !orgs || orgs.length === 0 ? (
            <div className="text-center py-20 text-white/40">
              <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>No clients yet. Click "New Client" to onboard one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {orgs.map((org) => {
                const isExpanded = expandedOrg === org.id;
                const monthly = calcMonthly(org);
                const days = renewalDays(org.contractRenewalDate);
                const orgUsers = usersByOrg[org.id] ?? [];
                const status = getOrgStatus(org);

                return (
                  <div key={org.id} className="rounded-xl border border-white/10 overflow-hidden" style={{ background: "rgba(0,0,0,0.4)" }}>
                    {/* Org row */}
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.03] transition-colors cursor-pointer" onClick={() => setExpandedOrg(isExpanded ? null : org.id)} data-testid={`row-archon-org-${org.id}`}>
                      <span className="text-white/40">
                        {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </span>

                      {/* Org name + ref */}
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate" data-testid={`text-archon-org-name-${org.id}`}>{org.name}</p>
                        {org.contractRef && <p className="text-white/40 text-xs font-mono">{org.contractRef}</p>}
                      </div>

                      {/* Status */}
                      <div className="w-24 flex-shrink-0">
                        <OrgStatusBadge org={org} />
                      </div>

                      {/* Users */}
                      <div className="w-20 flex-shrink-0 text-center">
                        <p className="text-white text-sm font-medium">{org.userCounts.total}</p>
                        <p className="text-white/40 text-xs">users</p>
                      </div>

                      {/* Monthly cost */}
                      <div className="w-28 flex-shrink-0 text-right">
                        {monthly != null ? (
                          <>
                            <p className="text-primary text-sm font-semibold">R {(monthly / 100).toFixed(0)}/mo</p>
                            <p className="text-white/30 text-xs">{org.incidentCount} incidents</p>
                          </>
                        ) : (
                          <p className="text-white/30 text-xs">No rates set</p>
                        )}
                      </div>

                      {/* Renewal */}
                      <div className="w-28 flex-shrink-0 text-right">
                        {org.contractRenewalDate ? (
                          <>
                            <p className={`text-xs font-medium ${days != null && days < 0 ? "text-red-400" : days != null && days <= 14 ? "text-amber-400" : "text-white/60"}`}>
                              {days != null && days < 0 ? `${Math.abs(days)}d overdue` : days != null ? `${days}d left` : "—"}
                            </p>
                            <p className="text-white/30 text-xs">{fmtDate(org.contractRenewalDate)}</p>
                          </>
                        ) : (
                          <p className="text-white/30 text-xs">No renewal</p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                        {/* Complimentary */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 w-7 p-0 ${org.isComplimentary ? "text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10" : "text-white/30 hover:text-emerald-400 hover:bg-emerald-400/10"}`}
                          onClick={() => complimentaryMutation.mutate({ orgId: org.id, isComplimentary: !org.isComplimentary })}
                          disabled={complimentaryMutation.isPending}
                          title={org.isComplimentary ? "Remove complimentary" : "Grant complimentary"}
                          data-testid={`button-archon-comp-${org.id}`}
                        >
                          <Gift className="h-3.5 w-3.5" />
                        </Button>

                        {/* Suspend / Reactivate — based on raw subscriptionStatus, not computed badge */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className={`h-7 w-7 p-0 ${org.subscriptionStatus === "active" ? "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-green-400 hover:text-green-300 hover:bg-green-400/10"}`}
                          onClick={() => suspendMutation.mutate({ orgId: org.id, subscriptionStatus: org.subscriptionStatus === "active" ? "expired" : "active" })}
                          disabled={suspendMutation.isPending}
                          title={org.subscriptionStatus === "active" ? "Suspend org" : "Reactivate org"}
                          data-testid={`button-archon-suspend-${org.id}`}
                        >
                          {org.subscriptionStatus === "active"
                            ? <ToggleRight className="h-3.5 w-3.5" />
                            : <ToggleLeft className="h-3.5 w-3.5" />}
                        </Button>

                        {/* Edit contract */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-sky-400 hover:text-sky-300 hover:bg-sky-400/10"
                          onClick={() => openEditContract(org)}
                          title="Edit contract"
                          data-testid={`button-archon-edit-${org.id}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>

                        {/* Add user to org */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-violet-400 hover:text-violet-300 hover:bg-violet-400/10"
                          onClick={() => {
                            const defaultRole = org.userCounts.administrator > 0 ? "control_room" : "administrator";
                            setNewAdminTarget(org);
                            setNewAdminForm({ firstName: "", lastName: "", email: "", password: "", role: defaultRole });
                          }}
                          title="Add user to org"
                          data-testid={`button-archon-adduser-${org.id}`}
                        >
                          <UserPlus className="h-3.5 w-3.5" />
                        </Button>

                        {/* Delete org */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0 text-red-500/50 hover:text-red-400 hover:bg-red-500/10"
                          onClick={() => { setDeleteOrgTarget(org); setDeleteOrgConfirmName(""); }}
                          title="Delete organisation"
                          data-testid={`button-archon-deleteorg-${org.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    {/* ── Expanded section ── */}
                    {isExpanded && (
                      <div className="border-t border-white/10" style={{ background: "rgba(255,255,255,0.02)" }}>
                        {/* Billing + usage panel */}
                        <OrgUsagePanel org={org} />


                        {orgUsers.length === 0 ? (
                          <p className="px-6 py-4 text-white/30 text-sm">No users</p>
                        ) : (
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-white/5">
                                <th className="text-left px-6 py-2 text-white/40 font-medium text-xs uppercase tracking-wide">Name</th>
                                <th className="text-left px-4 py-2 text-white/40 font-medium text-xs uppercase tracking-wide">Email</th>
                                <th className="text-left px-4 py-2 text-white/40 font-medium text-xs uppercase tracking-wide">Role</th>
                                <th className="text-left px-4 py-2 text-white/40 font-medium text-xs uppercase tracking-wide">Status</th>
                                <th className="text-left px-4 py-2 text-white/40 font-medium text-xs uppercase tracking-wide">Contact</th>
                                <th className="px-4 py-2"></th>
                              </tr>
                            </thead>
                            <tbody>
                              {orgUsers.map((user) => (
                                <tr key={user.id} className="border-b border-white/[0.03] hover:bg-white/[0.02]" data-testid={`row-archon-user-${user.id}`}>
                                  <td className="px-6 py-2 text-white text-sm" data-testid={`text-archon-name-${user.id}`}>{user.firstName} {user.lastName}</td>
                                  <td className="px-4 py-2 text-white/50 font-mono text-xs" data-testid={`text-archon-email-${user.id}`}>{user.email}</td>
                                  <td className="px-4 py-2" data-testid={`text-archon-role-${user.id}`}><RoleBadge role={user.role} /></td>
                                  <td className="px-4 py-2" data-testid={`text-archon-status-${user.id}`}><UserStatusBadge isActive={user.isActive} /></td>
                                  <td className="px-4 py-2 text-white/40 text-xs" data-testid={`text-archon-contact-${user.id}`}>{user.contactNumber ?? "—"}</td>
                                  <td className="px-4 py-2">
                                    <div className="flex items-center gap-1 justify-end">
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-primary hover:text-primary/80 hover:bg-primary/10"
                                        onClick={() => {
                                          setOnboardingShare({
                                            firstName: user.firstName,
                                            email: user.email,
                                            orgName: user.orgName,
                                          });
                                          setShowOnboardingShare(true);
                                        }}
                                        title="Send onboarding (install + login)" data-testid={`button-archon-onboard-${user.id}`}>
                                        <Share2 className="h-3 w-3" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-sky-400 hover:text-sky-300 hover:bg-sky-400/10"
                                        onClick={() => { setPasswordTarget(user); setNewPassword(""); }}
                                        title="Reset password" data-testid={`button-archon-password-${user.id}`}>
                                        <KeyRound className="h-3 w-3" />
                                      </Button>
                                      <Button variant="ghost" size="sm"
                                        className={`h-6 w-6 p-0 ${user.isActive ? "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-green-400 hover:text-green-300 hover:bg-green-400/10"}`}
                                        onClick={() => statusMutation.mutate({ id: user.id, isActive: !user.isActive })}
                                        disabled={statusMutation.isPending}
                                        title={user.isActive ? "Deactivate" : "Activate"} data-testid={`button-archon-toggle-${user.id}`}>
                                        {user.isActive ? <UserX className="h-3 w-3" /> : <UserCheck className="h-3 w-3" />}
                                      </Button>
                                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-red-400 hover:text-red-300 hover:bg-red-400/10"
                                        onClick={() => setDeleteTarget(user)}
                                        title="Delete user" data-testid={`button-archon-delete-${user.id}`}>
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── New Client Dialog ── */}
      <Dialog open={showNewClient} onOpenChange={(open) => { if (!open) { setShowNewClient(false); setNewClientForm(emptyNewClient()); } }}>
        <DialogContent className="border-white/20 sm:max-w-2xl max-h-[90vh] overflow-y-auto" style={panelBg}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Building2 className="h-4 w-4 text-primary" />
              New Client
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleNewClientSubmit} className="space-y-5">
            {/* Organisation */}
            <div className="space-y-2">
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Organisation</p>
              <FieldRow label="Name *">
                <Input className={inputCls()} placeholder="Acme Security" value={newClientForm.orgName} onChange={(e) => setNewClientForm(f => ({ ...f, orgName: e.target.value }))} data-testid="input-newclient-name" />
              </FieldRow>
              <FieldRow label="Address">
                <Input className={inputCls()} placeholder="123 Main St, Cape Town" value={newClientForm.orgAddress} onChange={(e) => setNewClientForm(f => ({ ...f, orgAddress: e.target.value }))} data-testid="input-newclient-address" />
              </FieldRow>
              <FieldRow label="Phone">
                <Input className={inputCls()} placeholder="+27 21 000 0000" value={newClientForm.orgPhone} onChange={(e) => setNewClientForm(f => ({ ...f, orgPhone: e.target.value }))} data-testid="input-newclient-phone" />
              </FieldRow>
              <FieldRow label="Company reg. no.">
                <Input className={inputCls()} placeholder="2020/123456/07" value={newClientForm.companyRegistrationNumber} onChange={(e) => setNewClientForm(f => ({ ...f, companyRegistrationNumber: e.target.value }))} data-testid="input-newclient-company-reg" />
              </FieldRow>
              <FieldRow label="VAT number">
                <Input className={inputCls()} placeholder="4123456789" value={newClientForm.vatNumber} onChange={(e) => setNewClientForm(f => ({ ...f, vatNumber: e.target.value }))} data-testid="input-newclient-vat" />
              </FieldRow>
            </div>

            {/* Primary contact (billing / commercial) */}
            <div className="space-y-2">
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Primary Contact</p>
              <p className="text-white/40 text-xs">Billing and commercial contact — may differ from the technical administrator.</p>
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="First name">
                  <Input className={inputCls()} placeholder="John" value={newClientForm.primaryContactFirstName} onChange={(e) => setNewClientForm(f => ({ ...f, primaryContactFirstName: e.target.value }))} data-testid="input-newclient-pc-firstname" />
                </FieldRow>
                <FieldRow label="Last name">
                  <Input className={inputCls()} placeholder="Doe" value={newClientForm.primaryContactLastName} onChange={(e) => setNewClientForm(f => ({ ...f, primaryContactLastName: e.target.value }))} data-testid="input-newclient-pc-lastname" />
                </FieldRow>
              </div>
              <FieldRow label="Email">
                <Input className={inputCls()} type="email" placeholder="billing@acme.co.za" value={newClientForm.primaryContactEmail} onChange={(e) => setNewClientForm(f => ({ ...f, primaryContactEmail: e.target.value }))} data-testid="input-newclient-pc-email" />
              </FieldRow>
              <FieldRow label="Phone">
                <Input className={inputCls()} placeholder="+27 21 000 0000" value={newClientForm.primaryContactPhone} onChange={(e) => setNewClientForm(f => ({ ...f, primaryContactPhone: e.target.value }))} data-testid="input-newclient-pc-phone" />
              </FieldRow>
            </div>

            {/* Technical administrator */}
            <div className="space-y-2">
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Technical Administrator</p>
              <p className="text-white/40 text-xs">Login account for system setup. Only one administrator per organisation.</p>
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="First name *">
                  <Input className={inputCls()} placeholder="Jane" value={newClientForm.adminFirstName} onChange={(e) => setNewClientForm(f => ({ ...f, adminFirstName: e.target.value }))} data-testid="input-newclient-firstname" />
                </FieldRow>
                <FieldRow label="Last name *">
                  <Input className={inputCls()} placeholder="Smith" value={newClientForm.adminLastName} onChange={(e) => setNewClientForm(f => ({ ...f, adminLastName: e.target.value }))} data-testid="input-newclient-lastname" />
                </FieldRow>
              </div>
              <FieldRow label="Email *">
                <Input className={inputCls()} type="email" placeholder="jane@acme.co.za" value={newClientForm.adminEmail} onChange={(e) => setNewClientForm(f => ({ ...f, adminEmail: e.target.value }))} data-testid="input-newclient-email" />
              </FieldRow>
              <FieldRow label="Password *">
                <Input className={inputCls()} type="password" placeholder="Min. 6 characters" value={newClientForm.adminPassword} onChange={(e) => setNewClientForm(f => ({ ...f, adminPassword: e.target.value }))} data-testid="input-newclient-password" />
              </FieldRow>
              <label className="flex items-center gap-2 pt-1 cursor-pointer">
                <Checkbox
                  checked={newClientForm.sendWelcomeEmail}
                  onCheckedChange={(v) => setNewClientForm(f => ({ ...f, sendWelcomeEmail: v === true }))}
                  data-testid="checkbox-newclient-welcome-email"
                />
                <span className="text-white/70 text-sm">Send welcome email + quick start guide</span>
              </label>
            </div>

            {/* Contract */}
            <div className="space-y-2">
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Contract</p>
              <FieldRow label="Contract ref">
                <Input className={inputCls()} placeholder="OMT-2026-001" value={newClientForm.contractRef} onChange={(e) => setNewClientForm(f => ({ ...f, contractRef: e.target.value }))} data-testid="input-newclient-ref" />
              </FieldRow>
              <div className="grid grid-cols-2 gap-2">
                <FieldRow label="Start date">
                  <Input className={inputCls()} type="date" value={newClientForm.contractStartDate} onChange={(e) => setNewClientForm(f => ({ ...f, contractStartDate: e.target.value }))} data-testid="input-newclient-startdate" />
                </FieldRow>
                <FieldRow label="Renewal date">
                  <Input className={inputCls()} type="date" value={newClientForm.contractRenewalDate} onChange={(e) => setNewClientForm(f => ({ ...f, contractRenewalDate: e.target.value }))} data-testid="input-newclient-renewaldate" />
                </FieldRow>
              </div>
            </div>

            {/* Groups */}
            <div className="space-y-2">
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Groups</p>
              <p className="text-white/40 text-xs"><strong className="text-white/60">Central / Head Office</strong> is created automatically. Add additional groups below (optional).</p>
              {newClientForm.groups.map((g, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    className={inputCls("flex-1")}
                    placeholder={`e.g. Alpha Group`}
                    value={g}
                    onChange={(e) => setNewClientForm(f => {
                      const groups = [...f.groups];
                      groups[i] = e.target.value;
                      return { ...f, groups };
                    })}
                    data-testid={`input-newclient-group-${i}`}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-white/40 hover:text-red-400 hover:bg-red-400/10 h-8 w-8"
                    onClick={() => setNewClientForm(f => ({ ...f, groups: f.groups.filter((_, j) => j !== i) }))}
                    data-testid={`button-newclient-remove-group-${i}`}
                  >
                    <Plus className="h-4 w-4 rotate-45" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-white/50 hover:text-white hover:bg-white/10 gap-1.5 h-7 text-xs"
                onClick={() => setNewClientForm(f => ({ ...f, groups: [...f.groups, ""] }))}
                data-testid="button-newclient-add-group"
              >
                <Plus className="h-3 w-3" /> Add Group
              </Button>
            </div>

            {/* Rates */}
            <div className="space-y-2">
              <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Monthly rates (ZAR)</p>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label className="text-white/50 text-xs mb-1 block">Administrator</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">R</span>
                    <Input className={inputCls("flex-1")} type="number" min="0" step="1" placeholder="300" value={newClientForm.rateAdmin} onChange={(e) => setNewClientForm(f => ({ ...f, rateAdmin: e.target.value }))} data-testid="input-newclient-rate-admin" />
                  </div>
                </div>
                <div>
                  <Label className="text-white/50 text-xs mb-1 block">Supervisor</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">R</span>
                    <Input className={inputCls("flex-1")} type="number" min="0" step="1" placeholder="200" value={newClientForm.rateSupervisor} onChange={(e) => setNewClientForm(f => ({ ...f, rateSupervisor: e.target.value }))} data-testid="input-newclient-rate-supervisor" />
                  </div>
                </div>
                <div>
                  <Label className="text-white/50 text-xs mb-1 block">Access controller</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">R</span>
                    <Input className={inputCls("flex-1")} type="number" min="0" step="1" placeholder="75" value={newClientForm.rateAccessController} onChange={(e) => setNewClientForm(f => ({ ...f, rateAccessController: e.target.value }))} data-testid="input-newclient-rate-access-controller" />
                  </div>
                </div>
                <div>
                  <Label className="text-white/50 text-xs mb-1 block">Reporter</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">R</span>
                    <Input className={inputCls("flex-1")} type="number" min="0" step="1" placeholder="50" value={newClientForm.rateReporter} onChange={(e) => setNewClientForm(f => ({ ...f, rateReporter: e.target.value }))} data-testid="input-newclient-rate-reporter" />
                  </div>
                </div>
                <div>
                  <Label className="text-white/50 text-xs mb-1 block">Control room</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">R</span>
                    <Input className={inputCls("flex-1")} type="number" min="0" step="1" placeholder="100" value={newClientForm.rateControlRoom} onChange={(e) => setNewClientForm(f => ({ ...f, rateControlRoom: e.target.value }))} data-testid="input-newclient-rate-control-room" />
                  </div>
                </div>
                <div>
                  <Label className="text-white/50 text-xs mb-1 block">Patroller</Label>
                  <div className="flex items-center gap-1">
                    <span className="text-white/40 text-sm">R</span>
                    <Input className={inputCls("flex-1")} type="number" min="0" step="1" placeholder="100" value={newClientForm.ratePatrolUser} onChange={(e) => setNewClientForm(f => ({ ...f, ratePatrolUser: e.target.value }))} data-testid="input-newclient-rate-patroller" />
                  </div>
                </div>
              </div>
              <FieldRow label="Storage limit (GB)">
                <Input className={inputCls()} type="number" min="0" step="1" placeholder="50" value={newClientForm.storageLimitGb} onChange={(e) => setNewClientForm(f => ({ ...f, storageLimitGb: e.target.value }))} data-testid="input-newclient-storage" />
              </FieldRow>
              <FieldRow label="Billing notes">
                <Textarea className="bg-white/5 border-white/20 text-white placeholder:text-white/30 text-sm min-h-16 resize-none" placeholder="Any special terms or notes..." value={newClientForm.billingNotes} onChange={(e) => setNewClientForm(f => ({ ...f, billingNotes: e.target.value }))} data-testid="input-newclient-notes" />
              </FieldRow>
            </div>

            <DialogFooter>
              <Button type="button" variant="ghost" className="text-white/60 hover:text-white hover:bg-white/10" onClick={() => { setShowNewClient(false); setNewClientForm(emptyNewClient()); }} data-testid="button-newclient-cancel">
                Cancel
              </Button>
              <Button type="submit" className="bg-primary hover:bg-primary/90 text-white" disabled={newClientMutation.isPending} data-testid="button-newclient-submit">
                {newClientMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create Client"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Contract Dialog ── */}
      <Dialog open={!!editOrgTarget} onOpenChange={(open) => { if (!open) { setEditOrgTarget(null); setEditContractForm(null); } }}>
        <DialogContent className="border-white/20 sm:max-w-xl max-h-[90vh] overflow-y-auto" style={panelBg}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <Pencil className="h-4 w-4 text-sky-400" />
              Edit — {editOrgTarget?.name}
            </DialogTitle>
          </DialogHeader>

          {editContractForm && (
            <form onSubmit={handleEditContractSubmit} className="space-y-4">
              <div className="space-y-2">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Organisation</p>
                <FieldRow label="Name">
                  <Input className={inputStyle} value={editContractForm.name} onChange={(e) => setEditContractForm(f => f && ({ ...f, name: e.target.value }))} data-testid="input-editcontract-name" />
                </FieldRow>
                <FieldRow label="Address">
                  <Input className={inputStyle} value={editContractForm.address} onChange={(e) => setEditContractForm(f => f && ({ ...f, address: e.target.value }))} data-testid="input-editcontract-address" />
                </FieldRow>
                <FieldRow label="Phone">
                  <Input className={inputStyle} value={editContractForm.phone} onChange={(e) => setEditContractForm(f => f && ({ ...f, phone: e.target.value }))} data-testid="input-editcontract-phone" />
                </FieldRow>
                <FieldRow label="Company reg. no.">
                  <Input className={inputStyle} value={editContractForm.companyRegistrationNumber} onChange={(e) => setEditContractForm(f => f && ({ ...f, companyRegistrationNumber: e.target.value }))} data-testid="input-editcontract-company-reg" />
                </FieldRow>
                <FieldRow label="VAT number">
                  <Input className={inputStyle} value={editContractForm.vatNumber} onChange={(e) => setEditContractForm(f => f && ({ ...f, vatNumber: e.target.value }))} data-testid="input-editcontract-vat" />
                </FieldRow>
              </div>

              <div className="space-y-2">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Primary Contact</p>
                <div className="grid grid-cols-2 gap-2">
                  <FieldRow label="First name">
                    <Input className={inputStyle} value={editContractForm.primaryContactFirstName} onChange={(e) => setEditContractForm(f => f && ({ ...f, primaryContactFirstName: e.target.value }))} data-testid="input-editcontract-pc-firstname" />
                  </FieldRow>
                  <FieldRow label="Last name">
                    <Input className={inputStyle} value={editContractForm.primaryContactLastName} onChange={(e) => setEditContractForm(f => f && ({ ...f, primaryContactLastName: e.target.value }))} data-testid="input-editcontract-pc-lastname" />
                  </FieldRow>
                </div>
                <FieldRow label="Email">
                  <Input className={inputStyle} type="email" value={editContractForm.primaryContactEmail} onChange={(e) => setEditContractForm(f => f && ({ ...f, primaryContactEmail: e.target.value }))} data-testid="input-editcontract-pc-email" />
                </FieldRow>
                <FieldRow label="Phone">
                  <Input className={inputStyle} value={editContractForm.primaryContactPhone} onChange={(e) => setEditContractForm(f => f && ({ ...f, primaryContactPhone: e.target.value }))} data-testid="input-editcontract-pc-phone" />
                </FieldRow>
              </div>

              <div className="space-y-2">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Contract</p>
                <FieldRow label="Contract ref">
                  <Input className={inputStyle} placeholder="OMT-2026-001" value={editContractForm.contractRef} onChange={(e) => setEditContractForm(f => f && ({ ...f, contractRef: e.target.value }))} data-testid="input-editcontract-ref" />
                </FieldRow>
                <div className="grid grid-cols-2 gap-2">
                  <FieldRow label="Start date">
                    <Input className={inputStyle} type="date" value={editContractForm.contractStartDate} onChange={(e) => setEditContractForm(f => f && ({ ...f, contractStartDate: e.target.value }))} data-testid="input-editcontract-startdate" />
                  </FieldRow>
                  <FieldRow label="Renewal date">
                    <Input className={inputStyle} type="date" value={editContractForm.contractRenewalDate} onChange={(e) => setEditContractForm(f => f && ({ ...f, contractRenewalDate: e.target.value }))} data-testid="input-editcontract-renewaldate" />
                  </FieldRow>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-white/60 text-xs font-semibold uppercase tracking-widest border-b border-white/10 pb-1">Monthly rates (ZAR)</p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    ["rateAdmin", "Administrator"],
                    ["rateSupervisor", "Supervisor"],
                    ["rateAccessController", "Access controller"],
                    ["rateReporter", "Reporter"],
                    ["rateControlRoom", "Control room"],
                    ["ratePatrolUser", "Patroller"],
                  ] as const).map(([key, label]) => (
                    <div key={key}>
                      <Label className="text-white/50 text-xs mb-1 block">{label}</Label>
                      <div className="flex items-center gap-1">
                        <span className="text-white/40 text-sm">R</span>
                        <Input className="bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm flex-1" type="number" min="0" step="1" value={editContractForm[key]} onChange={(e) => setEditContractForm(f => f && ({ ...f, [key]: e.target.value }))} data-testid={`input-editcontract-${key}`} />
                      </div>
                    </div>
                  ))}
                </div>
                <FieldRow label="Storage (GB)">
                  <Input className={inputStyle} type="number" min="0" step="1" value={editContractForm.storageLimitGb} onChange={(e) => setEditContractForm(f => f && ({ ...f, storageLimitGb: e.target.value }))} data-testid="input-editcontract-storage" />
                </FieldRow>
                <FieldRow label="Billing notes">
                  <Textarea className="bg-white/5 border-white/20 text-white placeholder:text-white/30 text-sm min-h-16 resize-none" value={editContractForm.billingNotes} onChange={(e) => setEditContractForm(f => f && ({ ...f, billingNotes: e.target.value }))} data-testid="input-editcontract-notes" />
                </FieldRow>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" className="text-white/60 hover:text-white hover:bg-white/10" onClick={() => { setEditOrgTarget(null); setEditContractForm(null); }} data-testid="button-editcontract-cancel">
                  Cancel
                </Button>
                <Button type="submit" className="bg-sky-600 hover:bg-sky-500 text-white" disabled={editContractMutation.isPending} data-testid="button-editcontract-submit">
                  {editContractMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save Changes"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Add User to Org Dialog ── */}
      <Dialog open={!!newAdminTarget} onOpenChange={(open) => { if (!open) { setNewAdminTarget(null); setNewAdminForm({ firstName: "", lastName: "", email: "", password: "", role: "administrator" }); } }}>
        <DialogContent className="border-white/20 sm:max-w-md" style={panelBg}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-violet-400" />
              Add User — {newAdminTarget?.name}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (!newAdminTarget) return;
            const f = newAdminForm;
            if (!f.firstName.trim() || !f.lastName.trim()) return toast({ title: "Name required", variant: "destructive" });
            if (!f.email.trim()) return toast({ title: "Email required", variant: "destructive" });
            if (f.password.length < 6) return toast({ title: "Password must be at least 6 characters", variant: "destructive" });
            newAdminMutation.mutate({ orgId: newAdminTarget.id, body: { firstName: f.firstName, lastName: f.lastName, email: f.email, password: f.password, role: f.role } });
          }} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-white/50 text-xs mb-1 block">First name *</Label>
                <Input className="bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm" placeholder="Jane" value={newAdminForm.firstName} onChange={(e) => setNewAdminForm(f => ({ ...f, firstName: e.target.value }))} data-testid="input-newuser-firstname" />
              </div>
              <div>
                <Label className="text-white/50 text-xs mb-1 block">Last name *</Label>
                <Input className="bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm" placeholder="Smith" value={newAdminForm.lastName} onChange={(e) => setNewAdminForm(f => ({ ...f, lastName: e.target.value }))} data-testid="input-newuser-lastname" />
              </div>
            </div>
            <div>
              <Label className="text-white/50 text-xs mb-1 block">Email *</Label>
              <Input className="bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm" type="email" placeholder="jane@client.co.za" value={newAdminForm.email} onChange={(e) => setNewAdminForm(f => ({ ...f, email: e.target.value }))} data-testid="input-newuser-email" />
            </div>
            <div>
              <Label className="text-white/50 text-xs mb-1 block">Password *</Label>
              <Input className="bg-white/5 border-white/20 text-white placeholder:text-white/30 h-8 text-sm" type="password" placeholder="Min. 6 characters" value={newAdminForm.password} onChange={(e) => setNewAdminForm(f => ({ ...f, password: e.target.value }))} data-testid="input-newuser-password" />
            </div>
            <div>
              <Label className="text-white/50 text-xs mb-1 block">Role</Label>
              <Select value={newAdminForm.role} onValueChange={(v) => setNewAdminForm(f => ({ ...f, role: v }))}>
                <SelectTrigger className="bg-white/5 border-white/20 text-white h-8 text-sm" data-testid="select-newuser-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(!newAdminTarget || newAdminTarget.userCounts.administrator === 0) && (
                    <SelectItem value="administrator">Administrator</SelectItem>
                  )}
                  <SelectItem value="control_room">Control Room</SelectItem>
                  <SelectItem value="supervisor">Supervisor (legacy)</SelectItem>
                  <SelectItem value="access_controller">Access Controller</SelectItem>
                  <SelectItem value="patrol_user">Patrol User</SelectItem>
                  <SelectItem value="reporter">Reporter</SelectItem>
                </SelectContent>
              </Select>
              {newAdminTarget && newAdminTarget.userCounts.administrator > 0 && (
                <p className="text-white/40 text-xs mt-1">This organisation already has an administrator.</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" className="text-white/60 hover:text-white hover:bg-white/10" onClick={() => setNewAdminTarget(null)} data-testid="button-newuser-cancel">
                Cancel
              </Button>
              <Button type="submit" className="bg-violet-600 hover:bg-violet-500 text-white" disabled={newAdminMutation.isPending} data-testid="button-newuser-submit">
                {newAdminMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Password Reset Dialog ── */}
      <Dialog open={!!passwordTarget} onOpenChange={(open) => { if (!open) { setPasswordTarget(null); setNewPassword(""); } }}>
        <DialogContent className="border-white/20 sm:max-w-sm" style={panelBg}>
          <DialogHeader>
            <DialogTitle className="text-white flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-sky-400" />
              Reset Password
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-white/60">
            Setting new password for <strong className="text-white">{passwordTarget?.firstName} {passwordTarget?.lastName}</strong>
          </p>
          <Input
            type="password"
            placeholder="New password (min. 6 characters)"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            data-testid="input-archon-new-password"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newPassword.length >= 6 && passwordTarget) {
                passwordMutation.mutate({ id: passwordTarget.id, password: newPassword });
              }
            }}
          />
          <DialogFooter>
            <Button variant="ghost" className="text-white/60 hover:text-white hover:bg-white/10" onClick={() => { setPasswordTarget(null); setNewPassword(""); }} data-testid="button-archon-password-cancel">
              Cancel
            </Button>
            <Button
              className="bg-sky-600 hover:bg-sky-500 text-white"
              disabled={newPassword.length < 6 || passwordMutation.isPending}
              onClick={() => passwordTarget && passwordMutation.mutate({ id: passwordTarget.id, password: newPassword })}
              data-testid="button-archon-password-confirm"
            >
              {passwordMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Organisation Confirmation ── */}
      <AlertDialog open={!!deleteOrgTarget} onOpenChange={(open) => { if (!open) { setDeleteOrgTarget(null); setDeleteOrgConfirmName(""); } }}>
        <AlertDialogContent className="border-white/20" style={panelBg}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white flex items-center gap-2">
              <Trash2 className="h-4 w-4 text-red-400" />
              Delete organisation?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-white/60 space-y-2">
              <span>
                This will permanently delete <strong className="text-white">{deleteOrgTarget?.name}</strong> and
                ALL its data — users, incidents, categories, locations, attachments, and billing records.
                This cannot be undone.
              </span>
              <span className="block pt-2">Type the organisation name to confirm:</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            className="bg-white/5 border-white/20 text-white placeholder:text-white/30"
            placeholder={deleteOrgTarget?.name ?? ""}
            value={deleteOrgConfirmName}
            onChange={(e) => setDeleteOrgConfirmName(e.target.value)}
            data-testid="input-archon-deleteorg-confirm"
          />
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 text-white/70 hover:bg-white/10" data-testid="button-archon-deleteorg-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteOrgTarget && deleteOrgMutation.mutate(deleteOrgTarget.id)}
              disabled={deleteOrgConfirmName !== deleteOrgTarget?.name || deleteOrgMutation.isPending}
              data-testid="button-archon-deleteorg-confirm"
            >
              {deleteOrgMutation.isPending ? "Deleting…" : "Delete Organisation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete User Confirmation ── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent className="border-white/20" style={panelBg}>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">Delete user?</AlertDialogTitle>
            <AlertDialogDescription className="text-white/60">
              Permanently delete <strong className="text-white">{deleteTarget?.firstName} {deleteTarget?.lastName}</strong> ({deleteTarget?.email})? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/20 text-white/70 hover:bg-white/10" data-testid="button-archon-delete-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
              data-testid="button-archon-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting..." : "Delete User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ArchonOnboardingShare
        open={showOnboardingShare}
        onOpenChange={setShowOnboardingShare}
        user={onboardingShare}
        panelBg={panelBg}
      />
    </div>
  );
}
