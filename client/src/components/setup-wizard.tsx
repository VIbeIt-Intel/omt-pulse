import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Plus, Trash2, Check, Users, Layers, ChevronRight, AlertTriangle, Loader2, Copy, CheckCheck, Link2, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type AuthUser = {
  id: string;
  firstName: string;
  role: string;
  isSuperadmin?: boolean;
  orgName?: string | null;
};

type OrgCommand = { id: number; name: string; isCentral: boolean; memberCount?: number };
type UsersResp = Array<{ id: string; firstName: string; lastName: string; email: string; role: string }>;

// ─── localStorage key — only controls auto-open suppression, NOT the banner ────
const SKIP_AUTO_OPEN_KEY = "omt_setup_skipped";

function isAutoOpenSuppressed(): boolean {
  try { return localStorage.getItem(SKIP_AUTO_OPEN_KEY) === "1"; } catch { return false; }
}
function suppressAutoOpen() {
  try { localStorage.setItem(SKIP_AUTO_OPEN_KEY, "1"); } catch {}
}

/**
 * Setup is "genuinely complete" only when at least one NON-central group
 * has at least one member. This is the condition that hides the banner.
 */
function isSetupComplete(commands: OrgCommand[]): boolean {
  return commands.some(c => !c.isCentral && (c.memberCount ?? 0) > 0);
}

/**
 * First-login condition that triggers auto-open:
 * org has only Central Group (no non-central groups) AND no other users besides self.
 */
function isFirstLoginState(commands: OrgCommand[], users: UsersResp, selfId: string): boolean {
  const hasNonCentral = commands.some(c => !c.isCentral);
  const hasOtherUsers = users.some(u => u.id !== selfId);
  return !hasNonCentral && !hasOtherUsers;
}

// ─── Inline share card shown after each successful invite ───────────────────

type InviteCard = { firstName: string; email: string; inviteToken?: string | null; groupName?: string };

