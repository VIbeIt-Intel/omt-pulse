import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Shield, Plus, Pencil, Trash2, Users as UsersIcon, Star, Eye, ArrowRight, X, MapPin } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PageHero } from "@/components/page-hero";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  GroupSiteLocationPicker,
  emptyGroupSiteLocation,
  type GroupSiteLocationValue,
} from "@/components/group-site-location-picker";

type Command = {
  id: number;
  organizationId: string;
  name: string;
  isCentral: boolean;
  createdAt: string;
  memberCount: number;
  primarySite?: {
    id: number;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
  } | null;
};

type OrgUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
};

type Member = { userId: string; firstName: string; lastName: string; email: string; role: string };

const siteFormSchema = z.object({
  siteName: z.string().max(120),
  address: z.string().max(500),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

const groupFormSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  site: siteFormSchema,
});
type GroupForm = z.infer<typeof groupFormSchema>;

function sitePayload(site: GroupSiteLocationValue) {
  if (!site.address.trim() && site.latitude == null && site.longitude == null) return undefined;
  return {
    siteName: site.siteName.trim() || undefined,
    address: site.address.trim() || null,
    latitude: site.latitude,
    longitude: site.longitude,
  };
}

function siteFromPrimary(
  primarySite: Command["primarySite"],
  groupName: string,
): GroupSiteLocationValue {
  return {
    siteName: primarySite?.name ?? groupName,
    address: primarySite?.address ?? "",
    latitude: primarySite?.latitude ?? null,
    longitude: primarySite?.longitude ?? null,
  };
}

