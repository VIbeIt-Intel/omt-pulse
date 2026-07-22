import { useState, useEffect, useRef, useMemo, Fragment } from "react";
import {
  isManualIncidentType,
  isSystemResponseMode,
  groupManualIncidentTypes,
  SYSTEM_MODE_DESCRIPTIONS,
  uniqueSystemResponseModes,
  type SeverityGroupKey,
} from "@/lib/incident-categories";
import L from "leaflet";
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
import { Plus, Pencil, Trash2, Settings, ListChecks, Eye, EyeOff, MapPin, ChevronDown, ChevronUp, Tag, Map, Upload, X, ScanSearch, Radio } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { GoogleAddressPinPicker } from "@/components/google-address-pin-picker";
import type { CustomMap } from "@shared/schema";

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
  };

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
                    <TableCell className="text-sm text-muted-foreground">{loc.address || "-"}</TableCell>
                    <TableCell className="text-xs text-muted-foreground font-mono">
                      {loc.latitude != null && loc.longitude != null ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}` : "-"}
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
                disabled={!name.trim() || createMutation.isPending || updateMutation.isPending}
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

function CustomMapLeafletPreview({ map, height = 420 }: { map: CustomMap; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapInstanceRef.current) return;
    const w = map.imageWidth || 1000;
    const h = map.imageHeight || 1000;
    const bounds: L.LatLngBoundsExpression = [[0, 0], [h, w]];
    const leafletMap = L.map(containerRef.current, {
      crs: L.CRS.Simple,
      minZoom: -3,
      maxZoom: 4,
      zoomSnap: 0.25,
    });
    L.imageOverlay(map.imageUrl, bounds).addTo(leafletMap);
    leafletMap.fitBounds(bounds);
    mapInstanceRef.current = leafletMap;
    return () => {
      leafletMap.remove();
      mapInstanceRef.current = null;
    };
  }, [map]);

  return <div ref={containerRef} style={{ height: `${height}px`, width: "100%", borderRadius: "6px", zIndex: 0 }} />;
}

function CustomMapsManager() {
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [previewMap, setPreviewMap] = useState<CustomMap | null>(null);
  const [uploading, setUploading] = useState(false);
  const [mapName, setMapName] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const { data: maps = [], isLoading } = useQuery<CustomMap[]>({
    queryKey: ["/api/custom-maps"],
  });

  const createMutation = useMutation({
    mutationFn: async ({ name, imageUrl, imageWidth, imageHeight }: { name: string; imageUrl: string; imageWidth?: number; imageHeight?: number }) => {
      const res = await apiRequest("POST", "/api/custom-maps", { name, imageUrl, imageWidth: imageWidth ?? null, imageHeight: imageHeight ?? null, sortOrder: 0 });
      return res.json() as Promise<CustomMap>;
    },
    onSuccess: (newMap) => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-maps"] });
      toast({ title: "Custom map uploaded" });
      setMapName("");
      setFormOpen(false);
      setPreviewMap(newMap);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("DELETE", `/api/custom-maps/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/custom-maps"] });
      toast({ title: "Map deleted" });
      setDeleteId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return toast({ title: "Please select an image file", variant: "destructive" });
    if (!mapName.trim()) return toast({ title: "Please enter a name", variant: "destructive" });

    setUploading(true);
    try {
      const urlRes = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
        credentials: "include",
      });
      const { objectUrl } = await urlRes.json();

      // Measure image dimensions then immediately revoke the blob URL
      const dims = await new Promise<{ width: number; height: number }>((resolve) => {
        const blobUrl = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(blobUrl); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
        img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve({ width: 0, height: 0 }); };
        img.src = blobUrl;
      });

      await createMutation.mutateAsync({ name: mapName.trim(), imageUrl: objectUrl, imageWidth: dims.width || undefined, imageHeight: dims.height || undefined });
    } catch (err) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Upload failed", variant: "destructive" });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <>
      <Card>
        <CardHeader
          className="cursor-pointer select-none"
          onClick={() => setCollapsed((c) => !c)}
          data-testid="header-custom-maps"
        >
          <div className="flex items-center justify-between gap-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Map className="h-4 w-4" />
              Custom Maps
            </CardTitle>
            <div className="flex items-center gap-2">
              {!collapsed && (
                <Button size="sm" onClick={(e) => { e.stopPropagation(); setFormOpen((o) => !o); }} data-testid="button-add-custom-map">
                  <Upload className="h-3.5 w-3.5 mr-1.5" />
                  Upload Map
                </Button>
              )}
              {collapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
            </div>
          </div>
        </CardHeader>

        {!collapsed && (
          <CardContent className="space-y-4">
            {/* Upload form (inline, toggleable) */}
            {formOpen && (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">New Custom Map</p>
                  <button onClick={() => setFormOpen(false)} className="text-muted-foreground hover:text-foreground" data-testid="button-close-map-form">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div>
                  <Label htmlFor="custom-map-name">Map Name <span className="text-red-500">*</span></Label>
                  <Input
                    id="custom-map-name"
                    value={mapName}
                    onChange={(e) => setMapName(e.target.value)}
                    placeholder="e.g. Building A — Ground Floor"
                    data-testid="input-custom-map-name"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label>Image File <span className="text-red-500">*</span></Label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    data-testid="input-custom-map-file"
                    className="mt-1 block w-full text-sm text-muted-foreground file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border file:border-input file:text-sm file:bg-background file:text-foreground hover:file:bg-muted cursor-pointer"
                  />
                  <p className="text-xs text-muted-foreground mt-1">Supported formats: PNG, JPG, JPEG, GIF, WebP</p>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" onClick={() => setFormOpen(false)} data-testid="button-cancel-map-upload">Cancel</Button>
                  <Button
                    size="sm"
                    onClick={handleUpload}
                    disabled={uploading || createMutation.isPending}
                    data-testid="button-submit-map-upload"
                  >
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                    {uploading || createMutation.isPending ? "Uploading..." : "Upload"}
                  </Button>
                </div>
              </div>
            )}

            {/* Map list */}
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : maps.length === 0 ? (
              <div className="py-10 text-center">
                <Map className="mx-auto h-10 w-10 text-muted-foreground/30" />
                <p className="mt-3 text-sm text-muted-foreground">No custom maps uploaded yet.</p>
                <p className="text-xs text-muted-foreground mt-1">Upload a floor plan, site diagram or estate map to get started.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {maps.map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                    data-testid={`row-custom-map-${m.id}`}
                  >
                    {/* Thumbnail */}
                    <div className="w-16 h-12 flex-shrink-0 rounded overflow-hidden border border-border bg-muted flex items-center justify-center">
                      <img
                        src={m.imageUrl}
                        alt={m.name}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                        data-testid={`img-custom-map-${m.id}`}
                      />
                    </div>
                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" data-testid={`text-custom-map-name-${m.id}`}>{m.name}</p>
                      {m.imageWidth && m.imageHeight ? (
                        <p className="text-xs text-muted-foreground" data-testid={`text-custom-map-dims-${m.id}`}>
                          {m.imageWidth} × {m.imageHeight} px
                        </p>
                      ) : null}
                    </div>
                    {/* Actions */}
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setPreviewMap(m)}
                      title="Preview map"
                      data-testid={`button-preview-custom-map-${m.id}`}
                    >
                      <ScanSearch className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => setDeleteId(m.id)}
                      data-testid={`button-delete-custom-map-${m.id}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      <AlertDialog open={deleteId !== null} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Custom Map</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the map. Any incidents pinned to this map will lose their pin placement but will not be deleted. Continue?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && deleteMutation.mutate(deleteId)}
              data-testid="button-confirm-delete-custom-map"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Leaflet overlay preview dialog */}
      <Dialog open={previewMap !== null} onOpenChange={(open) => { if (!open) setPreviewMap(null); }}>
        <DialogContent className="max-w-3xl" data-testid="dialog-custom-map-preview">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Map className="h-4 w-4" />
              {previewMap?.name}
            </DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-1">
            This is a Leaflet image overlay — the same projection used when placing incident pins. Use scroll to zoom.
          </p>
          {previewMap && <CustomMapLeafletPreview key={previewMap.id} map={previewMap} height={480} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

export default function AdminPage() {
  const { data: formFields = [] } = useQuery<FormField[]>({ queryKey: ["/api/form-fields"] });
  const { data: categories = [] } = useQuery<Category[]>({ queryKey: ["/api/categories"] });
  const { data: locations = [] } = useQuery<Location[]>({ queryKey: ["/api/locations"] });
  const { data: customMaps = [] } = useQuery<CustomMap[]>({ queryKey: ["/api/custom-maps"] });

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
            { label: "Locations", value: String(locations.length + customMaps.length) },
          ]}
        />

        <FormFieldManager />
        <PredefinedTypesManager />
        <LocationManager />
        <CustomMapsManager />
      </div>
    </div>
  );
}
