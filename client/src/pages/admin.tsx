import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import {
  isManualIncidentType,
  isSystemResponseMode,
  groupManualIncidentTypes,
  SYSTEM_MODE_DESCRIPTIONS,
  uniqueSystemResponseModes,
  type SeverityGroupKey,
} from "@/lib/incident-categories";
import "leaflet/dist/leaflet.css";
import { INCIDENT_ICONS, getIconSvg } from "@/lib/incident-icons";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FormField, Location, Category } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Pencil, Trash2, Settings, ListChecks, Eye, EyeOff, MapPin, ChevronDown, ChevronUp, Tag, X, Radio, Camera, Image as ImageIcon } from "lucide-react";
import { prepareAndUploadFile } from "@/lib/upload-media";
import { useAuthedMediaUrl } from "@/lib/authed-media";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { GoogleAddressPinPicker } from "@/components/google-address-pin-picker";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

const fieldTypeLabels: Record<string, string> = {
  text: "Text",
  number: "Number",
  textarea: "Text Area",
  select: "Dropdown",
  file: "File Upload",
  date: "Date",
  time: "Time",
  location: "Location",
};

function FormFieldManager() {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [fieldType, setFieldType] = useState("textarea");
  const [isRequired, setIsRequired] = useState(false);
  const [options, setOptions] = useState("");

  const { data: fields = [], isLoading } = useQuery<FormField[]>({
    queryKey: ["/api/form-fields"],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const fieldKey = editingId
        ? fields.find((f) => f.id === editingId)?.fieldKey || ""
        : "custom_" + label.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_");
      const maxOrder = fields.reduce((max, f) => Math.max(max, f.sortOrder), 0);
      const data: any = {
        label,
        fieldType,
        isRequired,
        options: fieldType === "select" ? options : null,
      };
      if (editingId) {
        return apiRequest("PATCH", `/api/form-fields/${editingId}`, data);
      }
      return apiRequest("POST", "/api/form-fields", {
        ...data,
        fieldKey,
        isSystem: false,
        isVisible: true,
        sortOrder: maxOrder + 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/form-fields"] });
      toast({ title: editingId ? "Field updated" : "Custom field created" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const toggleVisibility = useMutation({
    mutationFn: async ({ id, isVisible }: { id: number; isVisible: boolean }) => {
      return apiRequest("PATCH", `/api/form-fields/${id}`, { isVisible });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/form-fields"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/form-fields/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/form-fields"] });
      toast({ title: "Custom field deleted" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setLabel("");
    setFieldType("text");
    setIsRequired(false);
    setOptions("");
  };

  const openEdit = (field: FormField) => {
    setEditingId(field.id);
    setLabel(field.label);
    setFieldType(field.fieldType);
    setIsRequired(field.isRequired);
    setOptions(field.options || "");
    setDialogOpen(true);
  };

  return (
    <>
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="header-form-fields"
        >
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="h-4 w-4" />
              Form Fields Configuration
            </CardTitle>
            <div className="flex items-center gap-2">
              {!collapsed && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }} data-testid="button-add-field">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Custom Field
                </Button>
              )}
              {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {!collapsed && <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : fields.length === 0 ? (
            <div className="p-8 text-center">
              <ListChecks className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No form fields configured.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Label</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Required</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field) => (
                  <TableRow key={field.id} data-testid={`row-field-${field.id}`}>
                    <TableCell className="font-medium">{field.label}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {fieldTypeLabels[field.fieldType] || field.fieldType}
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${field.isRequired ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {field.isRequired ? "Required" : "Optional"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => toggleVisibility.mutate({ id: field.id, isVisible: !field.isVisible })}
                          className="p-1 rounded hover:bg-muted transition-colors"
                          title={field.isVisible ? "Hide field" : "Show field"}
                          data-testid={`button-toggle-visibility-${field.id}`}
                        >
                          {field.isVisible ? (
                            <Eye className="h-4 w-4 text-green-600 dark:text-green-400" />
                          ) : (
                            <EyeOff className="h-4 w-4 text-muted-foreground" />
                          )}
                        </button>
                        {!field.isSystem && (
                          <Button size="icon" variant="ghost" onClick={() => openEdit(field)} data-testid={`button-edit-field-${field.id}`}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!["incidentDate", "incidentTime", "location", "categoryId"].includes(field.fieldKey) && (
                          <Button size="icon" variant="ghost" onClick={() => setDeleteId(field.id)} data-testid={`button-delete-field-${field.id}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>}
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit Custom Field" : "Add Custom Field"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Label</Label>
              <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Witness Name" data-testid="input-field-label" />
            </div>
            <div>
              <Label>Field Type</Label>
              <Select onValueChange={setFieldType} value={fieldType}>
                <SelectTrigger data-testid="select-field-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="textarea">Text Area</SelectItem>
                  <SelectItem value="select">Dropdown</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {fieldType === "select" && (
              <div>
                <Label>Options (comma-separated)</Label>
                <Input value={options} onChange={(e) => setOptions(e.target.value)} placeholder="e.g. Option A, Option B, Option C" data-testid="input-field-options" />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={isRequired} onCheckedChange={setIsRequired} data-testid="switch-field-required" />
              <Label>Required field</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-field">Cancel</Button>
              <Button onClick={() => createMutation.mutate()} disabled={!label.trim() || createMutation.isPending} data-testid="button-save-field">
                {createMutation.isPending ? "Saving..." : editingId ? "Update" : "Create"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Field</AlertDialogTitle>
            <AlertDialogDescription>This will remove the field from the incident form. Existing data for this field will be preserved. Continue?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function PredefinedTypesManager() {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#3B82F6");
  const [icon, setIcon] = useState("alert");
  const [isOther, setIsOther] = useState(false);
  const [severity, setSeverity] = useState<string | null>(null);

  const { data: categories = [], isLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setName("");
    setColor("#3B82F6");
    setIcon("alert");
    setIsOther(false);
    setSeverity(null);
  };

  const openAdd = () => {
    setEditingId(null);
    setName("");
    setColor("#3B82F6");
    setIcon("alert");
    setIsOther(false);
    setSeverity(null);
    setDialogOpen(true);
  };

  const openEdit = (cat: Category) => {
    setEditingId(cat.id);
    setName(cat.name);
    setColor(cat.color || "#3B82F6");
    setIcon(cat.icon || "alert");
    setIsOther(cat.isOther ?? false);
    setSeverity(cat.severity ?? null);
    setDialogOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/categories", { name, description: null, color, icon, isOther, severity: severity || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Type added" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/categories/${editingId}`, { name, color, icon, isOther, severity: severity || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Type updated" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/categories/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      toast({ title: "Type deleted" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const isSaving = createMutation.isPending || updateMutation.isPending;

  const incidentTypeGroups = useMemo(
    () => groupManualIncidentTypes(categories),
    [categories],
  );
  const incidentTypes = useMemo(
    () => incidentTypeGroups.flatMap((g) => g.types),
    [incidentTypeGroups],
  );
  const systemModes = useMemo(
    () => uniqueSystemResponseModes(categories),
    [categories],
  );
  const hasCommandScopedModes = categories.filter(isSystemResponseMode).length > systemModes.length;

  const renderTypeSwatch = (cat: Category) => (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center shadow-sm"
      style={{ backgroundColor: cat.color || "#3B82F6" }}
      data-testid={`swatch-type-${cat.id}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="white"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        dangerouslySetInnerHTML={{ __html: getIconSvg(cat.icon) }}
      />
    </div>
  );

  const severityGroupHeaderClass = (key: SeverityGroupKey) => {
    switch (key) {
      case "high":
        return "bg-red-500/10 text-red-800 dark:text-red-300";
      case "medium":
        return "bg-orange-500/10 text-orange-800 dark:text-orange-300";
      case "low":
        return "bg-yellow-400/15 text-yellow-800 dark:text-yellow-300";
      case "other":
        return "bg-amber-500/10 text-amber-800 dark:text-amber-300";
      default:
        return "bg-muted/60 text-muted-foreground";
    }
  };

  const severityGroupEmoji = (key: SeverityGroupKey) => {
    switch (key) {
      case "high": return "🔴";
      case "medium": return "🟠";
      case "low": return "🟡";
      default: return null;
    }
  };

  const renderTypeRow = (cat: Category) => (
    <TableRow key={cat.id} data-testid={`row-type-${cat.id}`}>
      <TableCell>{renderTypeSwatch(cat)}</TableCell>
      <TableCell className="font-medium">
        <span className="flex items-center gap-2">
          {cat.name}
          {cat.isOther && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" data-testid={`badge-other-${cat.id}`}>
              Other
            </span>
          )}
        </span>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          <Button size="icon" variant="ghost" onClick={() => openEdit(cat)} data-testid={`button-edit-type-${cat.id}`}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" onClick={() => setDeleteId(cat.id)} data-testid={`button-delete-type-${cat.id}`}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="header-types"
        >
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="h-4 w-4" />
              Incident Types
            </CardTitle>
            <div className="flex items-center gap-2">
              {!collapsed && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); openAdd(); }} data-testid="button-add-type">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Type
                </Button>
              )}
              {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
          {!collapsed && (
            <p className="text-sm text-muted-foreground font-normal mt-1">
              Classifications for logging incidents — Criminal, Medical, Other, etc.
            </p>
          )}
        </CardHeader>
        {!collapsed && <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : incidentTypes.length === 0 ? (
            <div className="p-8 text-center">
              <Tag className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No incident types yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Colour</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {incidentTypeGroups.map((group) => (
                  <Fragment key={group.key}>
                    <TableRow
                      className="hover:bg-transparent border-t border-border/60"
                      data-testid={`row-type-group-${group.key}`}
                    >
                      <TableCell colSpan={3} className="py-2 px-4">
                        <div className={`rounded-md px-3 py-1.5 flex items-center justify-between gap-2 ${severityGroupHeaderClass(group.key)}`}>
                          <span className="text-xs font-semibold uppercase tracking-wider flex items-center gap-1.5">
                            {severityGroupEmoji(group.key) && <span aria-hidden>{severityGroupEmoji(group.key)}</span>}
                            {group.label}
                            <span className="font-normal normal-case tracking-normal text-muted-foreground">
                              ({group.types.length})
                            </span>
                          </span>
                          <span className="text-[10px] font-normal normal-case tracking-normal opacity-80 hidden sm:inline">
                            {group.hint}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                    {group.types.map(renderTypeRow)}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>}
      </Card>

      <Card className="mt-4">
        <CardHeader data-testid="header-system-modes">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radio className="h-4 w-4" />
            Built-in Response Modes
          </CardTitle>
          <p className="text-sm text-muted-foreground font-normal mt-1">
            Platform-managed — triggered by the panic button or live incident flow, not selected when logging manually.
          </p>
        </CardHeader>
        <CardContent className="p-0 pb-2">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : systemModes.length === 0 ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">
              Created automatically when panic or live incident is first used.
            </div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Colour</TableHead>
                    <TableHead>Mode</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {systemModes.map((cat) => (
                    <TableRow key={cat.id} data-testid={`row-system-mode-${cat.id}`}>
                      <TableCell>{renderTypeSwatch(cat)}</TableCell>
                      <TableCell>
                        <div className="font-medium flex items-center gap-2">
                          {cat.name}
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary/10 text-primary dark:bg-primary/20" data-testid={`badge-system-${cat.id}`}>
                            System
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {SYSTEM_MODE_DESCRIPTIONS[cat.name] ?? "Platform-managed response mode"}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {hasCommandScopedModes && (
                <p className="text-xs text-muted-foreground px-6 pt-2">
                  Multiple commands may each have their own system mode records — behaviour is the same.
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId != null ? "Edit Type" : "Add Type"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Primary Type <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Criminal" data-testid="input-type-name" />
            </div>
            <div>
              <Label>Colour</Label>
              <div className="flex items-center gap-3 mt-1.5">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-10 rounded-md border border-input cursor-pointer p-0.5 bg-background"
                  data-testid="input-type-color"
                />
                <span className="text-sm font-mono text-muted-foreground" data-testid="text-type-color-value">{color}</span>
                <span
                  className="inline-block w-6 h-6 rounded-full border border-border shadow-sm"
                  style={{ backgroundColor: color }}
                />
              </div>
            </div>
            <div>
              <Label>Map Icon</Label>
              <div className="grid grid-cols-5 gap-1.5 mt-1.5 max-h-52 overflow-y-auto pr-1" data-testid="icon-picker">
                {INCIDENT_ICONS.map((ic) => (
                  <button
                    key={ic.key}
                    type="button"
                    onClick={() => setIcon(ic.key)}
                    title={ic.label}
                    data-testid={`icon-option-${ic.key}`}
                    className={`flex flex-col items-center gap-1 rounded-md p-2 border transition-all text-xs ${
                      icon === ic.key
                        ? "border-2 bg-muted shadow-sm"
                        : "border-border hover:bg-muted/50"
                    }`}
                    style={{ borderColor: icon === ic.key ? color : undefined }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: icon === ic.key ? color : "hsl(var(--muted))" }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={icon === ic.key ? "white" : "currentColor"}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        dangerouslySetInnerHTML={{ __html: ic.svg }}
                      />
                    </div>
                    <span className="leading-none text-muted-foreground truncate w-full text-center">{ic.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Alert Severity</Label>
              <p className="text-xs text-muted-foreground mb-2">Controls which users are notified when this category is used in a live incident.</p>
              <div className="flex gap-2">
                {([
                  { value: "red", label: "🔴 Red", title: "All users notified", cls: "border-red-500 bg-red-500/10 text-red-700 dark:text-red-400" },
                  { value: "orange", label: "🟠 Orange", title: "Admins & supervisors notified", cls: "border-orange-500 bg-orange-500/10 text-orange-700 dark:text-orange-400" },
                  { value: "yellow", label: "🟡 Yellow", title: "No push notification", cls: "border-yellow-400 bg-yellow-400/10 text-yellow-700 dark:text-yellow-400" },
                ] as const).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    title={opt.title}
                    data-testid={`button-severity-${opt.value}`}
                    onClick={() => setSeverity(severity === opt.value ? null : opt.value)}
                    className={`flex-1 rounded-md border-2 px-2 py-1.5 text-xs font-semibold transition-all ${
                      severity === opt.value
                        ? opt.cls
                        : "border-border text-muted-foreground hover:border-muted-foreground/50"
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
                {severity && (
                  <button
                    type="button"
                    onClick={() => setSeverity(null)}
                    className="rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
                    title="Remove severity"
                    data-testid="button-severity-none"
                  >
                    None
                  </button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch checked={isOther} onCheckedChange={setIsOther} id="switch-is-other" data-testid="switch-is-other" />
              <Label htmlFor="switch-is-other" className="cursor-pointer">
                Mark as "Other" (allows free-text type specification)
              </Label>
            </div>
            {isOther && (
              <p className="text-xs text-muted-foreground -mt-1">
                Only one category can be marked as "Other". Setting this will unmark any previously designated "Other" category.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-type">Cancel</Button>
              <Button
                onClick={() => editingId != null ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!name.trim() || isSaving}
                data-testid="button-save-type"
              >
                {isSaving ? "Saving..." : editingId != null ? "Save Changes" : "Add Type"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Type</AlertDialogTitle>
            <AlertDialogDescription>This will remove the type from your incident types list. Existing incidents that reference this type will be unaffected. Continue?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} data-testid="button-confirm-delete-type">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function LocationSitePhoto({
  photoUrl,
  className,
}: {
  photoUrl: string | null | undefined;
  className?: string;
}) {
  const { src, loading, error } = useAuthedMediaUrl(photoUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const show = Boolean(src) && !error && src !== failedSrc;

  function clampZoom(value: number) {
    return Math.max(1, Math.min(4, Math.round(value * 100) / 100));
  }

  if (!show) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/40", className, loading && "animate-pulse")}>
        <ImageIcon className="h-4 w-4 text-muted-foreground/50" />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="block cursor-zoom-in focus:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          setZoom(1);
          setOpen(true);
        }}
        aria-label="View site photo"
      >
        <img
          src={src!}
          alt=""
          className={cn("object-cover", className)}
          onError={() => setFailedSrc(src)}
        />
      </button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setZoom(1);
            setDragging(false);
            dragRef.current = null;
          }
        }}
      >
        <DialogContent
          className="h-[92vh] w-[96vw] max-w-[96vw] p-2 bg-black/90 border-0"
          hideDefaultClose
        >
          <DialogTitle className="sr-only">Site photo</DialogTitle>
          <DialogClose className="absolute right-3 top-3 z-10 rounded-full bg-black/75 hover:bg-black/95 text-white border border-white/30 p-2 transition-colors focus:outline-none">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
          <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-white/30 bg-black/75 px-3 text-white hover:bg-black/95"
              onClick={() => setZoom((z) => clampZoom(z - 0.25))}
            >
              -
            </Button>
            <div className="min-w-16 rounded-md border border-white/20 bg-black/60 px-2 py-1 text-center text-xs text-white">
              {Math.round(zoom * 100)}%
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-white/30 bg-black/75 px-3 text-white hover:bg-black/95"
              onClick={() => setZoom((z) => clampZoom(z + 0.25))}
            >
              +
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-9 border-white/30 bg-black/75 px-3 text-white hover:bg-black/95"
              onClick={() => setZoom(1)}
            >
              Reset
            </Button>
          </div>
          <div
            ref={scrollRef}
            className={cn(
              "h-full overflow-auto rounded",
              zoom > 1 && "cursor-grab",
              dragging && "cursor-grabbing",
            )}
            onWheel={(e) => {
              if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
              e.preventDefault();
              setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.2 : -0.2)));
            }}
            onMouseDown={(e) => {
              if (zoom <= 1 || !scrollRef.current) return;
              e.preventDefault();
              setDragging(true);
              dragRef.current = {
                x: e.clientX,
                y: e.clientY,
                left: scrollRef.current.scrollLeft,
                top: scrollRef.current.scrollTop,
              };
            }}
            onMouseMove={(e) => {
              if (!dragging || !scrollRef.current || !dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              scrollRef.current.scrollLeft = dragRef.current.left - dx;
              scrollRef.current.scrollTop = dragRef.current.top - dy;
            }}
            onMouseUp={() => {
              setDragging(false);
              dragRef.current = null;
            }}
            onMouseLeave={() => {
              setDragging(false);
              dragRef.current = null;
            }}
          >
            <img
              src={src!}
              alt=""
              className="mx-auto max-w-none rounded object-contain"
              style={{
                maxHeight: zoom === 1 ? "100%" : "none",
                height: zoom === 1 ? "100%" : undefined,
                width: `${zoom * 100}%`,
                objectFit: "contain",
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function LocationMapPreview({
  location,
  open,
  onOpenChange,
}: {
  location: Location | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [mapsReady, setMapsReady] = useState(false);
  const [mapsError, setMapsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMapsReady(false);
    setMapsError(null);
    loadGoogleMaps()
      .then(() => {
        if (!cancelled) setMapsReady(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMapsError(err instanceof Error ? err.message : "Map could not load");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !location || !mapsReady) return;

    let cancelled = false;
    setLoading(true);
    setMapsError(null);

    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          if (cancelled || !mapRef.current) return;

          let lat = location.latitude;
          let lng = location.longitude;

          if ((lat == null || lng == null) && location.address?.trim()) {
            const geocoder = new google.maps.Geocoder();
            const result = await geocoder.geocode({ address: location.address.trim() });
            const first = result.results[0];
            if (!first?.geometry?.location) {
              throw new Error("Could not find that address on the map");
            }
            lat = first.geometry.location.lat();
            lng = first.geometry.location.lng();
          }

          if (lat == null || lng == null) {
            throw new Error("This location has no map pin yet");
          }
          if (cancelled || !mapRef.current) return;

          const center = { lat, lng };

          if (markerRef.current) {
            markerRef.current.setMap(null);
            markerRef.current = null;
          }
          if (mapInstanceRef.current) {
            google.maps.event.clearInstanceListeners(mapInstanceRef.current);
            mapInstanceRef.current = null;
          }

          const map = new google.maps.Map(mapRef.current, {
            center,
            zoom: 17,
            mapTypeId: "hybrid",
            mapTypeControl: true,
            streetViewControl: false,
            fullscreenControl: true,
            gestureHandling: "greedy",
          });
          mapInstanceRef.current = map;
          markerRef.current = new google.maps.Marker({
            map,
            position: center,
            title: location.name,
          });

          google.maps.event.addListenerOnce(map, "idle", () => {
            google.maps.event.trigger(map, "resize");
            map.setCenter(center);
          });
        } catch (err: unknown) {
          if (cancelled) return;
          setMapsError(err instanceof Error ? err.message : "Map could not load");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 80);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
    };
  }, [open, location, mapsReady]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[92vh] w-[96vw] max-w-[96vw] p-0 overflow-hidden bg-background border-border">
        <DialogHeader className="px-4 pt-4 pb-2 pr-12">
          <DialogTitle className="flex items-center gap-2 truncate">
            <MapPin className="h-4 w-4 shrink-0 text-primary" />
            {location?.name || "Location"}
          </DialogTitle>
          {location?.address ? (
            <p className="text-sm text-muted-foreground truncate">{location.address}</p>
          ) : null}
        </DialogHeader>
        <div className="relative mx-4 mb-4 h-[calc(92vh-5.5rem)] min-h-[320px] rounded-md border overflow-hidden bg-muted/30">
          {(loading || (!mapsReady && !mapsError)) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50">
              <p className="text-sm text-muted-foreground">Loading map…</p>
            </div>
          )}
          {mapsError ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center">
              <p className="text-sm text-destructive">{mapsError}</p>
            </div>
          ) : null}
          <div ref={mapRef} className="absolute inset-0 h-full w-full" data-testid="location-in-app-map" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function LocationManager() {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [color, setColor] = useState("#6B7280");
  const [icon, setIcon] = useState("map-pin");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [mapPreview, setMapPreview] = useState<Location | null>(null);
  const photoInputRef = useRef<HTMLInputElement>(null);

  const { data: locations = [], isLoading } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const createMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/locations", {
      name,
      address: address || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      color,
      icon,
      photoUrl,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location added" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/locations/${editingId}`, {
      name,
      address: address || null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      color,
      icon,
      photoUrl,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location updated" });
      closeDialog();
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => apiRequest("DELETE", `/api/locations/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
      toast({ title: "Location deleted" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const openEdit = (loc: Location) => {
    setEditingId(loc.id);
    setName(loc.name);
    setAddress(loc.address || "");
    setColor(loc.color || "#6B7280");
    setIcon(loc.icon || "map-pin");
    setLatitude(loc.latitude ?? null);
    setLongitude(loc.longitude ?? null);
    setPhotoUrl(loc.photoUrl ?? null);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditingId(null);
    setName("");
    setAddress("");
    setColor("#6B7280");
    setIcon("map-pin");
    setLatitude(null);
    setLongitude(null);
    setPhotoUrl(null);
    setUploadingPhoto(false);
  };

  async function uploadSitePhoto(file: File) {
    setUploadingPhoto(true);
    try {
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "evidence" });
      setPhotoUrl(objectUrl);
    } catch (err) {
      toast({
        title: "Photo upload failed",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setUploadingPhoto(false);
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="header-locations"
        >
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <MapPin className="h-4 w-4" />
              Predefined Locations
            </CardTitle>
            <div className="flex items-center gap-2">
              {!collapsed && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); setDialogOpen(true); }} data-testid="button-add-location">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />
                  Add Location
                </Button>
              )}
              {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>
        {!collapsed && <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : locations.length === 0 ? (
            <div className="p-8 text-center">
              <MapPin className="mx-auto h-10 w-10 text-muted-foreground/30" />
              <p className="mt-3 text-sm text-muted-foreground">No predefined locations yet.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Photo</TableHead>
                  <TableHead>Colour</TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Address</TableHead>
                  <TableHead>Coordinates</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {locations.map((loc) => (
                  <TableRow key={loc.id} data-testid={`row-location-${loc.id}`}>
                    <TableCell>
                      <LocationSitePhoto
                        photoUrl={loc.photoUrl}
                        className="h-10 w-14 rounded-md border border-border/60"
                      />
                    </TableCell>
                    <TableCell>
                      <div
                        className="w-7 h-7 rounded-full flex items-center justify-center shadow-sm"
                        style={{ backgroundColor: loc.color || "#6B7280" }}
                        data-testid={`swatch-location-${loc.id}`}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          dangerouslySetInnerHTML={{ __html: getIconSvg(loc.icon || "map-pin") }}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{loc.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {loc.address ? (
                        <button
                          type="button"
                          className="text-left text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMapPreview(loc);
                          }}
                          data-testid={`link-location-address-${loc.id}`}
                        >
                          {loc.address}
                        </button>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {loc.latitude != null && loc.longitude != null ? (
                        <button
                          type="button"
                          className="text-left text-primary hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMapPreview(loc);
                          }}
                          data-testid={`link-location-coords-${loc.id}`}
                        >
                          {`${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}`}
                        </button>
                      ) : (
                        "-"
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEdit(loc)} data-testid={`button-edit-location-${loc.id}`}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteId(loc.id)} data-testid={`button-delete-location-${loc.id}`}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>}
      </Card>

      <LocationMapPreview
        location={mapPreview}
        open={mapPreview != null}
        onOpenChange={(open) => {
          if (!open) setMapPreview(null);
        }}
      />

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId !== null ? "Edit Location" : "Add Location"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Name <span className="text-red-500">*</span></Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Nico Venter House" data-testid="input-location-name" />
            </div>
            <GoogleAddressPinPicker
              value={{ address, latitude, longitude }}
              onChange={(next) => {
                setAddress(next.address);
                setLatitude(next.latitude);
                setLongitude(next.longitude);
              }}
            />
            <div>
              <Label>Site photo</Label>
              <div className="flex flex-wrap items-center gap-3 mt-1.5">
                <LocationSitePhoto
                  photoUrl={photoUrl}
                  className="h-20 w-28 rounded-md border border-border/60"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    data-testid="input-location-photo"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadSitePhoto(file);
                      e.target.value = "";
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadingPhoto}
                    onClick={() => photoInputRef.current?.click()}
                    data-testid="button-location-photo"
                  >
                    <Camera className="h-4 w-4 mr-1.5" />
                    {uploadingPhoto ? "Uploading..." : photoUrl ? "Change photo" : "Add photo"}
                  </Button>
                  {photoUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={uploadingPhoto}
                      onClick={() => setPhotoUrl(null)}
                      data-testid="button-location-photo-remove"
                    >
                      <X className="h-4 w-4 mr-1.5" />
                      Remove
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-1.5">
                Optional. A picture of the premises so the site is easy to recognise.
              </p>
            </div>
            <div>
              <Label>Colour</Label>
              <div className="flex items-center gap-3 mt-1.5">
                <input
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-10 h-10 rounded-md border border-input cursor-pointer p-0.5 bg-background"
                  data-testid="input-location-color"
                />
                <span className="text-sm font-mono text-muted-foreground">{color}</span>
                <span className="inline-block w-6 h-6 rounded-full border border-border shadow-sm" style={{ backgroundColor: color }} />
              </div>
            </div>
            <div>
              <Label>Map Icon</Label>
              <div className="grid grid-cols-5 gap-1.5 mt-1.5 max-h-52 overflow-y-auto pr-1" data-testid="icon-picker-location">
                {INCIDENT_ICONS.map((ic) => (
                  <button
                    key={ic.key}
                    type="button"
                    onClick={() => setIcon(ic.key)}
                    title={ic.label}
                    data-testid={`icon-option-loc-${ic.key}`}
                    className={`flex flex-col items-center gap-1 rounded-md p-2 border transition-all text-xs ${
                      icon === ic.key
                        ? "border-2 bg-muted shadow-sm"
                        : "border-border hover:bg-muted/50"
                    }`}
                    style={{ borderColor: icon === ic.key ? color : undefined }}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: icon === ic.key ? color : "hsl(var(--muted))" }}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke={icon === ic.key ? "white" : "currentColor"}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        dangerouslySetInnerHTML={{ __html: ic.svg }}
                      />
                    </div>
                    <span className="leading-none text-muted-foreground truncate w-full text-center">{ic.label}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={closeDialog} data-testid="button-cancel-location">Cancel</Button>
              <Button
                onClick={() => editingId !== null ? updateMutation.mutate() : createMutation.mutate()}
                disabled={!name.trim() || createMutation.isPending || updateMutation.isPending || uploadingPhoto}
                data-testid="button-save-location"
              >
                {createMutation.isPending || updateMutation.isPending ? "Saving..." : editingId !== null ? "Save Changes" : "Add Location"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Location</AlertDialogTitle>
            <AlertDialogDescription>This will remove the location from the predefined list. Existing incidents that reference this location will be unaffected. Continue?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteMutation.mutate(deleteId)} data-testid="button-confirm-delete-location">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function AdminPage() {
  const { data: formFields = [] } = useQuery<FormField[]>({ queryKey: ["/api/form-fields"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });

  return (
    <div className="flex flex-col h-full">
      <div className={cn(OPS_PAGE_SHELL, "py-6 space-y-6 overflow-y-auto flex-1")}>
        <PageHero
          eyebrow="Field setup"
          badge="Admin"
          total={formFields.length + categories.length + locations.length}
          totalLabel="Configured"
          titleTestId="text-admin-title"
          insights={[
            { label: "Form fields", value: String(formFields.length) },
            { label: "Types", value: String(categories.length) },
            { label: "Locations", value: String(locations.length) },
          ]}
        />

        <FormFieldManager />
        <PredefinedTypesManager />
        <LocationManager />
      </div>
    </div>
  );
}
