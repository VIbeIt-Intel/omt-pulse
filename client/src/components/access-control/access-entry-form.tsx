import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ACCESS_ENTRY_CATEGORIES, type AccessEntryCategory } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { prepareAndUploadFile } from "@/lib/upload-media";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import { currentlyInsideQueryKey } from "@/lib/access-control-queries";
import { readLicenceDiscFromPhoto } from "@/lib/licence-disc-ocr";
import type { ParsedSaVehicleDisc } from "@/lib/parse-sa-barcodes";
import { AccessScanDialog } from "@/components/access-control/access-scan-dialog";
import { Camera, Car, Loader2, ScanLine, User } from "lucide-react";
import type { Destination } from "@shared/schema";

type AccessEntryFormProps = {
  destinations: Destination[];
  onCreated: () => void;
};

const emptyVehicle = {
  registration: "",
  make: "",
  model: "",
  colour: "",
  licenceDiscData: "",
};

export function AccessEntryForm({ destinations, onCreated }: AccessEntryFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const personPhotoRef = useRef<HTMLInputElement>(null);
  const vehiclePhotoRef = useRef<HTMLInputElement>(null);
  const discPhotoRef = useRef<HTMLInputElement>(null);

  const [category, setCategory] = useState<AccessEntryCategory>("visitor");
  const [destinationId, setDestinationId] = useState("");
  const [personFullName, setPersonFullName] = useState("");
  const [personIdNumber, setPersonIdNumber] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [hasVehicle, setHasVehicle] = useState(false);
  const [vehicle, setVehicle] = useState(emptyVehicle);
  const [personPhotoUrl, setPersonPhotoUrl] = useState<string | null>(null);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanTarget, setScanTarget] = useState<"national_id" | "drivers_licence" | "disc" | null>(null);
  const [licenceScanNote, setLicenceScanNote] = useState<string | null>(null);
  const [discScanNote, setDiscScanNote] = useState<string | null>(null);
  const [discPhotoBusy, setDiscPhotoBusy] = useState(false);

  function applyDiscScan(parsed: ParsedSaVehicleDisc) {
    setVehicle((v) => ({
      ...v,
      licenceDiscData: parsed.licenceDiscData || v.licenceDiscData,
      registration: parsed.registration ?? v.registration,
      make: parsed.make ?? v.make,
      model: parsed.model ?? v.model,
      colour: parsed.colour ?? v.colour,
    }));
    setDiscScanNote(parsed.hint ?? null);
  }

  function buildLicenceNote(parsed: ReturnType<typeof parseSaIdentityScan>): string | null {
    if (parsed.documentType !== "drivers_licence") return null;
    const parts: string[] = [];
    if (parsed.driversLicenceNumber) parts.push(`DL ${parsed.driversLicenceNumber}`);
    if (parsed.licenceExpiryDate) parts.push(`expires ${parsed.licenceExpiryDate}`);
    if (parsed.vehicleCodes?.length) parts.push(`codes ${parsed.vehicleCodes.join(", ")}`);
    if (parsed.prdpCode) parts.push(`PrDP ${parsed.prdpCode}`);
    if (parsed.prdpExpiryDate) parts.push(`PrDP exp ${parsed.prdpExpiryDate}`);
    return parts.length ? parts.join(" · ") : null;
  }

  async function uploadPhoto(file: File, setter: (url: string) => void) {
    setUploading(true);
    try {
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "compact" });
      setter(objectUrl);
    } catch (e) {
      toast({
        title: "Photo upload failed",
        description: e instanceof Error ? e.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      const destId = parseInt(destinationId, 10);
      if (!destinationId || isNaN(destId)) {
        throw new Error("Select a destination");
      }
      if (!personFullName.trim()) {
        throw new Error("Enter the person's name");
      }
      const body: Record<string, unknown> = {
        category,
        destinationId: destId,
        personFullName: personFullName.trim(),
        personIdNumber: personIdNumber.trim() || null,
        companyName: companyName.trim() || null,
        contactNumber: contactNumber.trim() || null,
        purpose: purpose.trim() || null,
        personPhotoUrl,
        vehiclePhotoUrl: hasVehicle ? vehiclePhotoUrl : null,
      };
      if (hasVehicle) {
        body.vehicle = {
          registration: vehicle.registration.trim() || null,
          make: vehicle.make.trim() || null,
          model: vehicle.model.trim() || null,
          colour: vehicle.colour.trim() || null,
          licenceDiscData: vehicle.licenceDiscData.trim() || null,
        };
      }
      return apiRequest("POST", "/api/access-control/entries", body);
    },
    onSuccess: () => {
      toast({
        title: "Checked in",
        description: "Person is inside. Use Check out tab to scan them on exit.",
      });
      setPersonFullName("");
      setPersonIdNumber("");
      setCompanyName("");
      setContactNumber("");
      setPurpose("");
      setHasVehicle(false);
      setVehicle(emptyVehicle);
      setPersonPhotoUrl(null);
      setVehiclePhotoUrl(null);
      setLicenceScanNote(null);
      void qc.invalidateQueries({ queryKey: currentlyInsideQueryKey });
      onCreated();
    },
    onError: (e: Error) => {
      toast({ title: "Could not log entry", description: e.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-5 pb-6">
      <div>
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Category</Label>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ACCESS_ENTRY_CATEGORIES.map((cat) => (
            <Button
              key={cat}
              type="button"
              variant={category === cat ? "default" : "outline"}
              className="h-11 justify-start text-sm"
              onClick={() => setCategory(cat)}
            >
              {ACCESS_CATEGORY_LABELS[cat]}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <Label htmlFor="ac-destination">Destination *</Label>
        <Select value={destinationId} onValueChange={setDestinationId}>
          <SelectTrigger id="ac-destination" className="mt-1.5 h-11">
            <SelectValue placeholder="Select destination" />
          </SelectTrigger>
          <SelectContent>
            {destinations.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center gap-2 font-medium text-sm">
          <User className="h-4 w-4" />
          Person
        </div>
        <div>
          <Label htmlFor="ac-name">Full name *</Label>
          <Input
            id="ac-name"
            className="mt-1 h-11"
            value={personFullName}
            onChange={(e) => setPersonFullName(e.target.value)}
            placeholder="Full name"
            autoComplete="name"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="flex-1">
            <Label htmlFor="ac-id">ID number</Label>
            <Input
              id="ac-id"
              className="mt-1 h-11"
              value={personIdNumber}
              onChange={(e) => setPersonIdNumber(e.target.value)}
              placeholder="ID or passport"
            />
          </div>
          <div className="flex gap-2 mt-6 shrink-0">
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 sm:flex-none"
              onClick={() => setScanTarget("national_id")}
            >
              <ScanLine className="h-4 w-4 mr-1" />
              Scan ID
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 flex-1 sm:flex-none"
              onClick={() => setScanTarget("drivers_licence")}
            >
              <ScanLine className="h-4 w-4 mr-1" />
              Scan licence
            </Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">
          <span className="font-medium">Scan ID</span> for Smart ID or ID book (Binary Eye).
          <span className="font-medium">Scan licence</span> — Binary Eye barcode scan; photo of front if needed.
        </p>
        {licenceScanNote && (
          <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
            {licenceScanNote}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label htmlFor="ac-company">Company</Label>
            <Input
              id="ac-company"
              className="mt-1"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="ac-phone">Contact</Label>
            <Input
              id="ac-phone"
              className="mt-1"
              type="tel"
              value={contactNumber}
              onChange={(e) => setContactNumber(e.target.value)}
            />
          </div>
        </div>
        <div>
          <Label htmlFor="ac-purpose">Purpose</Label>
          <Textarea
            id="ac-purpose"
            className="mt-1 min-h-[72px]"
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
            placeholder="Reason for visit"
          />
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={personPhotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPhoto(f, setPersonPhotoUrl);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => personPhotoRef.current?.click()}
          >
            <Camera className="h-4 w-4 mr-1" />
            {personPhotoUrl ? "Person photo added" : "Person photo"}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Car className="h-4 w-4" />
          Vehicle on entry
        </div>
        <Switch checked={hasVehicle} onCheckedChange={setHasVehicle} />
      </div>

      {hasVehicle && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <Label htmlFor="ac-reg">Registration</Label>
            <Input
              id="ac-reg"
              className="mt-1 h-11 uppercase"
              value={vehicle.registration}
              onChange={(e) => setVehicle((v) => ({ ...v, registration: e.target.value }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0"
              onClick={() => setScanTarget("disc")}
            >
              <ScanLine className="h-4 w-4 mr-1" />
              Scan disc
            </Button>
            <input
              ref={discPhotoRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                e.target.value = "";
                setDiscPhotoBusy(true);
                void readLicenceDiscFromPhoto(f)
                  .then((result) => {
                    if (result.ok) {
                      applyDiscScan(result.parsed);
                      toast({
                        title: "Licence disc captured",
                        description:
                          [result.parsed.registration, result.parsed.make, result.parsed.model]
                            .filter(Boolean)
                            .join(" · ") || "Details filled in",
                      });
                    } else {
                      toast({
                        title: "Could not read disc",
                        description: result.message,
                        variant: "destructive",
                      });
                    }
                  })
                  .finally(() => setDiscPhotoBusy(false));
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="h-11 shrink-0"
              disabled={discPhotoBusy}
              onClick={() => discPhotoRef.current?.click()}
            >
              <Camera className="h-4 w-4 mr-1" />
              {discPhotoBusy ? "Reading…" : "Photo of disc"}
            </Button>
          </div>
          {discScanNote && (
            <p className="text-xs text-muted-foreground">{discScanNote}</p>
          )}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label>Make</Label>
              <Input
                className="mt-1"
                value={vehicle.make}
                onChange={(e) => setVehicle((v) => ({ ...v, make: e.target.value }))}
              />
            </div>
            <div>
              <Label>Model</Label>
              <Input
                className="mt-1"
                value={vehicle.model}
                onChange={(e) => setVehicle((v) => ({ ...v, model: e.target.value }))}
              />
            </div>
            <div>
              <Label>Colour</Label>
              <Input
                className="mt-1"
                value={vehicle.colour}
                onChange={(e) => setVehicle((v) => ({ ...v, colour: e.target.value }))}
              />
            </div>
          </div>
          <input
            ref={vehiclePhotoRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void uploadPhoto(f, setVehiclePhotoUrl);
              e.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => vehiclePhotoRef.current?.click()}
          >
            <Camera className="h-4 w-4 mr-1" />
            {vehiclePhotoUrl ? "Vehicle photo added" : "Vehicle photo"}
          </Button>
        </div>
      )}

      <Button
        type="button"
        className="w-full h-12 text-base"
        disabled={createMutation.isPending || uploading || !destinationId || !personFullName.trim()}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Logging check-in…
          </>
        ) : (
          "Check in"
        )}
      </Button>

      <AccessScanDialog
        open={scanTarget !== null}
        kind={scanTarget}
        onOpenChange={(o) => {
          if (!o) setScanTarget(null);
        }}
        onIdScan={(parsed) => {
          if (parsed.personFullName) setPersonFullName(parsed.personFullName);
          if (parsed.personIdNumber) setPersonIdNumber(parsed.personIdNumber);
          setLicenceScanNote(null);
        }}
        onLicenceScan={(parsed) => {
          if (parsed.personFullName) setPersonFullName(parsed.personFullName);
          if (parsed.personIdNumber) setPersonIdNumber(parsed.personIdNumber);
          setLicenceScanNote(buildLicenceNote(parsed));
        }}
        onDiscScan={(parsed) => {
          applyDiscScan(parsed);
        }}
      />
    </div>
  );
}
