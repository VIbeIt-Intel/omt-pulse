import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Users, Plus, Pencil, Trash2, ShieldOff, ShieldCheck, Eye, EyeOff, MapPin, ScrollText, Download, History, Copy, CheckCheck, Share2, RefreshCw, Link2, ClipboardList, FileText, Paperclip, Mic, ChevronDown, X, Bell, BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { buildOrgAdminAccessMessage } from "@/lib/onboarding-messages";
import { Skeleton } from "@/components/ui/skeleton";
import type { Category, Location, FormField as OrgFormField } from "@shared/schema";
import { USER_ROLES } from "@shared/user-roles";
import { GeoLocationSheet, type GeoMapView } from "@/components/incident-location-sheet";
import { CoordinateLink } from "@/components/coordinate-link";
import * as XLSX from "xlsx";

type OrgCommand = { id: number; name: string; isCentral: boolean };

type OrgUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  contactNumber?: string | null;
  homeAddress?: string | null;
  posting?: string | null;
  role: string;
  isActive: boolean;
  mustChangePassword?: boolean | null;
  canEditIncidents: boolean;
  canManageAttachments: boolean;
  canDeleteIncidents: boolean;
  avatarUrl?: string | null;
  inviteToken?: string | null;
  inviteTokenExpiresAt?: string | null;
  commands?: OrgCommand[];
  hasPushSubscription?: boolean;
  pushRegistration?: { fcm: boolean; web: boolean };
};

const ROLES = [
  { value: "administrator", label: "Administrator (Full Access)" },
  { value: "control_room", label: "Control Room (Monitor & Dispatch)" },
  { value: "supervisor", label: "Supervisor (legacy — same as control room)" },
  { value: "access_controller", label: "Access Controller (Gate / OB)" },
  { value: "patrol_user", label: "Patrol User" },
  { value: "reporter", label: "Reporter (Field)" },
];

function roleBadgeVariant(role: string): "default" | "secondary" | "outline" {
  if (role === "administrator") return "default";
  if (role === "control_room" || role === "access_controller" || role === "patrol_user" || role === "supervisor") return "secondary";
  return "outline";
}

const userFormSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email is required"),
  contactNumber: z.string().optional(),
  homeAddress: z.string().optional(),
  posting: z.string().optional(),
  role: z.enum(USER_ROLES, { required_error: "Role is required" }),
  password: z.string().optional(),
  confirmPassword: z.string().optional(),
  shiftPin: z.string().optional(),
  canEditIncidents: z.boolean().default(true),
  canManageAttachments: z.boolean().default(true),
  canDeleteIncidents: z.boolean().default(true),
  commandIds: z.array(z.number().int().positive()).min(1, "Select at least one Group"),
}).refine((d) => {
  if (d.password && d.password.length > 0) {
    return d.password.length >= 10;
  }
  return true;
}, { message: "Password must be at least 10 characters", path: ["password"] })
.refine((d) => {
  if (d.password && d.password.length > 0) {
    return d.password === d.confirmPassword;
  }
  return true;
}, { message: "Passwords do not match", path: ["confirmPassword"] })
.refine((d) => {
  if (d.shiftPin && d.shiftPin.length > 0) {
    return /^\d{4,6}$/.test(d.shiftPin);
  }
  return true;
}, { message: "Shift PIN must be 4–6 digits", path: ["shiftPin"] });

type UserFormValues = z.infer<typeof userFormSchema>;

function PermissionsSection({ form }: { form: ReturnType<typeof useForm<UserFormValues>> }) {
  const role = form.watch("role");
  const isAdmin = role === "administrator";
  const isControlRoomRole = role === "control_room";
  const isAccessControllerRole = role === "access_controller";
  return (
    <div className="border-t pt-4 space-y-3">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Permissions</p>
      <div className="space-y-2">
        {isAdmin && (
          <p className="text-xs text-muted-foreground italic">Administrators always have full access — permissions cannot be restricted.</p>
        )}
        <FormField control={form.control} name="canEditIncidents" render={({ field }) => (
          <label className={`flex items-center gap-3 ${isAdmin ? "opacity-50" : "cursor-pointer"}`} data-testid="label-perm-edit">
            <Checkbox
              checked={isAdmin ? true : field.value}
              onCheckedChange={isAdmin ? undefined : field.onChange}
              disabled={isAdmin}
              data-testid="checkbox-perm-edit"
            />
            <span className="text-sm">Can edit incidents</span>
          </label>
        )} />
        <FormField control={form.control} name="canManageAttachments" render={({ field }) => (
          <label className={`flex items-center gap-3 ${isAdmin ? "opacity-50" : "cursor-pointer"}`} data-testid="label-perm-attachments">
            <Checkbox
              checked={isAdmin ? true : field.value}
              onCheckedChange={isAdmin ? undefined : field.onChange}
              disabled={isAdmin}
              data-testid="checkbox-perm-attachments"
            />
            <span className="text-sm">Can add/delete attachments</span>
          </label>
        )} />
        {(isControlRoomRole || isAccessControllerRole) && (
          <p className="text-xs text-muted-foreground italic">
            {isControlRoomRole
              ? "Control room users cannot delete incidents from the occurrence book."
              : "Access controllers can file manual OB entries and evidence on their own incidents only."}
          </p>
        )}
        <FormField control={form.control} name="canDeleteIncidents" render={({ field }) => (
          <label className={`flex items-center gap-3 ${isAdmin || isControlRoomRole || isAccessControllerRole ? "opacity-50" : "cursor-pointer"}`} data-testid="label-perm-delete">
            <Checkbox
              checked={isAdmin ? true : (isControlRoomRole || isAccessControllerRole) ? false : field.value}
              onCheckedChange={isAdmin || isControlRoomRole || isAccessControllerRole ? undefined : field.onChange}
              disabled={isAdmin || isControlRoomRole || isAccessControllerRole}
              data-testid="checkbox-perm-delete"
            />
            <span className="text-sm">Can delete incidents</span>
          </label>
        )} />
      </div>
    </div>
  );
}

type ShareInfo = { firstName: string; email: string; password?: string };

function buildTesterWelcomeMessage(shareInfo: ShareInfo, orgName: string | null): string {
  return buildOrgAdminAccessMessage({
    firstName: shareInfo.firstName,
    email: shareInfo.email,
    password: shareInfo.password,
    orgName,
  });
}

function ShareScreen({
  shareInfo,
  orgName,
  onDone,
  onAddAnother,
}: {
  shareInfo: ShareInfo;
  orgName: string | null;
  onDone: () => void;
  onAddAnother: () => void;
}) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const message = buildTesterWelcomeMessage(shareInfo, orgName);

  function handleCopyMsg() {
    navigator.clipboard.writeText(message).then(() => {
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2500);
    });
  }

  function handleWhatsApp() {
    const encoded = encodeURIComponent(message);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">

      {/* Success header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
          <Share2 className="h-5 w-5 text-primary" />
        </div>
        <div>
          <p className="font-semibold">{shareInfo.firstName} has been added</p>
          <p className="text-sm text-muted-foreground">
            Copy this message with web sign-in details. Mobile app install is arranged by IntelAfri.
          </p>
        </div>
      </div>

      {/* WhatsApp-style message preview */}
      <div className="rounded-xl overflow-hidden border">
        {/* Chat header bar */}
        <div className="bg-[#075e54] px-4 py-2.5 flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white">
            {shareInfo.firstName.charAt(0).toUpperCase()}
          </div>
          <span className="text-white text-sm font-medium">{shareInfo.firstName}</span>
        </div>
        {/* Chat body */}
        <div className="bg-[#e5ddd5] dark:bg-[#1a1a1a] px-3 py-3">
          <div className="bg-white dark:bg-[#2a2a2a] rounded-lg rounded-tl-none px-3 py-2.5 shadow-sm max-w-[85%] inline-block">
            <p className="text-[12px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words" data-testid="text-share-message">
              {message}
            </p>
            <p className="text-[10px] text-gray-400 text-right mt-1">now</p>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col gap-2">
        {/* Primary — WhatsApp deep link */}
        <Button
          className="w-full h-11 bg-[#25d366] hover:bg-[#1ebe5d] text-white font-semibold gap-2"
          onClick={handleWhatsApp}
          data-testid="button-send-whatsapp"
        >
          {/* WhatsApp icon as inline SVG */}
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" xmlns="http://www.w3.org/2000/svg">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
          Send via WhatsApp
        </Button>

        {/* Secondary — copy to clipboard */}
        <Button
          variant="outline"
          className="w-full h-10 gap-2"
          onClick={handleCopyMsg}
          data-testid="button-copy-share-message"
        >
          {copiedMsg
            ? <><CheckCheck className="h-4 w-4 text-green-600" /> Message copied!</>
            : <><Copy className="h-4 w-4" /> Copy message (SMS / email)</>}
        </Button>
      </div>

      <DialogFooter className="mt-auto gap-2 sm:gap-0">
        <Button variant="outline" onClick={onAddAnother} data-testid="button-add-another-user">
          Add Another User
        </Button>
        <Button variant="default" onClick={onDone} data-testid="button-share-done">
          Done
        </Button>
      </DialogFooter>
    </div>
  );
}

