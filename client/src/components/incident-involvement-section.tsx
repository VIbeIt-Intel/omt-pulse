import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Camera, Car, Loader2, Upload, User, X } from "lucide-react";
import { prepareAndUploadFile, UploadValidationError } from "@/lib/upload-media";
import { useToast } from "@/hooks/use-toast";
import { AttachmentPreview } from "@/components/attachment-preview";

export const PERSON_FIELD_KEYS = [
  "personInvolved",
  "personRole",
  "personName",
  "personGender",
  "personApproxAge",
  "personDescription",
  "personPhotoUrls",
] as const;

export const VEHICLE_FIELD_KEYS = [
  "vehicleInvolved",
  "vehicleType",
  "vehicleColour",
  "vehicleRegistration",
  "vehicleDescription",
  "vehiclePhotoUrls",
] as const;

export const INVOLVEMENT_FIELD_KEYS = new Set<string>([
  ...PERSON_FIELD_KEYS,
  ...VEHICLE_FIELD_KEYS,
]);

export type InvolvementValues = Record<string, string | number | null | undefined>;

const MAX_INVOLVEMENT_PHOTOS = 5;

export function parsePhotoUrls(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      if (trimmed.startsWith("http") || trimmed.startsWith("/")) return [trimmed];
    }
  }
  return [];
}

function serializePhotoUrls(urls: string[]): string | null {
  return urls.length > 0 ? JSON.stringify(urls) : null;
}

export function readInvolvement(customFields: InvolvementValues | null | undefined) {
  const cf = customFields ?? {};
  return {
    personInvolved: cf.personInvolved === "yes" || cf.personInvolved === true,
    vehicleInvolved: cf.vehicleInvolved === "yes" || cf.vehicleInvolved === true,
    personRole: String(cf.personRole ?? ""),
    personName: String(cf.personName ?? ""),
    personGender: String(cf.personGender ?? ""),
    personApproxAge: String(cf.personApproxAge ?? ""),
    personDescription: String(cf.personDescription ?? ""),
    personPhotoUrls: parsePhotoUrls(cf.personPhotoUrls),
    vehicleType: String(cf.vehicleType ?? ""),
    vehicleColour: String(cf.vehicleColour ?? ""),
    vehicleRegistration: String(cf.vehicleRegistration ?? ""),
    vehicleDescription: String(cf.vehicleDescription ?? ""),
    vehiclePhotoUrls: parsePhotoUrls(cf.vehiclePhotoUrls),
  };
}

const ROLE_LABELS: Record<string, string> = {
  suspect: "Suspect",
  witness: "Witness",
  victim: "Victim",
  other: "Other",
};

const GENDER_LABELS: Record<string, string> = {
  male: "Male",
  female: "Female",
  unknown: "Unknown",
  prefer_not_to_say: "Prefer not to say",
};

const VEHICLE_TYPE_LABELS: Record<string, string> = {
  car: "Car",
  bakkie: "Bakkie / LDV",
  motorcycle: "Motorcycle",
  truck: "Truck",
  other: "Other",
};

function labelFor(map: Record<string, string>, value: string) {
  return map[value] ?? value.replace(/_/g, " ");
}

export function hasInvolvementData(customFields: InvolvementValues | null | undefined): boolean {
  const inv = readInvolvement(customFields);
  if (!inv.personInvolved && !inv.vehicleInvolved) return false;
  if (inv.personInvolved) {
    if (inv.personRole || inv.personName || inv.personGender || inv.personApproxAge || inv.personDescription || inv.personPhotoUrls.length > 0) return true;
  }
  if (inv.vehicleInvolved) {
    if (inv.vehicleType || inv.vehicleColour || inv.vehicleRegistration || inv.vehicleDescription || inv.vehiclePhotoUrls.length > 0) return true;
  }
  return inv.personInvolved || inv.vehicleInvolved;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  if (!value.trim()) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <p className="text-sm mt-0.5">{value}</p>
    </div>
  );
}

/** Read-only summary for occurrence book / incident detail views. */
export function IncidentInvolvementSummary({
  customFields,
  compact = false,
}: {
  customFields: InvolvementValues | null | undefined;
  compact?: boolean;
}) {
  const inv = readInvolvement(customFields);
  if (!hasInvolvementData(customFields)) return null;

  return (
    <div className={`space-y-3 ${compact ? "" : "pt-1"}`} data-testid="section-involvement-summary">
      {inv.personInvolved && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="summary-person-involved">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <User className="h-3.5 w-3.5" />
            Person involved
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <DetailRow label="Role" value={labelFor(ROLE_LABELS, inv.personRole)} />
            <DetailRow label="Gender" value={labelFor(GENDER_LABELS, inv.personGender)} />
            <DetailRow label="Name" value={inv.personName} />
            <DetailRow label="Approx. age" value={inv.personApproxAge} />
          </div>
          <DetailRow label="Appearance" value={inv.personDescription} />
          {inv.personPhotoUrls.length > 0 && (
            <InvolvementPhotoGrid urls={inv.personPhotoUrls} readOnly testIdPrefix="summary-person" />
          )}
        </div>
      )}
      {inv.vehicleInvolved && (
        <div className="rounded-lg border bg-muted/20 p-3 space-y-2" data-testid="summary-vehicle-involved">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Car className="h-3.5 w-3.5" />
            Vehicle involved
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <DetailRow label="Type" value={labelFor(VEHICLE_TYPE_LABELS, inv.vehicleType)} />
            <DetailRow label="Colour" value={inv.vehicleColour} />
            <DetailRow label="Registration" value={inv.vehicleRegistration} />
            <DetailRow label="Make / model" value={inv.vehicleDescription} />
          </div>
          {inv.vehiclePhotoUrls.length > 0 && (
            <InvolvementPhotoGrid urls={inv.vehiclePhotoUrls} readOnly testIdPrefix="summary-vehicle" />
          )}
        </div>
      )}
    </div>
  );
}