function WizardShareCard({ card, orgName, onDismiss }: { card: InviteCard; orgName: string; onDismiss: () => void }) {
  const [copiedLink, setCopiedLink] = useState(false);
  const appUrl = import.meta.env.VITE_APP_BASE_URL || window.location.origin;
  const inviteUrl = card.inviteToken ? `${appUrl}/invite?token=${card.inviteToken}` : null;
  const groupLine = card.groupName ? `\n  Group: ${card.groupName}` : "";
  const message = inviteUrl
    ? `Hi ${card.firstName} 👋\n\nYou've been added to ${orgName}'s OMT Pulse team${card.groupName ? ` (${card.groupName})` : ""}. Tap the link below to create your password and get started — it expires in 7 days.\n\n${inviteUrl}\n\nSee you on the ground. 🛡️`
    : `Hi ${card.firstName} 👋\n\nYou've been added to ${orgName}'s OMT Pulse team.\n\nOpen the app here: ${appUrl}\n  Email: ${card.email}${groupLine}\n\nYour administrator will share your password separately.\n\nSee you on the ground. 🛡️`;

  function handleWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }

  function handleCopyLink() {
    if (!inviteUrl) return;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2500);
    });
  }

  return (
    <div className="rounded-lg border bg-primary/5 border-primary/20 p-3 space-y-2.5" data-testid={`card-invite-${card.email}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <Check className="h-3.5 w-3.5 text-primary" />
          <span>{card.firstName} invited</span>
        </div>
        <button
          className="text-muted-foreground hover:text-foreground transition-colors"
          onClick={onDismiss}
          data-testid={`button-dismiss-invite-card-${card.email}`}
        ><X className="h-3.5 w-3.5" /></button>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          className="flex-1 h-8 bg-[#25d366] hover:bg-[#1ebe5d] text-white font-medium gap-1.5 text-xs"
          onClick={handleWhatsApp}
          data-testid={`button-whatsapp-${card.email}`}
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-white shrink-0" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Send via WhatsApp
        </Button>
        {inviteUrl && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={handleCopyLink}
            data-testid={`button-copy-link-${card.email}`}
          >
            {copiedLink ? <CheckCheck className="h-3.5 w-3.5 text-green-600" /> : <Link2 className="h-3.5 w-3.5" />}
            {copiedLink ? "Copied" : "Copy link"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Banner ─────────────────────────────────────────────────────────────────────
// Always visible to admins until setup is complete — NOT hidden by skip flag.

export function SetupBanner({ onOpenWizard }: { onOpenWizard: () => void }) {
  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: allCommands = [] } = useQuery<OrgCommand[]>({ queryKey: ["/api/commands"] });

  if (!me) return null;
  if (me.role !== "administrator" && !me.isSuperadmin) return null;
  if (allCommands.length === 0) return null;
  if (isSetupComplete(allCommands)) return null;

  const nonCentral = allCommands.filter(c => !c.isCentral);
  const needsGroups = nonCentral.length === 0;
  const needsMembers = !needsGroups && nonCentral.every(c => (c.memberCount ?? 0) === 0);

  return (
    <div
      className="shrink-0 bg-amber-500/10 border-b border-amber-500/25 px-4 py-2 flex items-center justify-between gap-3 text-sm"
      data-testid="banner-setup"
    >
      <div className="flex items-center gap-2 min-w-0">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        <span className="text-amber-600 dark:text-amber-400 truncate">
          {needsGroups
            ? "Your organisation has no Groups yet — set them up to get started."
            : needsMembers
            ? "Your Groups have no members yet — invite your team to get started."
            : "Organisation setup is incomplete — finish setting up your Groups."}
        </span>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs text-amber-600 dark:text-amber-400 hover:bg-amber-500/10 shrink-0"
        onClick={onOpenWizard}
        data-testid="button-banner-setup"
      >
        Set up now <ChevronRight className="h-3 w-3 ml-1" />
      </Button>
    </div>
  );
}

// ─── Wizard dialog ───────────────────────────────────────────────────────────────

export function SetupWizard({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: allCommands = [], refetch: refetchCommands } = useQuery<OrgCommand[]>({ queryKey: ["/api/commands"] });

  const [step, setStep] = useState<1 | 2>(1);

  // Step 1 — Groups
  const [groupInputs, setGroupInputs] = useState<string[]>([""]);
  const [creatingGroups, setCreatingGroups] = useState(false);
  const [createdGroupIds, setCreatedGroupIds] = useState<number[]>([]);

  // Step 2 — Users (invite flow)
  const [newUser, setNewUser] = useState({ firstName: "", lastName: "", email: "", role: "reporter", commandId: "" });
  const [inviteCards, setInviteCards] = useState<InviteCard[]>([]);
  const [finishWarning, setFinishWarning] = useState(false);

  const nonCentralGroups = allCommands.filter(c => !c.isCentral);
  const orgName = me?.orgName ?? "your organisation";

  const inviteMutation = useMutation({
    mutationFn: (body: { firstName: string; lastName: string; email: string; role: string; commandIds: number[] }) =>
      apiRequest("POST", "/api/users", body),
    onSuccess: async (res, vars) => {
      qc.invalidateQueries({ queryKey: ["/api/users"] });
      qc.invalidateQueries({ queryKey: ["/api/commands"] });
      const created = await res.json().catch(() => ({}));
      const groupName = vars.commandIds.length > 0
        ? allCommands.find(c => c.id === vars.commandIds[0])?.name
        : undefined;
      setInviteCards(prev => [...prev, {
        firstName: vars.firstName,
        email: vars.email,
        inviteToken: created?.inviteToken ?? null,
        groupName,
      }]);
      setNewUser(u => ({ ...u, firstName: "", lastName: "", email: "" }));
      setFinishWarning(false);
    },
    onError: (err: Error) => toast({ title: "Could not invite user", description: err.message, variant: "destructive" }),
  });

  async function handleCreateGroups() {
    const names = groupInputs.map(g => g.trim()).filter(Boolean);
    if (names.length === 0) { setStep(2); return; }

    setCreatingGroups(true);
    const newIds: number[] = [];
    for (const name of names) {
      try {
        const res = await apiRequest("POST", "/api/commands", { name });
        const created = await res.json();
        if (created?.id) newIds.push(created.id);
      } catch (e: any) {
        toast({ title: `Could not create "${name}"`, description: e.message, variant: "destructive" });
      }
    }
    setCreatingGroups(false);
    setCreatedGroupIds(newIds);
    await refetchCommands();
    if (newIds.length > 0) {
      toast({ title: `${newIds.length} Group${newIds.length > 1 ? "s" : ""} created` });
    }
    setStep(2);
  }

  function handleInviteUser(e: React.FormEvent) {
    e.preventDefault();
    if (!newUser.firstName.trim() || !newUser.lastName.trim()) return toast({ title: "Name required", variant: "destructive" });
    if (!newUser.email.trim()) return toast({ title: "Email required", variant: "destructive" });
    if (nonCentralGroups.length > 0 && !newUser.commandId) return toast({ title: "Select a Group", variant: "destructive" });

    let commandIds: number[];
    if (nonCentralGroups.length > 0) {
      commandIds = [Number(newUser.commandId)];
    } else {
      const central = allCommands.find(c => c.isCentral);
      commandIds = central ? [central.id] : allCommands.slice(0, 1).map(c => c.id);
    }

    inviteMutation.mutate({
      firstName: newUser.firstName,
      lastName: newUser.lastName,
      email: newUser.email,
      role: newUser.role,
      commandIds,
    });
  }

  function handleFinish() {
    // Guard: warn if the user has started typing but hasn't sent the invite
    const hasUnsaved = newUser.firstName.trim() !== "" || newUser.email.trim() !== "";
    if (hasUnsaved) {
      setFinishWarning(true);
      return;
    }
    qc.invalidateQueries({ queryKey: ["/api/commands"] });
    qc.invalidateQueries({ queryKey: ["/api/users"] });
    onClose();
  }

  // Pre-select first newly-created group when entering step 2
  useEffect(() => {
    if (step === 2 && !newUser.commandId && nonCentralGroups.length > 0) {
      const firstNew = nonCentralGroups.find(c => createdGroupIds.includes(c.id));
      const chosen = firstNew ?? nonCentralGroups[0];
      if (chosen) setNewUser(u => ({ ...u, commandId: String(chosen.id) }));
    }
  }, [step, allCommands]);

  if (!me) return null;
  if (me.role !== "administrator" && !me.isSuperadmin) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-setup-wizard">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === 1 ? <Layers className="h-4 w-4 text-primary" /> : <Users className="h-4 w-4 text-primary" />}
            {step === 1 ? "Step 1 of 2 — Create Groups" : "Step 2 of 2 — Invite Users"}
          </DialogTitle>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-2 mb-1">
          <div className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold ${step === 1 ? "bg-primary text-primary-foreground" : "bg-primary/20 text-primary"}`}>
            {step === 1 ? "1" : <Check className="h-3.5 w-3.5" />}
          </div>
          <div className="flex-1 h-px bg-border" />
          <div className={`flex items-center justify-center h-6 w-6 rounded-full text-xs font-semibold ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</div>
        </div>

        {step === 1 && (
          <div className="space-y-4" data-testid="wizard-step-1">
            <p className="text-sm text-muted-foreground">
              Groups partition your organisation into separate operational units (e.g. Alpha, Bravo).
              A <strong>Central Group</strong> already exists. Add additional ones below, or skip to continue.
            </p>

            {nonCentralGroups.length > 0 && (
              <Alert>
                <AlertDescription className="text-sm">
                  <span className="font-medium">Already created:</span>{" "}
                  {nonCentralGroups.map(c => c.name).join(", ")}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              {groupInputs.map((val, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    placeholder="Group name — e.g. Alpha Group"
                    value={val}
                    onChange={(e) => setGroupInputs(prev => { const n = [...prev]; n[i] = e.target.value; return n; })}
                    data-testid={`input-wizard-group-${i}`}
                  />
                  {groupInputs.length > 1 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="shrink-0 text-muted-foreground hover:text-destructive"
                      onClick={() => setGroupInputs(prev => prev.filter((_, j) => j !== i))}
                      data-testid={`button-wizard-remove-group-${i}`}
                    ><Trash2 className="h-4 w-4" /></Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5 text-xs"
                onClick={() => setGroupInputs(prev => [...prev, ""])}
                data-testid="button-wizard-add-group"
              ><Plus className="h-3.5 w-3.5" /> Add another Group</Button>
            </div>

            <div className="flex justify-between pt-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => { suppressAutoOpen(); onClose(); }}
                data-testid="button-wizard-skip"
              >
                Skip for now
              </Button>
              <Button onClick={handleCreateGroups} disabled={creatingGroups} data-testid="button-wizard-next-1">
                {creatingGroups ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {groupInputs.every(g => !g.trim()) ? "Skip to users →" : "Create Groups →"}
              </Button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4" data-testid="wizard-step-2">
            <p className="text-sm text-muted-foreground">
              {nonCentralGroups.length > 0
                ? "Invite team members — they'll receive a link to set their own password."
                : "Invite team members — they'll receive a link to set their own password. You can assign them to Groups later."}
            </p>

            {/* Invite cards — one per successfully invited user */}
            {inviteCards.length > 0 && (
              <div className="space-y-2">
                {inviteCards.map((card, i) => (
                  <WizardShareCard
                    key={`${card.email}-${i}`}
                    card={card}
                    orgName={orgName}
                    onDismiss={() => setInviteCards(prev => prev.filter((_, j) => j !== i))}
                  />
                ))}
              </div>
            )}

            {/* Invite form */}
            <form onSubmit={handleInviteUser} className="space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">First name</label>
                  <Input
                    placeholder="Jane"
                    value={newUser.firstName}
                    onChange={e => { setNewUser(u => ({ ...u, firstName: e.target.value })); setFinishWarning(false); }}
                    data-testid="input-wizard-firstname"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Last name</label>
                  <Input
                    placeholder="Smith"
                    value={newUser.lastName}
                    onChange={e => setNewUser(u => ({ ...u, lastName: e.target.value }))}
                    data-testid="input-wizard-lastname"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Email</label>
                <Input
                  type="email"
                  placeholder="jane@example.com"
                  value={newUser.email}
                  onChange={e => { setNewUser(u => ({ ...u, email: e.target.value })); setFinishWarning(false); }}
                  data-testid="input-wizard-email"
                />
              </div>
              <div className={nonCentralGroups.length > 0 ? "grid grid-cols-2 gap-2" : ""}>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Role</label>
                  <Select value={newUser.role} onValueChange={v => setNewUser(u => ({ ...u, role: v }))}>
                    <SelectTrigger data-testid="select-wizard-role"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="administrator">Administrator</SelectItem>
                      <SelectItem value="control_room">Control Room</SelectItem>
                      <SelectItem value="supervisor">Supervisor (legacy)</SelectItem>
                      <SelectItem value="reporter">Reporter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {nonCentralGroups.length > 0 && (
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Group <span className="text-destructive">*</span></label>
                    <Select value={newUser.commandId} onValueChange={v => setNewUser(u => ({ ...u, commandId: v }))}>
                      <SelectTrigger data-testid="select-wizard-group"><SelectValue placeholder="Select group" /></SelectTrigger>
                      <SelectContent>
                        {nonCentralGroups.map(c => (
                          <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {finishWarning && (
                <div className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400" data-testid="text-finish-warning">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  You have unsaved details — click <strong>Invite User</strong> first, or clear the fields to finish.
                </div>
              )}

              <Button
                type="submit"
                variant="outline"
                className="w-full gap-1.5"
                disabled={inviteMutation.isPending}
                data-testid="button-wizard-add-user"
              >
                {inviteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Invite User
              </Button>
            </form>

            <div className="flex justify-between pt-2 border-t">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} data-testid="button-wizard-back">← Back</Button>
              <Button onClick={handleFinish} data-testid="button-wizard-finish">
                {inviteCards.length > 0
                  ? `Finish (${inviteCards.length} invited)`
                  : "Finish setup"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Controller — manages wizard open state with precise auto-open trigger ──────

export function SetupWizardController() {
  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const { data: allCommands = [] } = useQuery<OrgCommand[]>({ queryKey: ["/api/commands"] });
  const { data: users = [] } = useQuery<UsersResp>({ queryKey: ["/api/users"] });

  const [wizardOpen, setWizardOpen] = useState(false);
  const [autoChecked, setAutoChecked] = useState(false);

  useEffect(() => {
    if (autoChecked) return;
    if (!me) return;
    if (me.role !== "administrator" && !me.isSuperadmin) return;
    if (allCommands.length === 0) return;

    setAutoChecked(true);

    // Auto-open only when: no non-central groups AND no other users (true first-login)
    // AND admin hasn't already dismissed the auto-open
    if (!isAutoOpenSuppressed() && isFirstLoginState(allCommands, users, me.id)) {
      setWizardOpen(true);
    }
  }, [me, allCommands, users, autoChecked]);

  if (!me || (me.role !== "administrator" && !me.isSuperadmin)) return null;

  return (
    <>
      <SetupBanner onOpenWizard={() => setWizardOpen(true)} />
      <SetupWizard open={wizardOpen} onClose={() => setWizardOpen(false)} />
    </>
  );
}