function UserDialog({
  open,
  onClose,
  editUser,
  currentUserId,
  orgName,
  onHighlightUser,
  commands,
  defaultCommandId,
}: {
  open: boolean;
  onClose: () => void;
  editUser: OrgUser | null;
  currentUserId: string;
  orgName: string | null;
  onHighlightUser?: (userId: string) => void;
  commands: OrgCommand[];
  defaultCommandId: number | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const isEdit = !!editUser;
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [shareInfo, setShareInfo] = useState<ShareInfo | null>(null);
  const [emailConflict, setEmailConflict] = useState<string | null>(null);
  const [emailConflictUserId, setEmailConflictUserId] = useState<string | null>(null);

  // Default Command selection:
  // - Edit: the user's current Command memberships
  // - Add: the admin's currently active Command (so creating a user while
  //   viewing "Tzaneen, Limpopo" defaults Mercialene into Tzaneen). Falls back
  //   to no selection so the admin is forced to pick — never silently Central.
  const initialCommandIds: number[] = editUser?.commands?.map(c => c.id)
    ?? (defaultCommandId != null ? [defaultCommandId] : []);

  const form = useForm<UserFormValues>({
    resolver: zodResolver(userFormSchema),
    defaultValues: {
      firstName: editUser?.firstName ?? "",
      lastName: editUser?.lastName ?? "",
      email: editUser?.email ?? "",
      contactNumber: editUser?.contactNumber ?? "",
      homeAddress: editUser?.homeAddress ?? "",
      posting: editUser?.posting ?? "",
      role: (editUser?.role ?? "reporter") as (typeof USER_ROLES)[number],
      password: "",
      confirmPassword: "",
      shiftPin: "",
      canEditIncidents: editUser?.canEditIncidents ?? true,
      canManageAttachments: editUser?.canManageAttachments ?? true,
      canDeleteIncidents: editUser?.canDeleteIncidents ?? true,
      commandIds: initialCommandIds,
    },
  });

  // Re-sync defaults when the dialog is reopened for a different user/mode
  // (otherwise react-hook-form holds stale values from the previous render).
  useEffect(() => {
    if (!open) return;
    form.reset({
      firstName: editUser?.firstName ?? "",
      lastName: editUser?.lastName ?? "",
      email: editUser?.email ?? "",
      contactNumber: editUser?.contactNumber ?? "",
      homeAddress: editUser?.homeAddress ?? "",
      posting: editUser?.posting ?? "",
      role: (editUser?.role ?? "reporter") as (typeof USER_ROLES)[number],
      password: "",
      confirmPassword: "",
      shiftPin: "",
      canEditIncidents: editUser?.canEditIncidents ?? true,
      canManageAttachments: editUser?.canManageAttachments ?? true,
      canDeleteIncidents: editUser?.canDeleteIncidents ?? true,
      commandIds: editUser?.commands?.map(c => c.id)
        ?? (defaultCommandId != null ? [defaultCommandId] : []),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editUser?.id]);

  function handleClose() {
    setShareInfo(null);
    setEmailConflict(null);
    setEmailConflictUserId(null);
    onClose();
  }

  function handleAddAnother() {
    setShareInfo(null);
    setEmailConflict(null);
    setEmailConflictUserId(null);
    form.reset({
      firstName: "",
      lastName: "",
      email: "",
      contactNumber: "",
      homeAddress: "",
      posting: "",
      role: "reporter",
      password: "",
      confirmPassword: "",
      shiftPin: "",
      canEditIncidents: true,
      canManageAttachments: true,
      canDeleteIncidents: true,
      commandIds: defaultCommandId != null ? [defaultCommandId] : [],
    });
  }

  const mutation = useMutation({
    mutationFn: (data: UserFormValues) => {
      const body: Record<string, unknown> = {
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        contactNumber: data.contactNumber || null,
        homeAddress: data.homeAddress || null,
        posting: data.posting || null,
        role: data.role,
        canEditIncidents: data.canEditIncidents ?? true,
        canManageAttachments: data.canManageAttachments ?? true,
        canDeleteIncidents: data.canDeleteIncidents ?? true,
        password: isEdit ? (data.password && data.password.length > 0 ? data.password : undefined) : data.password,
        shiftPin: data.shiftPin && data.shiftPin.length > 0 ? data.shiftPin : isEdit ? "" : undefined,
        commandIds: data.commandIds,
      };

      if (isEdit) {
        return apiRequest("PATCH", `/api/users/${editUser!.id}`, body);
      }
      return apiRequest("POST", "/api/users", body);
    },
    onSuccess: (res, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      if (isEdit) {
        toast({ title: "User updated" });
        handleClose();
      } else {
        setShareInfo({
          firstName: variables.firstName,
          email: variables.email.trim().toLowerCase(),
          password: variables.password,
        });
      }
    },
    onError: (err: Error) => {
      // 409 = same-org email conflict — show inline under the email field.
      if (err.message.startsWith("409:")) {
        const raw = err.message.replace(/^409:\s*/, "");
        try {
          const parsed = JSON.parse(raw);
          setEmailConflict(parsed.message ?? raw);
          setEmailConflictUserId(parsed.existingUserId ?? null);
        } catch {
          setEmailConflict(raw);
          setEmailConflictUserId(null);
        }
        return;
      }
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-xl w-[92vw] max-h-[82vh] overflow-hidden flex flex-col p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>{shareInfo ? "Share Access Details" : isEdit ? "Edit User" : "Add User"}</DialogTitle>
        </DialogHeader>

        {shareInfo ? (
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ShareScreen
              shareInfo={shareInfo}
              orgName={orgName}
              onDone={handleClose}
              onAddAnother={handleAddAnother}
            />
          </div>
        ) : (
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit((d) => {
                if (!isEdit) {
                  if (!d.password || d.password.length < 10) {
                    form.setError("password", { message: "Password must be at least 10 characters" });
                    return;
                  }
                  if (d.password !== d.confirmPassword) {
                    form.setError("confirmPassword", { message: "Passwords do not match" });
                    return;
                  }
                }
                mutation.mutate(d);
              })}
              className="flex flex-1 min-h-0 flex-col overflow-hidden"
            >
              <div className="flex-1 min-h-0 space-y-2.5 overflow-y-auto pr-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <FormField control={form.control} name="firstName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>First Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input {...field} data-testid="input-user-first-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="lastName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Last Name <span className="text-destructive">*</span></FormLabel>
                    <FormControl><Input {...field} data-testid="input-user-last-name" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email Address <span className="text-destructive">*</span></FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      data-testid="input-user-email"
                      onChange={(e) => { field.onChange(e); setEmailConflict(null); }}
                    />
                  </FormControl>
                  <FormMessage />
                  {emailConflict && (
                    <div className="mt-1.5 rounded-md border border-destructive/40 bg-destructive/5 p-2.5 space-y-1.5" data-testid="text-email-conflict">
                      <p className="text-sm text-destructive">{emailConflict}</p>
                      {emailConflictUserId && (
                        <button
                          type="button"
                          className="text-xs font-medium text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
                          data-testid="button-view-conflicting-user"
                          onClick={() => {
                            onHighlightUser?.(emailConflictUserId);
                            handleClose();
                          }}
                        >
                          View in user list →
                        </button>
                      )}
                    </div>
                  )}
                </FormItem>
              )} />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <FormField control={form.control} name="contactNumber" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Number</FormLabel>
                    <FormControl><Input {...field} type="tel" data-testid="input-user-contact" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />

                <FormField control={form.control} name="homeAddress" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Home Address</FormLabel>
                    <FormControl><Input {...field} data-testid="input-user-address" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

                <FormField control={form.control} name="role" render={({ field }) => (
                <FormItem>
                  <FormLabel>Role <span className="text-destructive">*</span></FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-user-role">
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {ROLES.map((r) => (
                        <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="commandIds" render={({ field }) => (
                <FormItem>
                  <FormLabel>Group <span className="text-destructive">*</span></FormLabel>
                  <p className="text-xs text-muted-foreground -mt-1 mb-1">
                    Which Group does this person work in? Tick more than one if they cover multiple.
                  </p>
                  <div className="rounded-md border max-h-44 overflow-y-auto divide-y" data-testid="list-command-picker">
                    {commands.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No Groups available. An administrator must create one first.
                      </p>
                    ) : (
                      commands.map((cmd) => {
                        const selected = (field.value ?? []).includes(cmd.id);
                        return (
                          <label
                            key={cmd.id}
                            className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/40 transition-colors"
                            data-testid={`option-command-${cmd.id}`}
                          >
                            <Checkbox
                              checked={selected}
                              onCheckedChange={(c) => {
                                const current = field.value ?? [];
                                if (c) {
                                  if (!current.includes(cmd.id)) field.onChange([...current, cmd.id]);
                                } else {
                                  field.onChange(current.filter((id) => id !== cmd.id));
                                }
                              }}
                              data-testid={`checkbox-command-${cmd.id}`}
                            />
                            <span className="text-sm flex-1">{cmd.name}</span>
                            {cmd.isCentral && (
                              <Badge variant="outline" className="text-[10px] h-5 px-1.5">Central</Badge>
                            )}
                          </label>
                        );
                      })
                    )}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />

              {isEdit && <PermissionsSection form={form} />}

              {isEdit && (
                <div className="border-t pt-2.5 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Leave password blank to keep the current password.
                  </p>
                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type={showPassword ? "text" : "password"} placeholder="Minimum 10 characters" className="pr-10" data-testid="input-user-password" autoComplete="new-password" />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm Password</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type={showConfirm ? "text" : "password"} placeholder="Repeat password" className="pr-10" data-testid="input-user-confirm-password" autoComplete="new-password" />
                          <button
                            type="button"
                            onClick={() => setShowConfirm((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}
              {!isEdit && (
                <div className="border-t pt-2.5 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Set a login password now — you&apos;ll copy a WhatsApp message with web sign-in details.
                  </p>
                  <FormField control={form.control} name="password" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type={showPassword ? "text" : "password"} placeholder="Minimum 10 characters" className="pr-10" data-testid="input-user-password" autoComplete="new-password" />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="confirmPassword" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Confirm password <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Input {...field} type={showConfirm ? "text" : "password"} placeholder="Repeat password" className="pr-10" data-testid="input-user-confirm-password" autoComplete="new-password" />
                          <button
                            type="button"
                            onClick={() => setShowConfirm((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                            tabIndex={-1}
                          >
                            {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              )}

              <div className="border-t pt-2.5 space-y-2">
                <p className="text-xs text-muted-foreground">
                  Shift PIN for dedicated / shared devices (gate tablet, shift phone). Guards sign in with this PIN instead of email and password on enrolled devices.
                </p>
                <FormField control={form.control} name="shiftPin" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Shift PIN</FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        inputMode="numeric"
                        pattern="[0-9]*"
                        maxLength={6}
                        placeholder={isEdit ? "Leave blank to keep current PIN" : "4–6 digits (optional)"}
                        autoComplete="off"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>

              </div>
              <DialogFooter className="shrink-0 border-t pt-2 mt-1.5">
                <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
                <Button type="submit" disabled={mutation.isPending} data-testid="button-save-user">
                  {mutation.isPending ? "Saving..." : isEdit ? "Save Changes" : "Create User"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  );
}

type OrgLocation = { id: number; name: string; address?: string | null };

function LocationAssignDialog({ user, onClose }: { user: OrgUser | null; onClose: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<number[]>([]);

  const { data: locations = [] } = useQuery<OrgLocation[]>({
    queryKey: ["/api/locations"],
    enabled: !!user,
  });

  const { data: existing, isLoading: assignLoading } = useQuery<{ locationIds: number[] }>({
    queryKey: ["/api/users", user?.id, "location-assignments"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${user!.id}/location-assignments`, { credentials: "include" });
      return res.json();
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (existing) setSelected(existing.locationIds);
  }, [existing]);

  const mutation = useMutation({
    mutationFn: async (locationIds: number[]) => {
      const res = await apiRequest("PUT", `/api/users/${user!.id}/location-assignments`, { locationIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users", user?.id, "location-assignments"] });
      toast({ title: "Location assignments saved" });
      onClose();
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  function toggle(id: number) {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  }

  return (
    <Dialog open={!!user} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-primary" />
            Location Assignments
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {user?.firstName} {user?.lastName} — select which predefined locations this user can access. If none are selected, they see all incidents.
          </p>
        </DialogHeader>
        <div className="space-y-2 max-h-72 overflow-y-auto py-1">
          {assignLoading ? (
            <div className="py-4 text-center text-muted-foreground text-sm">Loading...</div>
          ) : locations.length === 0 ? (
            <div className="py-4 text-center text-muted-foreground text-sm">No predefined locations found. Add locations in the Admin page first.</div>
          ) : (
            locations.map((loc) => (
              <label
                key={loc.id}
                className="flex items-start gap-3 p-3 rounded-md border cursor-pointer hover:bg-muted/50 transition-colors"
                data-testid={`label-location-assign-${loc.id}`}
              >
                <Checkbox
                  checked={selected.includes(loc.id)}
                  onCheckedChange={() => toggle(loc.id)}
                  data-testid={`checkbox-location-${loc.id}`}
                  className="mt-0.5"
                />
                <div>
                  <p className="text-sm font-medium">{loc.name}</p>
                  {loc.address && <p className="text-xs text-muted-foreground">{loc.address}</p>}
                </div>
              </label>
            ))
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => mutation.mutate(selected)}
            disabled={mutation.isPending || assignLoading}
            data-testid="button-save-location-assignments"
          >
            {mutation.isPending ? "Saving..." : "Save Assignments"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AuditLogEntry = {
  id: number;
  action: string;
  entityType: string | null;
  entityId: string | null;
  description: string;
  changes: Record<string, { from: unknown; to: unknown }> | null;
  createdAt: string;
};

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Login",
  "auth.logout": "Logout",
  "incident.create": "Incident Created",
  "incident.edit": "Incident Edited",
  "incident.delete": "Incident Deleted",
  "admin.user_create": "User Created",
  "admin.user_update": "User Updated",
  "admin.user_delete": "User Deleted",
  "admin.user_status": "User Status Changed",
  "profile.update": "Profile Updated",
  "billing.cancel": "Subscription Cancelled",
  "panic.alert": "Panic Alert",
};

function formatAuditDate(dateStr: string) {
  const d = new Date(dateStr);
  return d.toLocaleString("en-ZA", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function ChangePills({ changes }: { changes: Record<string, { from: unknown; to: unknown }> }) {
  return (
    <div className="flex flex-wrap gap-1">
      {Object.entries(changes).map(([field, { from, to }]) => (
        <span key={field} className="inline-flex items-center gap-1 text-xs bg-muted rounded px-1.5 py-0.5">
          <span className="font-medium">{field}:</span>
          <span className="text-destructive line-through">{String(from ?? "—")}</span>
          <span className="text-muted-foreground">→</span>
          <span className="text-primary">{String(to ?? "—")}</span>
        </span>
      ))}
    </div>
  );
}

function AuditTrailDialog({ user, onClose }: { user: OrgUser | null; onClose: () => void }) {
  const [showAll, setShowAll] = useState(false);
  const [geoMapView, setGeoMapView] = useState<GeoMapView | null>(null);

  const queryUrl = user ? `/api/users/${user.id}/audit${showAll ? "?all=true" : ""}` : "";

  const { data: logs = [], isLoading } = useQuery<AuditLogEntry[]>({
    queryKey: ["/api/users", user?.id, "audit", showAll ? "all" : "30d"],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch audit trail");
      return res.json();
    },
    enabled: !!user,
  });

  function exportToExcel() {
    if (!user || logs.length === 0) return;
    const rows = logs.map((log) => {
      const isPanic = log.action === "panic.alert";
      const panicCoords = isPanic && log.changes?.location?.to as { lat: number; lng: number } | undefined;
      const mapsUrl = panicCoords ? `https://maps.google.com/?q=${panicCoords.lat},${panicCoords.lng}` : "";
      return {
        "Date/Time": formatAuditDate(log.createdAt),
        "Action": ACTION_LABELS[log.action] ?? log.action,
        "Description": log.description,
        "GPS Link": isPanic ? (mapsUrl || "Location unavailable") : "",
        "Changes": !isPanic && log.changes ? Object.entries(log.changes).map(([f, c]) => `${f}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join("; ") : "",
      };
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    ws["!cols"] = [{ wch: 22 }, { wch: 20 }, { wch: 40 }, { wch: 50 }, { wch: 40 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Audit Trail");
    const today = new Date().toISOString().split("T")[0];
    XLSX.writeFile(wb, `${user.firstName}_${user.lastName}-audit-${today}.xlsx`);
  }

  return (
    <>
    <Dialog open={!!user} onOpenChange={(o) => { if (!o) { onClose(); setShowAll(false); } }}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScrollText className="h-5 w-5" />
            Audit Trail — {user?.firstName} {user?.lastName}
          </DialogTitle>
          <p className="text-sm text-muted-foreground">
            {showAll ? "Showing all history" : "Showing last 30 days"}
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {isLoading ? (
            <div className="space-y-2 p-2">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : logs.length === 0 ? (
            <div className="py-12 text-center">
              <History className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No audit entries found for this period.</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b sticky top-0">
                <tr>
                  <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Date / Time</th>
                  <th className="text-left px-3 py-2 font-medium">Action</th>
                  <th className="text-left px-3 py-2 font-medium">Description</th>
                  <th className="text-left px-3 py-2 font-medium">Changes</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log) => {
                  const isPanic = log.action === "panic.alert";
                  const panicCoords = isPanic && log.changes?.location?.to as { lat: number; lng: number } | undefined;
                  return (
                    <tr key={log.id} className={`border-b last:border-0 hover:bg-muted/30${isPanic ? " bg-destructive/5" : ""}`} data-testid={`row-audit-${log.id}`}>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground text-xs">{formatAuditDate(log.createdAt)}</td>
                      <td className="px-3 py-2">
                        <Badge
                          variant={isPanic ? "destructive" : "outline"}
                          className="text-xs font-normal gap-1"
                        >
                          {isPanic && <span aria-hidden>🆘</span>}
                          {ACTION_LABELS[log.action] ?? log.action}
                        </Badge>
                      </td>
                      <td className="px-3 py-2 text-xs">{log.description}</td>
                      <td className="px-3 py-2">
                        {isPanic && panicCoords ? (
                          <CoordinateLink
                            lat={panicCoords.lat}
                            lng={panicCoords.lng}
                            label="Panic location"
                            onOpenMap={setGeoMapView}
                            className="text-xs"
                            testId={`link-panic-map-${log.id}`}
                          />
                        ) : log.changes && !isPanic ? (
                          <ChangePills changes={log.changes} />
                        ) : (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between gap-2 pt-3 border-t sm:justify-between">
          <div>
            {!showAll && (
              <Button variant="ghost" size="sm" className="text-xs px-0 underline-offset-2 hover:underline" onClick={() => setShowAll(true)} data-testid="button-audit-show-all">
                Show all history
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={exportToExcel} disabled={logs.length === 0} data-testid="button-audit-export">
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export to Excel
            </Button>
            <Button variant="outline" size="sm" onClick={() => { onClose(); setShowAll(false); }}>
              Close
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    <GeoLocationSheet view={geoMapView} onClose={() => setGeoMapView(null)} />
    </>
  );
}

// ─── User Incidents Sheet ────────────────────────────────────────────

type JoinedIncident = {
  incidentId: number;
  joinedAt: string;
  leftAt: string | null;
  arrivedAt: string | null;
  arrivalNote: string | null;
  incidentDate: string;
  incidentTime: string;
  categoryId: number | null;
  description: string | null;
  creatorFirstName: string | null;
  creatorLastName: string | null;
};

type IncidentWithCount = {
  id: number;
  incidentDate: string;
  incidentTime: string;
  categoryId: number | null;
  otherCategoryNote: string | null;
  locationId: number | null;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  description: string | null;
  customFields: Record<string, string | number | null> | null;
  attachmentCount: number;
  liveStartedAt: string | null;
  liveEndedAt: string | null;
  liveStartLat: number | null;
  liveStartLng: number | null;
  liveClosedManually: boolean | null;
  responderArrivedAt: string | null;
  destinationName: string | null;
  destinationLat: number | null;
  destinationLng: number | null;
};

type AttachmentRecord = {
  id: number;
  url: string;
  filename: string;
  mimeType: string;
};

function normaliseAttachmentUrl(url: string): string {
  if (url.startsWith("data:")) return url;
  if (url.startsWith("http")) {
    try { const u = new URL(url); return u.pathname + u.search; } catch { return url; }
  }
  return url;
}

function AttachmentItem({ att }: { att: AttachmentRecord }) {
  const href = normaliseAttachmentUrl(att.url);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  if (att.mimeType.startsWith("audio/")) {
    return (
      <div className="flex flex-col gap-1 p-2 border border-border rounded-md bg-muted/30 min-w-[200px]" data-testid={`attachment-audio-${att.id}`}>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mic className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[170px]">{att.filename}</span>
        </div>
        <audio controls src={href} className="w-full h-8" />
      </div>
    );
  }
  if (att.mimeType.startsWith("image/")) {
    return (
      <>
        <button
          type="button"
          className="shrink-0 block cursor-zoom-in focus:outline-none"
          onClick={() => setLightboxOpen(true)}
          data-testid={`attachment-img-${att.id}`}
          aria-label={`View ${att.filename}`}
        >
          <img
            src={href}
            alt={att.filename}
            className="h-20 w-20 object-cover rounded border border-border"
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </button>
        <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
          <DialogContent className="max-w-3xl p-2 bg-black/90 border-0" hideDefaultClose>
            <DialogTitle className="sr-only">{att.filename}</DialogTitle>
            <DialogClose className="absolute right-3 top-3 z-10 rounded-full bg-black/75 hover:bg-black/95 text-white border border-white/30 p-2 transition-colors focus:outline-none">
              <X className="h-5 w-5" />
              <span className="sr-only">Close</span>
            </DialogClose>
            <img
              src={href}
              alt={att.filename}
              className="w-full max-h-[85vh] object-contain rounded"
            />
          </DialogContent>
        </Dialog>
      </>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-1.5 text-xs text-primary hover:underline"
      data-testid={`attachment-file-${att.id}`}
    >
      <Paperclip className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate max-w-[160px]">{att.filename}</span>
    </a>
  );
}

function IncidentAttachmentsSection({ incidentId }: { incidentId: number }) {
  const { data: attachments = [], isLoading } = useQuery<AttachmentRecord[]>({
    queryKey: ["/api/incidents", incidentId, "attachments"],
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${incidentId}/attachments`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load attachments");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
  if (isLoading) return <p className="text-xs text-muted-foreground">Loading…</p>;
  if (attachments.length === 0) return <p className="text-xs text-muted-foreground italic">No attachments</p>;
  return (
    <div className="flex flex-wrap gap-2" data-testid={`attachments-incident-${incidentId}`}>
      {attachments.map(att => <AttachmentItem key={att.id} att={att} />)}
    </div>
  );
}

function UserIncidentsSheet({ user, onClose }: { user: OrgUser | null; onClose: () => void }) {
  const [openValue, setOpenValue] = useState<string>("");
  const [openedIds, setOpenedIds] = useState<Set<number>>(new Set());
  const [geoMapView, setGeoMapView] = useState<GeoMapView | null>(null);

  useEffect(() => {
    setOpenValue("");
    setOpenedIds(new Set());
  }, [user?.id]);

  const { data: incidents = [], isLoading: incLoading } = useQuery<IncidentWithCount[]>({
    queryKey: ["/api/users", user?.id, "incidents"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${user!.id}/incidents`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load incidents");
      return res.json();
    },
    enabled: !!user,
  });

  const { data: joinedIncidents = [], isLoading: joinedLoading } = useQuery<JoinedIncident[]>({
    queryKey: ["/api/users", user?.id, "joined-incidents"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${user!.id}/joined-incidents`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!user,
  });

  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: formFields = [] } = useQuery<OrgFormField[]>({ queryKey: ["/api/form-fields"] });

  function handleAccordionChange(value: string) {
    setOpenValue(value);
    if (value) {
      const id = parseInt(value);
      if (!isNaN(id)) setOpenedIds(prev => new Set([...prev, id]));
    }
  }

  const visibleCustomFields = formFields.filter(f => !f.isSystem && f.isVisible);
  const getCat = (id: number | null) => categories.find(c => c.id === id);
  const getLoc = (id: number | null) => locations.find(l => l.id === id);

  return (
    <Sheet open={!!user} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-lg flex flex-col p-0" data-testid="sheet-user-incidents">
        <SheetHeader className="px-4 py-3 border-b shrink-0">
          {user && (
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center border border-border shrink-0 overflow-hidden">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.firstName} className="h-full w-full object-cover" />
                ) : (
                  <span className="text-sm font-bold text-primary select-none">
                    {`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()}
                  </span>
                )}
              </div>
              <div className="min-w-0">
                <SheetTitle className="text-base leading-tight">
                  {user.firstName} {user.lastName}
                </SheetTitle>
                <div className="flex items-center gap-2 mt-0.5">
                  <Badge variant={roleBadgeVariant(user.role)} className="capitalize text-xs">
                    {user.role}
                  </Badge>
                  <span className="text-xs text-muted-foreground" data-testid="text-user-incident-count">
                    {incLoading ? "…" : `${incidents.length} incident${incidents.length !== 1 ? "s" : ""} created`}
                    {!joinedLoading && joinedIncidents.length > 0 && (
                      <span className="ml-1.5">· {joinedIncidents.length} joined</span>
                    )}
                  </span>
                </div>
              </div>
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 min-h-0 overflow-y-auto">
          {incLoading ? (
            <div className="p-4 space-y-2">
              {[1, 2, 3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
            </div>
          ) : incidents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-muted-foreground">
              <FileText className="h-10 w-10 opacity-25" />
              <p className="text-sm">No incidents logged by this user</p>
            </div>
          ) : (
            <Accordion
              type="single"
              collapsible
              value={openValue}
              onValueChange={handleAccordionChange}
              className="divide-y divide-border"
            >
              {incidents.map(inc => {
                const cat = getCat(inc.categoryId);
                const loc = getLoc(inc.locationId);
                const locationLabel = loc?.name
                  ?? inc.locationName
                  ?? (inc.latitude != null && inc.longitude != null
                    ? `${inc.latitude.toFixed(4)}, ${inc.longitude.toFixed(4)}`
                    : null);
                const hasBeenOpened = openedIds.has(inc.id);

                return (
                  <AccordionItem
                    key={inc.id}
                    value={inc.id.toString()}
                    className="border-none"
                    data-testid={`accordion-incident-${inc.id}`}
                  >
                    <AccordionTrigger
                      className="px-4 py-3 hover:bg-muted/40 hover:no-underline data-[state=open]:bg-muted/30 transition-colors"
                      data-testid={`trigger-incident-${inc.id}`}
                    >
                      <div className="flex items-start gap-2.5 text-left min-w-0 flex-1 mr-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full mt-0.5 shrink-0"
                          style={{ backgroundColor: cat?.color ?? "#6B7280" }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-medium">{cat?.name ?? "Uncategorised"}</span>
                            {inc.attachmentCount > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5 shrink-0">
                                <Paperclip className="h-2.5 w-2.5" />
                                {inc.attachmentCount}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">
                            {inc.incidentDate} · {inc.incidentTime}
                            {locationLabel ? ` · ${locationLabel}` : ""}
                          </p>
                          {inc.description && (
                            <p className="text-xs text-foreground/70 mt-0.5 line-clamp-1">{inc.description}</p>
                          )}
                        </div>
                      </div>
                    </AccordionTrigger>

                    <AccordionContent className="px-4 pb-4 pt-0">
                      <div className="space-y-3 border-t border-border/50 pt-3">

                        {inc.liveStartedAt && (() => {
                          const startedAt = new Date(inc.liveStartedAt);
                          const arrivedAt = inc.responderArrivedAt ? new Date(inc.responderArrivedAt) : null;
                          const durationMin = arrivedAt ? Math.round((arrivedAt.getTime() - startedAt.getTime()) / 60000) : null;
                          return (
                            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2.5 space-y-2" data-testid={`live-details-${inc.id}`}>
                              <p className="text-[10px] font-semibold text-primary uppercase tracking-wide flex items-center gap-1.5">
                                <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary" />
                                Live Incident Details
                              </p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Started</p>
                                  <p className="text-sm mt-0.5">{startedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Arrived on Scene</p>
                                  {arrivedAt ? (
                                    <p className="text-sm mt-0.5">
                                      {arrivedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                      {durationMin != null && (
                                        <span className="text-muted-foreground text-xs ml-1">· {durationMin} min response</span>
                                      )}
                                    </p>
                                  ) : (
                                    <p className="text-sm mt-0.5 text-muted-foreground italic">Not recorded</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Starting Location</p>
                                  {inc.liveStartLat != null && inc.liveStartLng != null ? (
                                    <div className="mt-0.5">
                                      <CoordinateLink
                                        lat={inc.liveStartLat}
                                        lng={inc.liveStartLng}
                                        onOpenMap={setGeoMapView}
                                        className="text-sm"
                                        decimals={4}
                                        testId={`link-start-location-${inc.id}`}
                                      />
                                    </div>
                                  ) : (
                                    <p className="text-sm mt-0.5 text-muted-foreground italic">Not recorded</p>
                                  )}
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Destination</p>
                                  <p className="text-sm mt-0.5">
                                    {inc.destinationName?.trim() || <span className="text-muted-foreground italic">None set</span>}
                                  </p>
                                </div>
                                {inc.liveEndedAt && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Ended</p>
                                    <p className="text-sm mt-0.5">
                                      {new Date(inc.liveEndedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                    </p>
                                  </div>
                                )}
                                {inc.liveEndedAt && (
                                  <div>
                                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">End Type</p>
                                    <p className="text-sm mt-0.5 font-medium">
                                      {inc.liveClosedManually ? "Manually closed" : "Converted to incident"}
                                    </p>
                                  </div>
                                )}
                              </div>
                              {inc.liveEndedAt && (() => {
                                const endedAt = new Date(inc.liveEndedAt);
                                const startedAt = new Date(inc.liveStartedAt!);
                                const totalMin = Math.round((endedAt.getTime() - startedAt.getTime()) / 60000);
                                const arrivedAt = inc.responderArrivedAt ? new Date(inc.responderArrivedAt) : null;
                                const sceneMin = arrivedAt ? Math.round((endedAt.getTime() - arrivedAt.getTime()) / 60000) : null;
                                const fmtMin = (m: number) => m < 1 ? "< 1 min" : `${m} min`;
                                return (
                                  <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                                    <div>
                                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Total Duration</p>
                                      <p className="text-sm mt-0.5 font-medium">{fmtMin(totalMin)}</p>
                                    </div>
                                    {sceneMin != null && (
                                      <div>
                                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Time on Scene</p>
                                        <p className="text-sm mt-0.5 font-medium">{fmtMin(sceneMin)}</p>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                              {inc.liveEndedAt && inc.liveStartLat != null && inc.liveStartLng != null && (
                                <div>
                                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Origin</p>
                                  <div className="mt-0.5">
                                    <CoordinateLink
                                      lat={inc.liveStartLat}
                                      lng={inc.liveStartLng}
                                      onOpenMap={setGeoMapView}
                                      className="text-sm"
                                      testId={`link-submit-location-${inc.id}`}
                                    />
                                  </div>
                                </div>
                              )}
                              <div className="border-t border-primary/10 pt-2">
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Incident Recorded</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? "#6B7280" }} />
                                  <span className="text-sm">{cat?.name ?? "Uncategorised"}</span>
                                </div>
                                {inc.description && (
                                  <p className="text-xs text-muted-foreground mt-0.5 ml-4">{inc.description}</p>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        <div className="grid grid-cols-2 gap-3">
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
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Category</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat?.color ?? "#6B7280" }} />
                            <span className="text-sm">{cat?.name ?? "Uncategorised"}</span>
                          </div>
                          {inc.otherCategoryNote && (
                            <p className="text-xs text-muted-foreground mt-0.5 ml-4">Note: {inc.otherCategoryNote}</p>
                          )}
                        </div>

                        {locationLabel && (() => {
                          const coordMatch = locationLabel.trim().match(/^(-?\d+\.?\d*),\s*(-?\d+\.?\d*)$/);
                          return (
                            <div>
                              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Location</p>
                              {coordMatch ? (
                                <div className="mt-0.5">
                                  <CoordinateLink
                                    lat={parseFloat(coordMatch[1])}
                                    lng={parseFloat(coordMatch[2])}
                                    onOpenMap={setGeoMapView}
                                    className="text-sm"
                                    testId={`link-location-${inc.id}`}
                                  />
                                </div>
                              ) : (
                                <p className="text-sm mt-0.5">{locationLabel}</p>
                              )}
                            </div>
                          );
                        })()}

                        {inc.description && (
                          <div>
                            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Description</p>
                            <p className="text-sm mt-0.5 whitespace-pre-wrap">{inc.description}</p>
                          </div>
                        )}

                        {inc.customFields && visibleCustomFields.length > 0 && (
                          visibleCustomFields
                            .filter(f => inc.customFields![f.fieldKey] != null && inc.customFields![f.fieldKey] !== "")
                            .map(f => (
                              <div key={f.fieldKey}>
                                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{f.label}</p>
                                <p className="text-sm mt-0.5">{String(inc.customFields![f.fieldKey])}</p>
                              </div>
                            ))
                        )}

                        <div className="pt-2 border-t border-border/40">
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                            Attachments
                            {inc.attachmentCount > 0 && (
                              <span className="ml-1 font-normal normal-case">({inc.attachmentCount})</span>
                            )}
                          </p>
                          {hasBeenOpened && <IncidentAttachmentsSection incidentId={inc.id} />}
                        </div>
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          )}

          {/* ── Joined Incidents ─────────────────────────────────── */}
          {(joinedLoading || joinedIncidents.length > 0) && (
            <div className="border-t border-border">
              <div className="px-4 py-3 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-blue-500 shrink-0" />
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Live Incidents Joined
                </p>
                {!joinedLoading && (
                  <span className="ml-auto text-xs text-muted-foreground">{joinedIncidents.length}</span>
                )}
              </div>
              {joinedLoading ? (
                <div className="px-4 pb-3 space-y-2">
                  {[1, 2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : (
                <div className="divide-y divide-border/50">
                  {joinedIncidents.map((ji) => {
                    const cat = getCat(ji.categoryId);
                    const joinedAt = new Date(ji.joinedAt);
                    const leftAt = ji.leftAt ? new Date(ji.leftAt) : null;
                    const arrivedAt = ji.arrivedAt ? new Date(ji.arrivedAt) : null;
                    const durationMs = leftAt ? leftAt.getTime() - joinedAt.getTime() : null;
                    const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                    const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                    const creatorName = [ji.creatorFirstName, ji.creatorLastName].filter(Boolean).join(" ");
                    return (
                      <div key={`${ji.incidentId}-${ji.joinedAt}`} className="px-4 py-3 space-y-2" data-testid={`joined-incident-${ji.incidentId}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 mt-0.5" style={{ backgroundColor: cat?.color ?? "#6B7280" }} />
                            <div>
                              <p className="text-sm font-medium">{cat?.name ?? "Uncategorised"}</p>
                              <p className="text-xs text-muted-foreground">{ji.incidentDate} · {ji.incidentTime}</p>
                            </div>
                          </div>
                          <span className="text-[10px] text-muted-foreground shrink-0">#{ji.incidentId}</span>
                        </div>
                        <div className="grid grid-cols-3 gap-x-3 gap-y-1 pl-4">
                          <div>
                            <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Joined</p>
                            <p className="text-xs">{fmt(joinedAt)}</p>
                          </div>
                          {arrivedAt && (
                            <div>
                              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Arrived</p>
                              <p className="text-xs">{fmt(arrivedAt)}</p>
                            </div>
                          )}
                          {leftAt && (
                            <div>
                              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Left</p>
                              <p className="text-xs">{fmt(leftAt)}{durationMin != null && <span className="text-muted-foreground ml-1">· {durationMin < 1 ? "< 1 min" : `${durationMin} min`}</span>}</p>
                            </div>
                          )}
                          {!leftAt && (
                            <div>
                              <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Status</p>
                              <p className="text-xs text-green-600 dark:text-green-400">Active</p>
                            </div>
                          )}
                        </div>
                        {creatorName && (
                          <p className="text-xs text-muted-foreground pl-4">Created by {creatorName}</p>
                        )}
                        {ji.arrivalNote && (
                          <p className="text-xs text-muted-foreground italic pl-4">"{ji.arrivalNote}"</p>
                        )}
                        {ji.description && (
                          <p className="text-xs text-foreground/70 pl-4 line-clamp-2">{ji.description}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </SheetContent>
      <GeoLocationSheet view={geoMapView} onClose={() => setGeoMapView(null)} />
    </Sheet>
  );
}

function CopyAlertReminderButton({ userId, firstName }: { userId: string; firstName: string }) {
  const [copied, setCopied] = useState(false);
  const appUrl = window.location.origin;
  const reminderUrl = `${appUrl}/enable-alerts`;

  function handleCopy() {
    navigator.clipboard.writeText(reminderUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-[44px] min-w-[44px] touch-manipulation"
      onClick={handleCopy}
      title={`Copy alert-reminder link for ${firstName} — send this link to help them enable notifications`}
      data-testid={`button-copy-alert-reminder-${userId}`}
    >
      {copied
        ? <CheckCheck className="h-4 w-4 text-green-600" />
        : <BellRing className="h-4 w-4 text-amber-500" />}
    </Button>
  );
}

function CopyInviteButton({ userId, firstName, inviteToken }: { userId: string; firstName: string; inviteToken: string }) {
  const [copied, setCopied] = useState(false);
  const appUrl = import.meta.env.VITE_APP_BASE_URL || window.location.origin;
  const inviteUrl = `${appUrl}/invite?token=${inviteToken}`;

  function handleCopy() {
    navigator.clipboard.writeText(inviteUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-[44px] min-w-[44px] touch-manipulation"
      onClick={handleCopy}
      title={`Copy invite link for ${firstName}`}
      data-testid={`button-copy-invite-${userId}`}
    >
      {copied ? <CheckCheck className="h-4 w-4 text-primary" /> : <Link2 className="h-4 w-4 text-primary" />}
    </Button>
  );
}

function UserAvatar({ user, className = "h-8 w-8" }: { user: OrgUser; className?: string }) {
  return (
    <div className={`rounded-full bg-primary/10 flex items-center justify-center overflow-hidden shrink-0 border border-border ${className}`} data-testid={`avatar-user-${user.id}`}>
      {user.avatarUrl ? (
        <img src={user.avatarUrl} alt={user.firstName} className="h-full w-full object-cover" />
      ) : (
        <span className="text-xs font-semibold text-primary select-none">
          {`${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.toUpperCase()}
        </span>
      )}
    </div>
  );
}

function UserStatusBadge({ user }: { user: OrgUser }) {
  if (user.inviteToken) {
    return (
      <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
        Pending
      </Badge>
    );
  }
  return (
    <Badge variant={user.isActive ? "default" : "secondary"} className={user.isActive ? "bg-green-600 dark:bg-green-700" : ""}>
      {user.isActive ? "Active" : "Inactive"}
    </Badge>
  );
}

function UserPushIcon({ user }: { user: OrgUser }) {
  const reg = user.pushRegistration;
  if (user.hasPushSubscription) {
    const via = reg?.fcm && reg?.web
      ? "App (FCM) and browser"
      : reg?.fcm
        ? "App (FCM)"
        : "Browser";
    return (
      <span title={`Push notifications enabled — ${via}`} data-testid={`icon-push-on-${user.id}`} className="inline-flex items-center justify-center">
        <Bell className="h-4 w-4 text-green-600 dark:text-green-400 fill-green-600 dark:fill-green-400" />
      </span>
    );
  }
  return (
    <span
      title="Not registered on server — user may need to open the app and enable alerts (OS permission alone is not enough)"
      data-testid={`icon-push-off-${user.id}`}
      className="inline-flex items-center justify-center"
    >
      <BellOff className="h-4 w-4 text-muted-foreground/40" />
    </span>
  );
}

type UserActionHandlers = {
  onEdit: () => void;
  onAssign: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  onViewIncidents: () => void;
  onAudit: () => void;
};

function UserActionButtons({
  user,
  isSelf,
  showIncidentsAndAudit,
  statusMutationPending,
  className = "justify-end",
  ...handlers
}: {
  user: OrgUser;
  isSelf: boolean;
  showIncidentsAndAudit: boolean;
  statusMutationPending: boolean;
  className?: string;
} & UserActionHandlers) {
  const touchIcon = "min-h-[44px] min-w-[44px] touch-manipulation";
  return (
    <div className={`flex flex-wrap gap-1 ${className}`}>
      <Button variant="ghost" size="icon" className={touchIcon} onClick={handlers.onEdit} title="Edit user" data-testid={`button-edit-user-${user.id}`}>
        <Pencil className="h-4 w-4" />
      </Button>
      {!user.hasPushSubscription && <CopyAlertReminderButton userId={user.id} firstName={user.firstName} />}
      {user.inviteToken && user.inviteTokenExpiresAt && new Date(user.inviteTokenExpiresAt) > new Date() && (
        <CopyInviteButton userId={user.id} firstName={user.firstName} inviteToken={user.inviteToken} />
      )}
      <RegenerateInviteButton userId={user.id} firstName={user.firstName} />
      {(user.role === "supervisor" || user.role === "control_room" || user.role === "access_controller" || user.role === "patrol_user" || user.role === "reporter") && (
        <Button variant="ghost" size="icon" className={touchIcon} onClick={handlers.onAssign} title="Assign locations" data-testid={`button-assign-locations-${user.id}`}>
          <MapPin className="h-4 w-4 text-primary" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={touchIcon}
        disabled={isSelf || statusMutationPending}
        onClick={handlers.onToggleStatus}
        title={user.isActive ? "Deactivate user" : "Activate user"}
        data-testid={`button-toggle-status-${user.id}`}
      >
        {user.isActive ? <ShieldOff className="h-4 w-4 text-amber-500" /> : <ShieldCheck className="h-4 w-4 text-green-600" />}
      </Button>
      <Button variant="ghost" size="icon" className={touchIcon} disabled={isSelf} onClick={handlers.onDelete} title="Delete user" data-testid={`button-delete-user-${user.id}`}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
      {showIncidentsAndAudit && (
        <>
          <Button variant="ghost" size="icon" className={touchIcon} onClick={handlers.onViewIncidents} title="View incidents" data-testid={`button-view-incidents-${user.id}`}>
            <ClipboardList className="h-4 w-4 text-primary" />
          </Button>
          <Button variant="ghost" size="icon" className={touchIcon} onClick={handlers.onAudit} title="Audit trail" data-testid={`button-audit-${user.id}`}>
            <ScrollText className="h-4 w-4" />
          </Button>
        </>
      )}
    </div>
  );
}

function UserMobileCard({
  user,
  isSelf,
  isHighlighted,
  showIncidentsAndAudit,
  statusMutationPending,
  handlers,
}: {
  user: OrgUser;
  isSelf: boolean;
  isHighlighted: boolean;
  showIncidentsAndAudit: boolean;
  statusMutationPending: boolean;
  handlers: UserActionHandlers;
}) {
  return (
    <div
      className={`rounded-lg border bg-card p-4 space-y-3 ${isHighlighted ? "ring-2 ring-primary bg-primary/5" : ""}`}
      data-testid={`card-user-${user.id}`}
    >
      <div className="flex items-start gap-3 min-w-0">
        <UserAvatar user={user} className="h-10 w-10" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-tight">{user.firstName} {user.lastName}</p>
          <p className="text-sm text-muted-foreground truncate">{user.email}</p>
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <Badge variant={roleBadgeVariant(user.role)} className="capitalize text-xs">{user.role}</Badge>
            <UserStatusBadge user={user} />
            <UserPushIcon user={user} />
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground" data-testid={`text-commands-mobile-${user.id}`}>
        <span className="font-medium text-foreground/80">Group: </span>
        {user.commands && user.commands.length > 0
          ? user.commands.map((c) => c.name).join(", ")
          : "None assigned"}
      </div>

      <Button
        className="w-full min-h-[44px] touch-manipulation"
        onClick={handlers.onEdit}
        data-testid={`button-edit-user-mobile-${user.id}`}
      >
        <Pencil className="h-4 w-4 mr-2" />
        Edit user & password
      </Button>

      <UserActionButtons
        user={user}
        isSelf={isSelf}
        showIncidentsAndAudit={showIncidentsAndAudit}
        statusMutationPending={statusMutationPending}
        className="justify-start border-t pt-3"
        {...handlers}
      />
    </div>
  );
}

function RegenerateInviteButton({ userId, firstName }: { userId: string; firstName: string }) {
  const [copied, setCopied] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const appUrl = import.meta.env.VITE_APP_BASE_URL || window.location.origin;

  const regenMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/users/${userId}/regenerate-invite`, {}),
    onSuccess: async (res) => {
      const updated: OrgUser = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      if (updated.inviteToken) {
        const inviteUrl = `${appUrl}/invite?token=${updated.inviteToken}`;
        navigator.clipboard.writeText(inviteUrl).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        });
      }
    },
    onError: (err: Error) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  return (
    <Button
      variant="ghost"
      size="icon"
      className="min-h-[44px] min-w-[44px] touch-manipulation"
      onClick={() => regenMutation.mutate()}
      disabled={regenMutation.isPending}
      title={`Generate invite link for ${firstName}`}
      data-testid={`button-regen-invite-${userId}`}
    >
      {copied
        ? <CheckCheck className="h-4 w-4 text-primary" />
        : <RefreshCw className={`h-4 w-4 text-muted-foreground ${regenMutation.isPending ? "animate-spin" : ""}`} />}
    </Button>
  );
}

export default function UserAdminPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editUser, setEditUser] = useState<OrgUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrgUser | null>(null);
  const [assignTarget, setAssignTarget] = useState<OrgUser | null>(null);
  const [auditTarget, setAuditTarget] = useState<OrgUser | null>(null);
  const [viewIncidentsTarget, setViewIncidentsTarget] = useState<OrgUser | null>(null);
  const [highlightedUserId, setHighlightedUserId] = useState<string | null>(null);

  // Auto-clear highlight after 4 seconds.
  useEffect(() => {
    if (!highlightedUserId) return;
    const t = setTimeout(() => setHighlightedUserId(null), 4000);
    return () => clearTimeout(t);
  }, [highlightedUserId]);

  // Scroll the highlighted row into view whenever it changes.
  useEffect(() => {
    if (!highlightedUserId) return;
    const row = document.querySelector(
      `[data-testid="row-user-${highlightedUserId}"], [data-testid="card-user-${highlightedUserId}"]`,
    );
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightedUserId]);

  function handleHighlightUser(userId: string) {
    setDialogOpen(false);
    setEditUser(null);
    setHighlightedUserId(userId);
  }

  const { data: currentUser } = useQuery<{ id: string; role: string; orgName: string | null }>({ queryKey: ["/api/auth/me"] });
  const { data: users = [], isLoading } = useQuery<OrgUser[]>({ queryKey: ["/api/users"], refetchInterval: 15000 });
  const { data: commands = [] } = useQuery<OrgCommand[]>({ queryKey: ["/api/commands"] });
  const { data: myCommands } = useQuery<{ commands: OrgCommand[]; activeCommandId: number | "all" | null }>({
    queryKey: ["/api/me/commands"],
  });
  // Default Command for the Add User dialog: the admin's currently active
  // Command if it's a real id; otherwise the first available Command. Never
  // auto-falls back to Central — the admin must confirm by submitting.
  const defaultCommandId: number | null =
    typeof myCommands?.activeCommandId === "number"
      ? myCommands.activeCommandId
      : (commands[0]?.id ?? null);
  const usersWithoutCommand = users.filter((u) => (u.commands?.length ?? 0) === 0);

  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      apiRequest("PATCH", `/api/users/${id}/status`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/users/${id}`, undefined),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/users"] });
      toast({ title: "User deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
      setDeleteTarget(null);
    },
  });

  function openAdd() {
    setEditUser(null);
    setDialogOpen(true);
  }

  function openEdit(user: OrgUser) {
    setEditUser(user);
    setDialogOpen(true);
  }

  const showIncidentsAndAudit = currentUser?.role === "administrator" || currentUser?.role === "supervisor";

  function userHandlers(user: OrgUser): UserActionHandlers {
    return {
      onEdit: () => openEdit(user),
      onAssign: () => setAssignTarget(user),
      onToggleStatus: () => statusMutation.mutate({ id: user.id, isActive: !user.isActive }),
      onDelete: () => setDeleteTarget(user),
      onViewIncidents: () => setViewIncidentsTarget(user),
      onAudit: () => setAuditTarget(user),
    };
  }

  return (
    <div className="p-4 sm:p-6 space-y-4 sm:space-y-6 overflow-y-auto h-full min-h-0 pb-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight" data-testid="text-user-admin-title">
            <Users className="inline h-6 w-6 mr-2 -mt-0.5" />
            User Admin
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage users within your organization
          </p>
        </div>
        <Button onClick={openAdd} className="w-full sm:w-auto shrink-0 min-h-[44px] touch-manipulation" data-testid="button-add-user">
          <Plus className="h-4 w-4 mr-2" />
          Add User
        </Button>
      </div>

      {usersWithoutCommand.length > 0 && (
        <div
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm"
          data-testid="banner-users-without-command"
        >
          <p className="font-medium text-amber-700 dark:text-amber-400">
            ⚠ {usersWithoutCommand.length} user{usersWithoutCommand.length === 1 ? "" : "s"} not assigned to any Group
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {usersWithoutCommand.map((u) => `${u.firstName} ${u.lastName}`).join(", ")}
            {" "}— they can't raise a panic or have their incidents scoped until you assign a Group.
            Tap <strong>Edit user & password</strong> on each one and tick a Group.
          </p>
        </div>
      )}

      {/* Mobile: card layout with all actions visible */}
      <div className="lg:hidden space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-44 w-full rounded-lg" />)
        ) : users.length === 0 ? (
          <div className="rounded-lg border px-4 py-8 text-center text-muted-foreground text-sm">
            No users yet. Tap "Add User" to create one.
          </div>
        ) : (
          users.map((user) => (
            <UserMobileCard
              key={user.id}
              user={user}
              isSelf={user.id === currentUser?.id}
              isHighlighted={highlightedUserId === user.id}
              showIncidentsAndAudit={!!showIncidentsAndAudit}
              statusMutationPending={statusMutation.isPending}
              handlers={userHandlers(user)}
            />
          ))
        )}
      </div>

      {/* Desktop: full table */}
      <div className="hidden lg:block border rounded-lg overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Name</th>
              <th className="text-left px-4 py-3 font-medium">Email</th>
              <th className="text-left px-4 py-3 font-medium">Role</th>
              <th className="text-left px-4 py-3 font-medium">Group</th>
              <th className="text-left px-4 py-3 font-medium">Status</th>
              <th className="text-center px-4 py-3 font-medium" title="Push notification status">Alerts</th>
              <th className="text-right px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <tr key={i} className="border-b last:border-0">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3">
                      <Skeleton className="h-4 w-full" />
                    </td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No users yet. Click "Add User" to create one.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isSelf = user.id === currentUser?.id;
                const isHighlighted = highlightedUserId === user.id;
                return (
                  <tr
                    key={user.id}
                    className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${isHighlighted ? "ring-2 ring-inset ring-primary bg-primary/5" : ""}`}
                    data-testid={`row-user-${user.id}`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar user={user} />
                        <span className="font-medium">{user.firstName} {user.lastName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{user.email}</td>
                    <td className="px-4 py-3">
                      <Badge variant={roleBadgeVariant(user.role)} className="capitalize">
                        {user.role}
                      </Badge>
                    </td>
                    <td className="px-4 py-3" data-testid={`text-commands-${user.id}`}>
                      {user.commands && user.commands.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {user.commands.map((c) => (
                            <Badge key={c.id} variant="outline" className="font-normal">
                              {c.name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <Badge variant="outline" className="border-amber-500 text-amber-600 dark:text-amber-400">
                          None
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <UserStatusBadge user={user} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <UserPushIcon user={user} />
                    </td>
                    <td className="px-4 py-3">
                      <UserActionButtons
                        user={user}
                        isSelf={isSelf}
                        showIncidentsAndAudit={!!showIncidentsAndAudit}
                        statusMutationPending={statusMutation.isPending}
                        {...userHandlers(user)}
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <UserDialog
        open={dialogOpen}
        onClose={() => { setDialogOpen(false); setEditUser(null); }}
        editUser={editUser}
        currentUserId={currentUser?.id ?? ""}
        orgName={currentUser?.orgName ?? null}
        onHighlightUser={handleHighlightUser}
        commands={commands}
        defaultCommandId={defaultCommandId}
      />

      <LocationAssignDialog
        user={assignTarget}
        onClose={() => setAssignTarget(null)}
      />

      <AuditTrailDialog
        user={auditTarget}
        onClose={() => setAuditTarget(null)}
      />

      <UserIncidentsSheet
        user={viewIncidentsTarget}
        onClose={() => setViewIncidentsTarget(null)}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.firstName} {deleteTarget?.lastName}</strong>. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              data-testid="button-confirm-delete-user"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
