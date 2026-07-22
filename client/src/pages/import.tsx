import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { FormField, Category, Location, ImportBatch } from "@shared/schema";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Upload, Download, FileSpreadsheet, CheckCircle2, AlertCircle, Loader2, Undo2, FileUp, ArrowRight, ArrowLeft, FileWarning } from "lucide-react";
import { PageHero } from "@/components/page-hero";
import { OPS_PAGE_SHELL } from "@/lib/ops-layout";
import { cn } from "@/lib/utils";

type ColumnMapEntry = { fieldKey: string | null; type: "system" | "custom" | "skip" };
type CategoryResolution = { action: "link" | "create" | "other"; categoryId?: number };
type LocationResolution = { action: "link" | "create" | "freetext"; locationId?: number };

type UploadResponse = {
  batchId: number;
  filename: string;
  headers: string[];
  previewRows: Record<string, string>[];
  totalRows: number;
  suggestedMapping: Record<string, ColumnMapEntry>;
};

type ReferencesResponse = {
  categoryNames: string[];
  locationNames: string[];
  existingCategories: Category[];
  existingLocations: Location[];
};

type ValidationResponse = {
  validRows: number;
  errorRows: number;
  totalRows: number;
  errors: Array<{ rowNumber: number; errors: string[] }>;
};

const SYSTEM_FIELDS = [
  { key: "incidentDate", label: "Incident Date" },
  { key: "incidentTime", label: "Incident Time" },
  { key: "categoryId", label: "Type / Category" },
  { key: "location", label: "Location" },
  { key: "description", label: "Description" },
];