function patchCustomFields(
  current: InvolvementValues,
  patch: InvolvementValues,
): InvolvementValues {
  return { ...current, ...patch };
}

function clearPersonFields(current: InvolvementValues): InvolvementValues {
  const next = { ...current };
  for (const key of PERSON_FIELD_KEYS) delete next[key];
  return next;
}

function clearVehicleFields(current: InvolvementValues): InvolvementValues {
  const next = { ...current };
  for (const key of VEHICLE_FIELD_KEYS) delete next[key];
  return next;
}

function InvolvementPhotoGrid({
  urls,
  readOnly = false,
  onRemove,
  testIdPrefix,
}: {
  urls: string[];
  readOnly?: boolean;
  onRemove?: (index: number) => void;
  testIdPrefix: string;
}) {
  if (urls.length === 0) return null;
  return (
    <div className={`grid gap-2 ${readOnly ? "grid-cols-3 sm:grid-cols-4" : "grid-cols-3"}`}>
      {urls.map((url, i) => (
        <div key={`${url}-${i}`} className="relative aspect-square rounded-md border overflow-hidden bg-muted">
          {readOnly ? (
            <div className="h-full [&_button]:h-full [&_img]:!h-full [&_img]:object-cover [&_img]:rounded-none">
              <AttachmentPreview url={url} alt={`Photo ${i + 1}`} mimeType="image/jpeg" />
            </div>
          ) : (
            <img src={url} alt="" className="w-full h-full object-cover" />
          )}
          {!readOnly && onRemove && (
            <button
              type="button"
              onClick={() => onRemove(i)}
              className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
              data-testid={`${testIdPrefix}-photo-remove-${i}`}
              aria-label="Remove photo"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function InvolvementPhotoPicker({
  urls,
  onChange,
  testIdPrefix,
  label,
}: {
  urls: string[];
  onChange: (urls: string[]) => void;
  testIdPrefix: string;
  label: string;
}) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFiles(files: FileList | File[]) {
    const remaining = MAX_INVOLVEMENT_PHOTOS - urls.length;
    if (remaining <= 0) {
      toast({ title: "Photo limit reached", description: `Maximum ${MAX_INVOLVEMENT_PHOTOS} photos per section.`, variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const next = [...urls];
      for (const file of Array.from(files).slice(0, remaining)) {
        if (!file.type.startsWith("image/")) {
          toast({ title: "Images only", description: "Please choose a photo file.", variant: "destructive" });
          continue;
        }
        const { objectUrl } = await prepareAndUploadFile(file, { preset: "evidence" });
        next.push(objectUrl);
      }
      onChange(next);
    } catch (err) {
      toast({
        title: "Upload failed",
        description: err instanceof UploadValidationError ? err.message : err instanceof Error ? err.message : "Could not upload photo",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2 pt-1">
      <Label className="text-xs">{label}</Label>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid={`${testIdPrefix}-photo-file`}
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        data-testid={`${testIdPrefix}-photo-camera`}
        onChange={(e) => {
          if (e.target.files?.length) void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs"
          disabled={uploading || urls.length >= MAX_INVOLVEMENT_PHOTOS}
          onClick={() => cameraInputRef.current?.click()}
          data-testid={`${testIdPrefix}-take-photo`}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
          Take photo
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 text-xs"
          disabled={uploading || urls.length >= MAX_INVOLVEMENT_PHOTOS}
          onClick={() => fileInputRef.current?.click()}
          data-testid={`${testIdPrefix}-upload-photo`}
        >
          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Upload photo
        </Button>
      </div>
      <InvolvementPhotoGrid
        urls={urls}
        testIdPrefix={testIdPrefix}
        onRemove={(index) => onChange(urls.filter((_, i) => i !== index))}
      />
    </div>
  );
}

type Props = {
  customFields: InvolvementValues;
  onChange: (next: InvolvementValues) => void;
  personInvolved: boolean;
  vehicleInvolved: boolean;
  onPersonInvolvedChange: (on: boolean) => void;
  onVehicleInvolvedChange: (on: boolean) => void;
};

export function IncidentInvolvementSection({
  customFields,
  onChange,
  personInvolved,
  vehicleInvolved,
  onPersonInvolvedChange,
  onVehicleInvolvedChange,
}: Props) {
  const inv = readInvolvement(customFields);

  const setField = (key: string, value: string) => {
    onChange(patchCustomFields(customFields, { [key]: value || null }));
  };

  const setPhotoUrls = (key: "personPhotoUrls" | "vehiclePhotoUrls", urls: string[]) => {
    onChange(patchCustomFields(customFields, { [key]: serializePhotoUrls(urls) }));
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => {
            const next = !personInvolved;
            onPersonInvolvedChange(next);
            if (next) {
              onChange(patchCustomFields(customFields, { personInvolved: "yes" }));
            } else {
              onChange(clearPersonFields(customFields));
            }
          }}
          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors touch-manipulation ${
            personInvolved
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-muted/40"
          }`}
          data-testid="toggle-person-involved"
        >
          <User className="h-4 w-4 shrink-0" />
          Person involved
        </button>
        <button
          type="button"
          onClick={() => {
            const next = !vehicleInvolved;
            onVehicleInvolvedChange(next);
            if (next) {
              onChange(patchCustomFields(customFields, { vehicleInvolved: "yes" }));
            } else {
              onChange(clearVehicleFields(customFields));
            }
          }}
          className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-medium transition-colors touch-manipulation ${
            vehicleInvolved
              ? "border-primary bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:bg-muted/40"
          }`}
          data-testid="toggle-vehicle-involved"
        >
          <Car className="h-4 w-4 shrink-0" />
          Vehicle involved
        </button>
      </div>

      {personInvolved && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3" data-testid="section-person-involved">
          <p className="text-sm font-semibold flex items-center gap-2">
            <User className="h-4 w-4" />
            Person details
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Role</Label>
              <Select value={readInvolvement(customFields).personRole || ""} onValueChange={(v) => setField("personRole", v)}>
                <SelectTrigger data-testid="select-person-role">
                  <SelectValue placeholder="Select role" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="suspect">Suspect</SelectItem>
                  <SelectItem value="witness">Witness</SelectItem>
                  <SelectItem value="victim">Victim</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Gender</Label>
              <Select value={readInvolvement(customFields).personGender || ""} onValueChange={(v) => setField("personGender", v)}>
                <SelectTrigger data-testid="select-person-gender">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name (if known)</Label>
              <Input
                value={readInvolvement(customFields).personName}
                onChange={(e) => setField("personName", e.target.value)}
                placeholder="First name or alias"
                data-testid="input-person-name"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Approx. age</Label>
              <Input
                value={readInvolvement(customFields).personApproxAge}
                onChange={(e) => setField("personApproxAge", e.target.value)}
                placeholder="e.g. 30s, teenager"
                data-testid="input-person-age"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Clothing / appearance</Label>
            <Textarea
              value={readInvolvement(customFields).personDescription}
              onChange={(e) => setField("personDescription", e.target.value)}
              placeholder="Brief description — clothing, height, distinguishing marks…"
              className="min-h-[72px] resize-none text-sm"
              data-testid="input-person-description"
            />
          </div>
          <InvolvementPhotoPicker
            label="Photos"
            testIdPrefix="person"
            urls={inv.personPhotoUrls}
            onChange={(urls) => setPhotoUrls("personPhotoUrls", urls)}
          />
        </div>
      )}

      {vehicleInvolved && (
        <div className="rounded-xl border bg-muted/20 p-4 space-y-3" data-testid="section-vehicle-involved">
          <p className="text-sm font-semibold flex items-center gap-2">
            <Car className="h-4 w-4" />
            Vehicle details
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Type</Label>
              <Select value={readInvolvement(customFields).vehicleType || ""} onValueChange={(v) => setField("vehicleType", v)}>
                <SelectTrigger data-testid="select-vehicle-type">
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="car">Car</SelectItem>
                  <SelectItem value="bakkie">Bakkie / LDV</SelectItem>
                  <SelectItem value="motorcycle">Motorcycle</SelectItem>
                  <SelectItem value="truck">Truck</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Colour</Label>
              <Input
                value={readInvolvement(customFields).vehicleColour}
                onChange={(e) => setField("vehicleColour", e.target.value)}
                placeholder="e.g. White"
                data-testid="input-vehicle-colour"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Registration (if known)</Label>
              <Input
                value={readInvolvement(customFields).vehicleRegistration}
                onChange={(e) => setField("vehicleRegistration", e.target.value)}
                placeholder="Number plate"
                data-testid="input-vehicle-registration"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Make / model</Label>
              <Input
                value={readInvolvement(customFields).vehicleDescription}
                onChange={(e) => setField("vehicleDescription", e.target.value)}
                placeholder="e.g. White Toyota Hilux"
                data-testid="input-vehicle-description"
              />
            </div>
          </div>
          <InvolvementPhotoPicker
            label="Photos"
            testIdPrefix="vehicle"
            urls={inv.vehiclePhotoUrls}
            onChange={(urls) => setPhotoUrls("vehiclePhotoUrls", urls)}
          />
        </div>
      )}
    </div>
  );
}