export default function CommandsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Command | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Command | null>(null);
  const [membersTarget, setMembersTarget] = useState<Command | null>(null);

  const { data: commands = [], isLoading } = useQuery<Command[]>({ queryKey: ["/api/commands"] });

  const createForm = useForm<GroupForm>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: "", site: emptyGroupSiteLocation() },
  });
  const editForm = useForm<GroupForm>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: "", site: emptyGroupSiteLocation() },
  });

  const createNameWatch = createForm.watch("name");

  const createMutation = useMutation({
    mutationFn: (values: GroupForm) =>
      apiRequest("POST", "/api/commands", { name: values.name, site: sitePayload(values.site) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Group created" });
      setCreateOpen(false);
      createForm.reset({ name: "", site: emptyGroupSiteLocation() });
    },
    onError: (err: Error) => toast({ title: "Could not create", description: err.message, variant: "destructive" }),
  });

  const editMutation = useMutation({
    mutationFn: ({ id, values, isCentral }: { id: number; values: GroupForm; isCentral: boolean }) =>
      apiRequest("PATCH", `/api/commands/${id}`, {
        ...(isCentral ? {} : { name: values.name }),
        site: sitePayload(values.site),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Group updated" });
      setEditTarget(null);
    },
    onError: (err: Error) => toast({ title: "Could not update", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/commands/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/commands"] });
      toast({ title: "Group deleted" });
      setDeleteTarget(null);
    },
    onError: (err: Error) => toast({ title: "Could not delete", description: err.message, variant: "destructive" }),
  });

  function openEdit(c: Command) {
    editForm.reset({
      name: c.name,
      site: siteFromPrimary(c.primarySite, c.name),
    });
    setEditTarget(c);
  }

  const totalMembers = commands.reduce((sum, c) => sum + (c.memberCount || 0), 0);
  const customCount = commands.filter((c) => !c.isCentral).length;

  return (
    <div className="h-full overflow-y-auto">
    <div className="container max-w-6xl px-4 sm:px-6 py-4 sm:py-8 space-y-6" data-testid="page-commands">
      <PageHero
        eyebrow="Groups"
        badge="Admin"
        total={commands.length}
        totalLabel={commands.length === 1 ? "Group" : "Groups"}
        titleTestId="heading-commands"
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            size="sm"
            className="w-full sm:w-auto sm:shrink-0 h-8"
            data-testid="button-create-command"
          >
            <Plus className="h-4 w-4 mr-2" /> New Group
          </Button>
        }
        insights={[
          { label: "Custom", value: String(customCount) },
          { label: "Members", value: String(totalMembers) },
        ]}
      />

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      ) : commands.length === 0 ? (
        <Card className="p-10 text-center">
          <div className="mx-auto h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-3">
            <Shield className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">No Groups yet</p>
          <p className="text-xs text-muted-foreground mt-1">Create your first Group to get started.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
          {commands.map((c) => (
            <Card
              key={c.id}
              className="p-4 sm:p-5 flex flex-col gap-4 hover-elevate active-elevate-2 transition-shadow"
              data-testid={`card-command-${c.id}`}
            >
              <div className="flex items-start gap-3 min-w-0">
                <div
                  className={`shrink-0 h-10 w-10 rounded-lg flex items-center justify-center ${
                    c.isCentral
                      ? "bg-primary/15 text-primary"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {c.isCentral ? <Star className="h-5 w-5" /> : <Shield className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3
                      className="font-semibold truncate"
                      data-testid={`text-command-name-${c.id}`}
                    >
                      {c.name}
                    </h3>
                    {c.isCentral && (
                      <Badge variant="default" className="shrink-0 gap-1 text-[10px] h-5 px-1.5">
                        <Star className="h-3 w-3" /> Central
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1.5">
                    <UsersIcon className="h-3 w-3" />
                    <span data-testid={`text-member-count-${c.id}`}>
                      {c.memberCount} {c.memberCount === 1 ? "member" : "members"}
                    </span>
                  </p>
                  {c.primarySite?.address && (
                    <p className="text-xs text-muted-foreground mt-1.5 flex items-start gap-1.5 line-clamp-2">
                      <MapPin className="h-3 w-3 shrink-0 mt-0.5" />
                      <span data-testid={`text-command-site-${c.id}`}>{c.primarySite.address}</span>
                    </p>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mt-auto pt-2 border-t">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setMembersTarget(c)}
                  data-testid={`button-members-${c.id}`}
                >
                  <UsersIcon className="h-3.5 w-3.5 mr-1.5" /> Members
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => openEdit(c)}
                  aria-label="Edit Group"
                  data-testid={`button-edit-${c.id}`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                {!c.isCentral && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setDeleteTarget(c)}
                    aria-label="Delete Group"
                    data-testid={`button-delete-${c.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" data-testid="dialog-create-command">
          <DialogHeader><DialogTitle>New Group</DialogTitle></DialogHeader>
          <Form {...createForm}>
            <form onSubmit={createForm.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={createForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Group name</FormLabel>
                  <FormControl><Input placeholder="e.g. Site A" {...field} data-testid="input-command-name" /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={createForm.control} name="site" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <GroupSiteLocationPicker
                      value={field.value}
                      onChange={field.onChange}
                      groupNameHint={createNameWatch}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending} data-testid="button-submit-command">Create</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog open={!!editTarget} onOpenChange={(v) => !v && setEditTarget(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editTarget?.isCentral ? "Edit Central Command premises" : "Edit Group"}</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form
              onSubmit={editForm.handleSubmit((v) =>
                editTarget && editMutation.mutate({ id: editTarget.id, values: v, isCentral: editTarget.isCentral }),
              )}
              className="space-y-4"
            >
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Group name</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={editTarget?.isCentral} data-testid="input-edit-command-name" />
                  </FormControl>
                  {editTarget?.isCentral && (
                    <p className="text-xs text-muted-foreground">Central Command cannot be renamed.</p>
                  )}
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={editForm.control} name="site" render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <GroupSiteLocationPicker
                      value={field.value}
                      onChange={field.onChange}
                      groupNameHint={editForm.watch("name")}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button type="submit" disabled={editMutation.isPending}>Save</Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Members will be unassigned but their accounts remain. Any incidents/categories/locations linked to this Group will keep their data but lose the Group tag.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)} className="bg-destructive text-destructive-foreground" data-testid="button-confirm-delete">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Members management */}
      {membersTarget && (
        <MembersDialog
          command={membersTarget}
          onClose={() => { setMembersTarget(null); qc.invalidateQueries({ queryKey: ["/api/commands"] }); }}
        />
      )}

      {/* Cross-Group visibility grants */}
      <VisibilityGrantsSection commands={commands} />
    </div>
    </div>
  );
}

type VisibilityGrant = {
  id: number;
  granteeCommandId: number;
  granterCommandId: number;
  scope: string;
  granteeName: string;
  granterName: string;
  createdAt: string;
};

function VisibilityGrantsSection({ commands }: { commands: Command[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [granteeId, setGranteeId] = useState<string>("");
  const [granterId, setGranterId] = useState<string>("");

  const { data: grants = [], isLoading } = useQuery<VisibilityGrant[]>({
    queryKey: ["/api/commands/visibility-grants"],
  });

  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/commands/visibility-grants", {
      granteeCommandId: Number(granteeId),
      granterCommandId: Number(granterId),
      scope: "read",
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commands/visibility-grants"] });
      toast({ title: "Visibility grant created" });
      setGranteeId("");
      setGranterId("");
    },
    onError: (err: Error) => toast({ title: "Could not grant visibility", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/commands/visibility-grants/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/commands/visibility-grants"] });
      toast({ title: "Visibility revoked" });
    },
    onError: (err: Error) => toast({ title: "Could not revoke", description: err.message, variant: "destructive" }),
  });

  const canSubmit =
    granteeId !== "" && granterId !== "" && granteeId !== granterId && !createMutation.isPending;

  return (
    <Card className="p-5 sm:p-6 space-y-4" data-testid="card-visibility-grants">
      <div className="flex items-start gap-3">
        <div className="shrink-0 h-10 w-10 rounded-lg bg-primary/15 text-primary flex items-center justify-center">
          <Eye className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Cross-Group Visibility</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Let one Group read another Group's incidents, locations, categories and form fields.
            Members of the grantee Group see the grantor's data alongside their own.
          </p>
        </div>
      </div>

      {/* Create */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr_auto] gap-2 items-end">
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Grantee (sees data)</label>
          <Select value={granteeId} onValueChange={setGranteeId}>
            <SelectTrigger data-testid="select-grantee"><SelectValue placeholder="Select Group" /></SelectTrigger>
            <SelectContent>
              {commands.map(c => (
                <SelectItem key={c.id} value={String(c.id)} data-testid={`option-grantee-${c.id}`}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="hidden sm:flex justify-center pb-2 text-muted-foreground"><ArrowRight className="h-4 w-4" /></div>
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Grantor (data source)</label>
          <Select value={granterId} onValueChange={setGranterId}>
            <SelectTrigger data-testid="select-grantor"><SelectValue placeholder="Select Group" /></SelectTrigger>
            <SelectContent>
              {commands.filter(c => String(c.id) !== granteeId).map(c => (
                <SelectItem key={c.id} value={String(c.id)} data-testid={`option-grantor-${c.id}`}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit}
          data-testid="button-add-grant"
        >
          <Plus className="h-4 w-4 mr-1" /> Add
        </Button>
      </div>

      {/* List */}
      <div className="space-y-1.5">
        {isLoading ? (
          <Skeleton className="h-12" />
        ) : grants.length === 0 ? (
          <p className="text-sm text-muted-foreground py-3 text-center" data-testid="text-no-grants">
            No visibility grants yet.
          </p>
        ) : (
          grants.map(g => (
            <div
              key={g.id}
              className="flex items-center gap-3 p-2.5 rounded-md border bg-card/60"
              data-testid={`row-grant-${g.id}`}
            >
              <Badge variant="outline" className="font-medium">{g.granteeName}</Badge>
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                can read <ArrowRight className="h-3 w-3" />
              </span>
              <Badge variant="secondary">{g.granterName}</Badge>
              <Button
                size="icon"
                variant="ghost"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => deleteMutation.mutate(g.id)}
                disabled={deleteMutation.isPending}
                aria-label="Revoke grant"
                data-testid={`button-revoke-grant-${g.id}`}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function MembersDialog({ command, onClose }: { command: Command; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: members = [], isLoading: membersLoading } = useQuery<Member[]>({
    queryKey: ["/api/commands", command.id, "members"],
  });
  const { data: orgUsers = [], isLoading: usersLoading } = useQuery<OrgUser[]>({ queryKey: ["/api/users"] });

  const memberIds = new Set(members.map((m) => m.userId));

  const assignMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("POST", `/api/commands/${command.id}/members/${userId}`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commands", command.id, "members"] }),
    onError: (err: Error) => toast({ title: "Failed to add member", description: err.message, variant: "destructive" }),
  });
  const removeMutation = useMutation({
    mutationFn: (userId: string) => apiRequest("DELETE", `/api/commands/${command.id}/members/${userId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/commands", command.id, "members"] }),
    onError: (err: Error) => toast({ title: "Failed to remove member", description: err.message, variant: "destructive" }),
  });

  function toggle(userId: string, checked: boolean) {
    if (command.isCentral && !checked) {
      toast({ title: "Cannot remove", description: "Central Group members are managed automatically.", variant: "destructive" });
      return;
    }
    if (checked) assignMutation.mutate(userId);
    else removeMutation.mutate(userId);
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg" data-testid="dialog-members">
        <DialogHeader>
          <DialogTitle>Members of "{command.name}"</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto -mx-6 px-6">
          {(membersLoading || usersLoading) ? (
            <div className="space-y-2 py-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : orgUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No users in your organisation yet.</p>
          ) : (
            <div className="space-y-1">
              {orgUsers.filter(u => u.isActive).map((u) => {
                const assigned = memberIds.has(u.id);
                return (
                  <label key={u.id} className="flex items-center gap-3 py-2 px-2 rounded hover:bg-muted/50 cursor-pointer" data-testid={`row-user-${u.id}`}>
                    <Checkbox
                      checked={assigned}
                      onCheckedChange={(c) => toggle(u.id, !!c)}
                      disabled={command.isCentral || assignMutation.isPending || removeMutation.isPending}
                      data-testid={`checkbox-user-${u.id}`}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{u.firstName} {u.lastName}</p>
                      <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                    </div>
                    <Badge variant="outline" className="text-xs capitalize shrink-0">{u.role}</Badge>
                  </label>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