export default function ImportPage() {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [upload, setUpload] = useState<UploadResponse | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, ColumnMapEntry>>({});
  const [dateFormat, setDateFormat] = useState<"dmy" | "mdy" | "ymd">("dmy");
  const [references, setReferences] = useState<ReferencesResponse | null>(null);
  const [categoryRes, setCategoryRes] = useState<Record<string, CategoryResolution>>({});
  const [locationRes, setLocationRes] = useState<Record<string, LocationResolution>>({});
  const [validation, setValidation] = useState<ValidationResponse | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitProgress, setCommitProgress] = useState<{ importedRows: number; totalRows: number } | null>(null);
  const [commitResult, setCommitResult] = useState<{ importedRows: number; failedRows: number; batchId: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);

  const { data: formFields = [] } = useQuery<FormField[]>({ queryKey: ["/api/form-fields"] });
  const { data: pastImports = [], isLoading: loadingPast } = useQuery<ImportBatch[]>({ queryKey: ["/api/imports"] });

  const customFields = useMemo(() => formFields.filter((f) => !f.isSystem), [formFields]);

  const handleFile = async (file: File) => {
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/imports", { method: "POST", body: formData, credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Upload failed" }));
        throw new Error(err.message || "Upload failed");
      }
      const data: UploadResponse = await res.json();
      setUpload(data);
      setColumnMap(data.suggestedMapping);
      setStep(2);
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
  };

  const downloadTemplate = async () => {
    try {
      const res = await fetch("/api/imports/template", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "omt-import-template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  const downloadErrors = async (batchId: number, filename?: string) => {
    try {
      const res = await fetch(`/api/imports/${batchId}/errors`, { credentials: "include" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: "Download failed" }));
        throw new Error(err.message || "Download failed");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = (filename ?? `import-${batchId}`).replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
      a.download = `${safeName}-errors.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download failed", description: err.message, variant: "destructive" });
    }
  };

  const goToStep3 = async () => {
    if (!upload) return;
    try {
      const refs = await apiRequest("POST", `/api/imports/${upload.batchId}/preview-references`, { columnMap });
      const refsData: ReferencesResponse = await refs.json();
      setReferences(refsData);

      const initialCatRes: Record<string, CategoryResolution> = {};
      for (const name of refsData.categoryNames) {
        initialCatRes[name.toLowerCase().trim()] = { action: "create" };
      }
      const initialLocRes: Record<string, LocationResolution> = {};
      for (const name of refsData.locationNames) {
        initialLocRes[name.toLowerCase().trim()] = { action: "create" };
      }
      setCategoryRes(initialCatRes);
      setLocationRes(initialLocRes);
      setStep(3);
    } catch (err: any) {
      toast({ title: "Failed to load references", description: err.message, variant: "destructive" });
    }
  };

  const goToStep4 = async () => {
    if (!upload) return;
    try {
      await apiRequest("POST", `/api/imports/${upload.batchId}/mapping`, {
        columnMap,
        categoryResolutions: categoryRes,
        locationResolutions: locationRes,
        dateFormat,
      });
      const r = await apiRequest("POST", `/api/imports/${upload.batchId}/validate`, {});
      const v: ValidationResponse = await r.json();
      setValidation(v);
      setStep(4);
    } catch (err: any) {
      toast({ title: "Validation failed", description: err.message, variant: "destructive" });
    }
  };

  const commit = async () => {
    if (!upload) return;
    setCommitting(true);
    setCommitProgress({ importedRows: 0, totalRows: skipErrors ? validation?.validRows ?? upload.totalRows : validation?.totalRows ?? upload.totalRows });
    // Poll batch status every 1s while committing so the progress bar reflects live inserts.
    const pollId = window.setInterval(async () => {
      try {
        const r = await fetch(`/api/imports/${upload.batchId}`, { credentials: "include" });
        if (!r.ok) return;
        const b = await r.json();
        setCommitProgress((prev) => prev ? { ...prev, importedRows: b.importedRows ?? 0 } : prev);
      } catch {}
    }, 1000);
    try {
      const r = await apiRequest("POST", `/api/imports/${upload.batchId}/commit`, { skipErrorRows: skipErrors });
      const data = await r.json();
      setCommitResult({ importedRows: data.importedRows, failedRows: data.failedRows, batchId: upload.batchId });
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      queryClient.invalidateQueries({ queryKey: ["/api/locations"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      window.clearInterval(pollId);
      setCommitting(false);
      setCommitProgress(null);
    }
  };

  const reset = () => {
    setStep(1);
    setUpload(null);
    setColumnMap({});
    setReferences(null);
    setCategoryRes({});
    setLocationRes({});
    setValidation(null);
    setSkipErrors(false);
    setCommitResult(null);
  };

  const undoMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/imports/${id}`),
    onSuccess: (_, id) => {
      toast({ title: "Import undone", description: "All occurrences from this batch have been removed." });
      queryClient.invalidateQueries({ queryKey: ["/api/imports"] });
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
    },
    onError: (err: any) => {
      toast({ title: "Undo failed", description: err.message, variant: "destructive" });
    },
  });

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const stepLabel =
    step === 1 ? "Upload" : step === 2 ? "Map columns" : step === 3 ? "Resolve refs" : "Validate";

  return (
    <div className="h-full overflow-auto">
      <div className={cn(OPS_PAGE_SHELL, "py-6 space-y-6")}>
        <PageHero
          eyebrow="Import Data"
          badge={`Step ${step} of 4 · ${stepLabel}`}
          total={validation?.totalRows ?? upload?.totalRows ?? null}
          totalLabel={validation || upload ? "Rows" : undefined}
          title={!validation && !upload ? "Occurrence import" : undefined}
          description={!validation && !upload ? "Bulk-import historical or ongoing occurrence data from Excel or CSV." : undefined}
          titleTestId="text-page-title"
          insights={
            validation
              ? [
                  { label: "Valid", value: String(validation.validRows) },
                  { label: "Errors", value: String(validation.errorRows) },
                ]
              : [
                  { label: "Format", value: "Excel / CSV" },
                  { label: "Flow", value: "Upload → map → import" },
                ]
          }
        />

        {/* Stepper */}
        <div className="flex items-center gap-2">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="flex items-center gap-2 flex-1">
              <div
                className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
                  step >= n ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
                data-testid={`step-indicator-${n}`}
              >
                {n}
              </div>
              <div className="text-sm font-medium hidden sm:inline">
                {n === 1 && "Upload"}
                {n === 2 && "Map columns"}
                {n === 3 && "Resolve references"}
                {n === 4 && "Validate & import"}
              </div>
              {n < 4 && <div className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>

        {/* Step 1: Upload */}
        {step === 1 && (
          <Card>
            <CardHeader>
              <CardTitle>Upload your file</CardTitle>
              <CardDescription>
                Excel (.xlsx) or CSV files up to 25 MB. Maximum 25,000 rows per import.
                Need a starting point? Download a template with your organisation's exact column headers.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" onClick={downloadTemplate} data-testid="button-download-template">
                <Download className="h-4 w-4 mr-2" />
                Download Excel Template
              </Button>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
                onDragLeave={() => setDragActive(false)}
                onDrop={onDrop}
                className={`border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
                  dragActive ? "border-primary bg-primary/5" : "border-border"
                }`}
                data-testid="dropzone-import"
              >
                <FileUp className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-sm font-medium mb-1">Drag and drop a file here</p>
                <p className="text-xs text-muted-foreground mb-4">or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  data-testid="input-file"
                />
                <Button onClick={() => fileInputRef.current?.click()} data-testid="button-choose-file">
                  <Upload className="h-4 w-4 mr-2" />
                  Choose file
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 2: Map columns */}
        {step === 2 && upload && (
          <Card>
            <CardHeader>
              <CardTitle>Map columns</CardTitle>
              <CardDescription>
                <span className="font-medium">{upload.filename}</span> — {upload.totalRows} rows, {upload.headers.length} columns.
                Match each spreadsheet column to an OMT field. Auto-matched columns are pre-selected.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3 p-3 border rounded-md bg-muted/30">
                <span className="text-sm font-medium">Date format in your file:</span>
                <Select value={dateFormat} onValueChange={(v) => setDateFormat(v as "dmy" | "mdy" | "ymd")}>
                  <SelectTrigger className="w-[220px]" data-testid="select-date-format">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dmy">DD/MM/YYYY (default)</SelectItem>
                    <SelectItem value="mdy">MM/DD/YYYY (US)</SelectItem>
                    <SelectItem value="ymd">YYYY-MM-DD (ISO)</SelectItem>
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">Used only when both day &amp; month are 1–12.</span>
              </div>
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2 font-medium">Spreadsheet Column</th>
                      <th className="text-left p-2 font-medium">Sample Value</th>
                      <th className="text-left p-2 font-medium">→</th>
                      <th className="text-left p-2 font-medium">OMT Field</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upload.headers.map((h) => {
                      const sample = upload.previewRows[0]?.[h] ?? "";
                      const map = columnMap[h] || { fieldKey: null, type: "skip" as const };
                      const value = map.type === "skip" ? "__skip__" : `${map.type}:${map.fieldKey}`;
                      return (
                        <tr key={h} className="border-t" data-testid={`row-mapping-${h}`}>
                          <td className="p-2 font-medium">{h}</td>
                          <td className="p-2 text-muted-foreground truncate max-w-xs">{sample || "—"}</td>
                          <td className="p-2 text-muted-foreground">→</td>
                          <td className="p-2">
                            <Select
                              value={value}
                              onValueChange={(v) => {
                                if (v === "__skip__") {
                                  setColumnMap({ ...columnMap, [h]: { fieldKey: null, type: "skip" } });
                                } else {
                                  const [type, ...rest] = v.split(":");
                                  setColumnMap({ ...columnMap, [h]: { fieldKey: rest.join(":"), type: type as "system" | "custom" } });
                                }
                              }}
                            >
                              <SelectTrigger className="w-full" data-testid={`select-mapping-${h}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__skip__">— Skip this column —</SelectItem>
                                {SYSTEM_FIELDS.map((f) => (
                                  <SelectItem key={f.key} value={`system:${f.key}`}>{f.label}</SelectItem>
                                ))}
                                {customFields.map((f) => (
                                  <SelectItem key={f.fieldKey} value={`custom:${f.fieldKey}`}>{f.label} (custom)</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-between">
                <Button variant="outline" onClick={reset} data-testid="button-cancel-mapping">Cancel</Button>
                <Button onClick={goToStep3} data-testid="button-continue-to-references">
                  Continue <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 3: Resolve references */}
        {step === 3 && upload && references && (
          <Card>
            <CardHeader>
              <CardTitle>Resolve unknown values</CardTitle>
              <CardDescription>
                We found values in your Type and Location columns that don't match anything in OMT yet.
                For each one, choose how to handle it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {references.categoryNames.length === 0 && references.locationNames.length === 0 && (
                <div className="text-sm text-muted-foreground p-4 bg-muted/50 rounded-md">
                  All Types and Locations in your file already exist in OMT — nothing to resolve.
                </div>
              )}

              {references.categoryNames.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Unknown Types ({references.categoryNames.length})</h3>
                  <div className="border rounded-md divide-y">
                    {references.categoryNames.map((name) => {
                      const key = name.toLowerCase().trim();
                      const res = categoryRes[key] || { action: "create" as const };
                      return (
                        <div key={name} className="p-3 flex items-center justify-between gap-4" data-testid={`row-category-${name}`}>
                          <div className="font-medium flex-shrink-0 w-48 truncate">{name}</div>
                          <div className="flex-1 flex gap-2 items-center">
                            <Select
                              value={res.action === "link" ? `link:${res.categoryId}` : res.action}
                              onValueChange={(v) => {
                                if (v.startsWith("link:")) {
                                  setCategoryRes({ ...categoryRes, [key]: { action: "link", categoryId: parseInt(v.slice(5)) } });
                                } else {
                                  setCategoryRes({ ...categoryRes, [key]: { action: v as "create" | "other" } });
                                }
                              }}
                            >
                              <SelectTrigger className="w-full" data-testid={`select-category-${name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="create">Create new Type "{name}"</SelectItem>
                                <SelectItem value="other">Map to "Other" with note</SelectItem>
                                {references.existingCategories.filter((c) => !c.isOther).map((c) => (
                                  <SelectItem key={c.id} value={`link:${c.id}`}>Link to existing: {c.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {references.locationNames.length > 0 && (
                <div>
                  <h3 className="font-semibold mb-2">Unknown Locations ({references.locationNames.length})</h3>
                  <div className="border rounded-md divide-y">
                    {references.locationNames.map((name) => {
                      const key = name.toLowerCase().trim();
                      const res = locationRes[key] || { action: "create" as const };
                      return (
                        <div key={name} className="p-3 flex items-center justify-between gap-4" data-testid={`row-location-${name}`}>
                          <div className="font-medium flex-shrink-0 w-48 truncate">{name}</div>
                          <div className="flex-1 flex gap-2 items-center">
                            <Select
                              value={res.action === "link" ? `link:${res.locationId}` : res.action}
                              onValueChange={(v) => {
                                if (v.startsWith("link:")) {
                                  setLocationRes({ ...locationRes, [key]: { action: "link", locationId: parseInt(v.slice(5)) } });
                                } else {
                                  setLocationRes({ ...locationRes, [key]: { action: v as "create" | "freetext" } });
                                }
                              }}
                            >
                              <SelectTrigger className="w-full" data-testid={`select-location-${name}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="create">Create new Location "{name}"</SelectItem>
                                <SelectItem value="freetext">Save as free text only (no map pin)</SelectItem>
                                {references.existingLocations.map((l) => (
                                  <SelectItem key={l.id} value={`link:${l.id}`}>Link to existing: {l.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex justify-between">
                <Button variant="outline" onClick={() => setStep(2)} data-testid="button-back-to-mapping">
                  <ArrowLeft className="h-4 w-4 mr-2" /> Back
                </Button>
                <Button onClick={goToStep4} data-testid="button-continue-to-validate">
                  Validate <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Step 4: Validate & commit */}
        {step === 4 && upload && validation && (
          <Card>
            <CardHeader>
              <CardTitle>Validate & import</CardTitle>
              <CardDescription>Review the validation results before committing the import.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {!commitResult && (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="border rounded-md p-3 text-center">
                      <div className="text-2xl font-bold" data-testid="text-total-rows">{validation.totalRows}</div>
                      <div className="text-xs text-muted-foreground">Total rows</div>
                    </div>
                    <div className="border rounded-md p-3 text-center bg-green-50 dark:bg-green-950/20">
                      <div className="text-2xl font-bold text-green-600 dark:text-green-400" data-testid="text-valid-rows">{validation.validRows}</div>
                      <div className="text-xs text-muted-foreground">Valid rows</div>
                    </div>
                    <div className="border rounded-md p-3 text-center bg-red-50 dark:bg-red-950/20">
                      <div className="text-2xl font-bold text-red-600 dark:text-red-400" data-testid="text-error-rows">{validation.errorRows}</div>
                      <div className="text-xs text-muted-foreground">Rows with errors</div>
                    </div>
                  </div>

                  {validation.errors.length > 0 && (
                    <div>
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="font-semibold flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-red-500" />
                          Errors {validation.errorRows > validation.errors.length && <Badge variant="secondary">showing first {validation.errors.length}</Badge>}
                        </h3>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => downloadErrors(upload.batchId, upload.filename)}
                          data-testid="button-export-errors-validate"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export errors (CSV)
                        </Button>
                      </div>
                      <ScrollArea className="h-64 border rounded-md">
                        <div className="divide-y">
                          {validation.errors.map((e, i) => (
                            <div key={i} className="p-3 text-sm" data-testid={`error-row-${e.rowNumber}`}>
                              <div className="font-medium mb-1">Row {e.rowNumber}</div>
                              <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                                {e.errors.map((err, j) => <li key={j}>{err}</li>)}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </ScrollArea>
                      <div className="mt-3 flex items-center gap-2">
                        <Checkbox id="skip-errors" checked={skipErrors} onCheckedChange={(v) => setSkipErrors(!!v)} data-testid="checkbox-skip-errors" />
                        <label htmlFor="skip-errors" className="text-sm">
                          Skip rows with errors and import only the {validation.validRows} valid rows
                        </label>
                      </div>
                    </div>
                  )}

                  <div className="flex justify-between">
                    <Button variant="outline" onClick={() => setStep(3)} disabled={committing} data-testid="button-back-to-references">
                      <ArrowLeft className="h-4 w-4 mr-2" /> Back
                    </Button>
                    <Button
                      onClick={commit}
                      disabled={committing || (validation.errorRows > 0 && !skipErrors)}
                      data-testid="button-commit-import"
                    >
                      {committing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Importing...</> : <><CheckCircle2 className="h-4 w-4 mr-2" /> Import {skipErrors ? validation.validRows : validation.totalRows} rows</>}
                    </Button>
                  </div>
                </>
              )}

              {committing && commitProgress && !commitResult && (
                <div className="space-y-3 py-6" data-testid="commit-progress">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Loader2 className="h-4 w-4 animate-spin" /> Importing rows…
                  </div>
                  <Progress value={commitProgress.totalRows > 0 ? Math.min(100, (commitProgress.importedRows / commitProgress.totalRows) * 100) : 0} data-testid="progress-import" />
                  <div className="text-xs text-muted-foreground" data-testid="text-progress-count">
                    {commitProgress.importedRows.toLocaleString()} of {commitProgress.totalRows.toLocaleString()} rows
                  </div>
                </div>
              )}

              {commitResult && (
                <div className="space-y-3 text-center py-6">
                  <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
                  <div>
                    <div className="text-2xl font-bold" data-testid="text-import-success">Import complete</div>
                    <div className="text-muted-foreground">
                      {commitResult.importedRows} occurrence{commitResult.importedRows === 1 ? "" : "s"} imported
                      {commitResult.failedRows > 0 && ` · ${commitResult.failedRows} skipped`}
                    </div>
                  </div>
                  <div className="flex justify-center gap-2">
                    <Button variant="outline" onClick={reset} data-testid="button-import-another">Import another file</Button>
                    <Button asChild data-testid="button-view-occurrence-book">
                      <a href={`/?importBatchId=${commitResult.batchId}`}>View imported occurrences</a>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Past imports */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Past Imports
            </CardTitle>
            <CardDescription>Every previous import. Use Undo to remove all occurrences from a batch.</CardDescription>
          </CardHeader>
          <CardContent>
            {loadingPast ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : pastImports.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-6">No imports yet.</div>
            ) : (
              <div className="border rounded-md">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">File</th>
                      <th className="text-left p-2">Imported</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-right p-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pastImports.map((b) => (
                      <tr key={b.id} className="border-t" data-testid={`row-past-import-${b.id}`}>
                        <td className="p-2 text-muted-foreground">{new Date(b.createdAt).toLocaleString()}</td>
                        <td className="p-2 font-medium truncate max-w-xs">{b.filename}</td>
                        <td className="p-2">{b.importedRows} / {b.totalRows}</td>
                        <td className="p-2">
                          <Badge variant={b.status === "completed" ? "default" : b.status === "rolled_back" ? "secondary" : b.status === "failed" ? "destructive" : "outline"}>
                            {b.status}
                          </Badge>
                        </td>
                        <td className="p-2 text-right">
                          <div className="flex justify-end gap-2">
                            {(b.status === "completed" || b.status === "failed") && b.failedRows > 0 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => downloadErrors(b.id, b.filename)}
                                data-testid={`button-export-errors-${b.id}`}
                              >
                                <FileWarning className="h-3 w-3 mr-1" /> Errors (CSV)
                              </Button>
                            )}
                            {b.status === "completed" && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="outline" size="sm" data-testid={`button-undo-${b.id}`}>
                                    <Undo2 className="h-3 w-3 mr-1" /> Undo
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Undo this import?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This will permanently delete the {b.importedRows} occurrence{b.importedRows === 1 ? "" : "s"} that were imported from "{b.filename}".
                                      Categories and locations created by this import will also be removed if no other occurrences reference them.
                                      This cannot be reversed.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel data-testid={`button-cancel-undo-${b.id}`}>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => undoMutation.mutate(b.id)} data-testid={`button-confirm-undo-${b.id}`}>
                                      Yes, undo import
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
