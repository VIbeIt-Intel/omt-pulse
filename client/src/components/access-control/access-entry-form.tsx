import { useId, useRef, useState } from "react";
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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  enqueueOutboxJob,
  fileToDataUrl,
  isProbablyOffline,
} from "@/lib/offline-outbox";
import { prepareAndUploadFile } from "@/lib/upload-media";
import { ACCESS_CATEGORY_LABELS } from "@/lib/access-control-labels";
import { currentlyInsideQueryKey } from "@/lib/access-control-queries";
import { readLicenceDiscFromPhoto } from "@/lib/licence-disc-ocr";
import type { ParsedSaId, ParsedSaVehicleDisc } from "@/lib/parse-sa-barcodes";
import { AccessScanDialog, type AccessScanCaptureMeta } from "@/components/access-control/access-scan-dialog";
import {
  buildAccessScanData,
  formatAccessScanDetailLines,
  formatAccessScanSummary,
  type AccessScanData,
} from "@shared/access-scan-data";
import {
  Camera,
  Car,
  ChevronDown,
  Loader2,
  Plus,
  ScanLine,
  Trash2,
  User,
  UserPlus,
} from "lucide-react";
import type { Destination } from "@shared/schema";
import { cn } from "@/lib/utils";

type AccessEntryFormProps = {
  destinations: Destination[];
  onCreated: () => void;
};

type EntryMode = "walk_in" | "vehicle";

type PersonDraft = {
  key: string;
  fullName: string;
  idNumber: string;
  photoUrl: string | null;
  licenceNote: string | null;
  scanData: AccessScanData | null;
  showManual: boolean;
};

const emptyVehicle = {
  registration: "",
  make: "",
  model: "",
  colour: "",
  licenceDiscData: "",
};

function newPersonKey(): string {
  return crypto.randomUUID();
}

function emptyPerson(showManual = false): PersonDraft {
  return {
    key: newPersonKey(),
    fullName: "",
    idNumber: "",
    photoUrl: null,
    licenceNote: null,
    scanData: null,
    showManual,
  };
}

function buildLicenceNote(parsed: ParsedSaId): string | null {
  if (parsed.documentType !== "drivers_licence") return null;
  const parts: string[] = [];
  if (parsed.driversLicenceNumber) parts.push(`DL ${parsed.driversLicenceNumber}`);
  if (parsed.licenceExpiryDate) parts.push(`expires ${parsed.licenceExpiryDate}`);
  if (parsed.vehicleCodes?.length) parts.push(`codes ${parsed.vehicleCodes.join(", ")}`);
  if (parsed.prdpCode) parts.push(`PrDP ${parsed.prdpCode}`);
  if (parsed.prdpExpiryDate) parts.push(`PrDP exp ${parsed.prdpExpiryDate}`);
  return parts.length ? parts.join(" · ") : null;
}

function applyIdentityToPerson(
  person: PersonDraft,
  parsed: ParsedSaId,
  opts: { isLicence: boolean; meta: AccessScanCaptureMeta },
): PersonDraft {
  const scanData = buildAccessScanData(parsed, opts.meta.scanMethod, opts.meta.rawBarcode);
  return {
    ...person,
    fullName: parsed.personFullName ?? person.fullName,
    idNumber: parsed.personIdNumber ?? person.idNumber,
    licenceNote: opts.isLicence ? buildLicenceNote(parsed) : person.licenceNote,
    scanData: scanData ?? person.scanData,
    showManual: true,
  };
}

export function AccessEntryForm({ destinations, onCreated }: AccessEntryFormProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const vehiclePhotoRef = useRef<HTMLInputElement>(null);
  const discPhotoRef = useRef<HTMLInputElement>(null);
  const personPhotoRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const [mode, setMode] = useState<EntryMode>("walk_in");
  const [category, setCategory] = useState<AccessEntryCategory>("visitor");
  const [destinationId, setDestinationId] = useState("");
  const [people, setPeople] = useState<PersonDraft[]>([emptyPerson()]);
  const [companyName, setCompanyName] = useState("");
  const [contactNumber, setContactNumber] = useState("");
  const [purpose, setPurpose] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [vehicle, setVehicle] = useState(emptyVehicle);
  const [vehicleManual, setVehicleManual] = useState(false);
  const [vehiclePhotoUrl, setVehiclePhotoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [scanTarget, setScanTarget] = useState<"national_id" | "drivers_licence" | "disc" | null>(null);
  const [scanPersonKey, setScanPersonKey] = useState<string | null>(null);
  const [discScanNote, setDiscScanNote] = useState<string | null>(null);
  const [discPhotoBusy, setDiscPhotoBusy] = useState(false);

  function updatePerson(key: string, patch: Partial<PersonDraft>) {
    setPeople((list) => list.map((p) => (p.key === key ? { ...p, ...patch } : p)));
  }

  function setModeAndReset(next: EntryMode) {
    setMode(next);
    setPeople([emptyPerson()]);
    setVehicle(emptyVehicle);
    setVehicleManual(false);
    setVehiclePhotoUrl(null);
    setDiscScanNote(null);
  }

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
    setVehicleManual(true);
  }

  async function uploadPhoto(file: File, setter: (url: string) => void) {
    setUploading(true);
    try {
      if (isProbablyOffline()) {
        setter(await fileToDataUrl(file));
        return;
      }
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "compact" });
      setter(objectUrl);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Try again";
      if (/fetch|network|failed|offline/i.test(msg) || isProbablyOffline()) {
        try {
          setter(await fileToDataUrl(file));
          toast({
            title: "Photo saved on device",
            description: "Will upload when you’re back online.",
          });
          return;
        } catch {
          /* fall through */
        }
      }
      toast({
        title: "Photo upload failed",
        description: msg,
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  }

  const readyPeople = people.filter((p) => p.fullName.trim());
  const vehicleReady =
    mode === "walk_in" ||
    !!vehicle.registration.trim() ||
    !!vehicle.licenceDiscData.trim();
  const canSubmit = !!destinationId && readyPeople.length > 0 && vehicleReady;

  const createMutation = useMutation({
    mutationFn: async () => {
      const destId = parseInt(destinationId, 10);
      if (!destinationId || isNaN(destId)) {
        throw new Error("Select a destination");
      }
      if (!readyPeople.length) {
        throw new Error("Add at least one person");
      }
      if (mode === "vehicle" && !vehicle.registration.trim() && !vehicle.licenceDiscData.trim()) {
        throw new Error("Scan the disc or enter the vehicle registration");
      }

      const body: Record<string, unknown> = {
        category,
        destinationId: destId,
        companyName: companyName.trim() || null,
        contactNumber: contactNumber.trim() || null,
        purpose: purpose.trim() || null,
        vehiclePhotoUrl: mode === "vehicle" ? vehiclePhotoUrl : null,
        people: people
          .map((p, index) => ({ p, index }))
          .filter(({ p }) => p.fullName.trim())
          .map(({ p, index }) => ({
            personFullName: p.fullName.trim(),
            personIdNumber: p.idNumber.trim() || null,
            personPhotoUrl: p.photoUrl,
            scanData: p.scanData,
            partyRole:
              mode === "walk_in" ? "walk_in" : index === 0 ? "driver" : "passenger",
          })),
      };

      if (mode === "vehicle") {
        body.vehicle = {
          registration: vehicle.registration.trim() || null,
          make: vehicle.make.trim() || null,
          model: vehicle.model.trim() || null,
          colour: vehicle.colour.trim() || null,
          licenceDiscData: vehicle.licenceDiscData.trim() || null,
        };
      }

      if (isProbablyOffline()) {
        await enqueueOutboxJob({ type: "access_control", body });
        return { queued: true as const };
      }

      try {
        await apiRequest("POST", "/api/access-control/entries", body);
        return { queued: false as const };
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (/fetch|network|failed|offline|timeout/i.test(msg) || isProbablyOffline()) {
          await enqueueOutboxJob({ type: "access_control", body });
          return { queued: true as const };
        }
        throw e;
      }
    },
    onSuccess: (result) => {
      const count = readyPeople.length;
      if (result?.queued) {
        toast({
          title: "Check-in saved offline",
          description: "Will sync when you’re back online.",
        });
      } else {
        toast({
          title: count > 1 ? `Checked in ${count} people` : "Checked in",
          description:
            count > 1
              ? "Party is inside. Use Check out to scan each person on exit."
              : "Person is inside. Use Check out tab to scan them on exit.",
        });
      }
      setPeople([emptyPerson()]);
      setCompanyName("");
      setContactNumber("");
      setPurpose("");
      setDetailsOpen(false);
      setVehicle(emptyVehicle);
      setVehicleManual(false);
      setVehiclePhotoUrl(null);
      setDiscScanNote(null);
      void qc.invalidateQueries({ queryKey: currentlyInsideQueryKey });
      onCreated();
    },
    onError: (e: Error) => {
      toast({ title: "Could not log entry", description: e.message, variant: "destructive" });
    },
  });

  function openPersonScan(personKey: string, kind: "national_id" | "drivers_licence") {
    setScanPersonKey(personKey);
    setScanTarget(kind);
  }

  return (
    <div className="space-y-5 pb-6">
      <div>
        <Label className="text-xs text-muted-foreground uppercase tracking-wide">Entry type</Label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={mode === "walk_in" ? "default" : "outline"}
            className="h-12 justify-start gap-2"
            onClick={() => setModeAndReset("walk_in")}
          >
            <User className="h-4 w-4" />
            Walk-in
          </Button>
          <Button
            type="button"
            variant={mode === "vehicle" ? "default" : "outline"}
            className="h-12 justify-start gap-2"
            onClick={() => setModeAndReset("vehicle")}
          >
            <Car className="h-4 w-4" />
            Vehicle
          </Button>
        </div>
      </div>

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

      {mode === "vehicle" && (
        <div className="space-y-3 rounded-lg border p-4">
          <div className="flex items-center gap-2 font-medium text-sm">
            <Car className="h-4 w-4" />
            Vehicle
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={vehicleManual || vehicle.registration ? "outline" : "default"}
              className="h-11 flex-1 sm:flex-none"
              onClick={() => {
                setScanPersonKey(null);
                setScanTarget("disc");
              }}
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
              className="h-11 flex-1 sm:flex-none"
              disabled={discPhotoBusy}
              onClick={() => discPhotoRef.current?.click()}
            >
              <Camera className="h-4 w-4 mr-1" />
              {discPhotoBusy ? "Reading…" : "Photo of disc"}
            </Button>
          </div>

          {!vehicleManual && !vehicle.registration ? (
            <Button
              type="button"
              variant="ghost"
              className="h-9 px-0 text-muted-foreground"
              onClick={() => setVehicleManual(true)}
            >
              No disc — enter manually
            </Button>
          ) : (
            <div className="space-y-3">
              {discScanNote && (
                <p className="text-xs text-muted-foreground">{discScanNote}</p>
              )}
              <div>
                <Label htmlFor="ac-reg">Registration *</Label>
                <Input
                  id="ac-reg"
                  className="mt-1 h-11 uppercase"
                  value={vehicle.registration}
                  onChange={(e) => setVehicle((v) => ({ ...v, registration: e.target.value }))}
                  placeholder="e.g. CA 123-456"
                />
              </div>
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
        </div>
      )}

      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 font-medium text-sm">
            <User className="h-4 w-4" />
            {mode === "vehicle" ? "People in vehicle" : "Person"}
          </div>
          {mode === "vehicle" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPeople((list) => [...list, emptyPerson()])}
            >
              <UserPlus className="h-4 w-4 mr-1" />
              Add person
            </Button>
          )}
        </div>

        {people.map((person, index) => (
          <PersonCard
            key={person.key}
            person={person}
            index={index}
            mode={mode}
            canRemove={mode === "vehicle" && people.length > 1}
            uploading={uploading}
            photoRef={(el) => {
              personPhotoRefs.current[person.key] = el;
            }}
            onScanId={() => openPersonScan(person.key, "national_id")}
            onScanLicence={() => openPersonScan(person.key, "drivers_licence")}
            onShowManual={() => updatePerson(person.key, { showManual: true })}
            onChange={(patch) => updatePerson(person.key, patch)}
            onRemove={() => setPeople((list) => list.filter((p) => p.key !== person.key))}
            onPhoto={(file) =>
              void uploadPhoto(file, (url) => updatePerson(person.key, { photoUrl: url }))
            }
            onPickPhoto={() => personPhotoRefs.current[person.key]?.click()}
          />
        ))}
      </div>

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <CollapsibleTrigger asChild>
          <Button type="button" variant="ghost" className="w-full justify-between h-10 px-0">
            <span className="text-sm text-muted-foreground">Company, contact & purpose</span>
            <ChevronDown className={cn("h-4 w-4 transition-transform", detailsOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-1">
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
        </CollapsibleContent>
      </Collapsible>

      <Button
        type="button"
        className="w-full h-12 text-base"
        disabled={createMutation.isPending || uploading || !canSubmit}
        onClick={() => createMutation.mutate()}
      >
        {createMutation.isPending ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Logging check-in…
          </>
        ) : readyPeople.length > 1 ? (
          `Check in ${readyPeople.length} people`
        ) : (
          "Check in"
        )}
      </Button>

      <AccessScanDialog
        open={scanTarget !== null}
        kind={scanTarget}
        onOpenChange={(o) => {
          if (!o) {
            setScanTarget(null);
            setScanPersonKey(null);
          }
        }}
        onIdScan={(parsed, meta) => {
          if (!scanPersonKey) return;
          setPeople((list) =>
            list.map((p) =>
              p.key === scanPersonKey ? applyIdentityToPerson(p, parsed, { isLicence: false, meta }) : p,
            ),
          );
        }}
        onLicenceScan={(parsed, meta) => {
          if (!scanPersonKey) return;
          setPeople((list) =>
            list.map((p) =>
              p.key === scanPersonKey ? applyIdentityToPerson(p, parsed, { isLicence: true, meta }) : p,
            ),
          );
        }}
        onDiscScan={(parsed) => {
          applyDiscScan(parsed);
        }}
      />
    </div>
  );
}

function PersonCard({
  person,
  index,
  mode,
  canRemove,
  uploading,
  photoRef,
  onScanId,
  onScanLicence,
  onShowManual,
  onChange,
  onRemove,
  onPhoto,
  onPickPhoto,
}: {
  person: PersonDraft;
  index: number;
  mode: EntryMode;
  canRemove: boolean;
  uploading: boolean;
  photoRef: (el: HTMLInputElement | null) => void;
  onScanId: () => void;
  onScanLicence: () => void;
  onShowManual: () => void;
  onChange: (patch: Partial<PersonDraft>) => void;
  onRemove: () => void;
  onPhoto: (file: File) => void;
  onPickPhoto: () => void;
}) {
  const baseId = useId();
  const roleLabel =
    mode === "walk_in" ? "Person" : index === 0 ? "Driver" : `Passenger ${index}`;
  const hasIdentity = !!(person.fullName.trim() || person.idNumber.trim());

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{roleLabel}</p>
        {canRemove && (
          <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={onRemove}>
            <Trash2 className="h-4 w-4 mr-1" />
            Remove
          </Button>
        )}
      </div>

      {!person.showManual && !hasIdentity ? (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Button type="button" className="h-11 flex-1" onClick={onScanId}>
              <ScanLine className="h-4 w-4 mr-1" />
              Scan ID
            </Button>
            <Button type="button" className="h-11 flex-1" onClick={onScanLicence}>
              <ScanLine className="h-4 w-4 mr-1" />
              Scan licence
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Scan ID for Smart ID or ID book. Scan licence for driver&apos;s licence barcode.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-0 text-muted-foreground"
            onClick={onShowManual}
          >
            <Plus className="h-4 w-4 mr-1" />
            No ID — enter manually
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onScanId}>
              <ScanLine className="h-4 w-4 mr-1" />
              Scan ID
            </Button>
            <Button type="button" variant="outline" className="h-11 flex-1" onClick={onScanLicence}>
              <ScanLine className="h-4 w-4 mr-1" />
              Scan licence
            </Button>
          </div>
          {person.licenceNote && (
            <p className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2">
              {person.licenceNote}
            </p>
          )}
          {person.scanData && (
            <div className="text-xs text-muted-foreground rounded-md border bg-muted/40 px-3 py-2 space-y-1">
              {formatAccessScanSummary(person.scanData) && (
                <p className="font-medium text-foreground/90">{formatAccessScanSummary(person.scanData)}</p>
              )}
              {formatAccessScanDetailLines(person.scanData).map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          )}
          <div>
            <Label htmlFor={`${baseId}-name`}>Full name *</Label>
            <Input
              id={`${baseId}-name`}
              className="mt-1 h-11"
              value={person.fullName}
              onChange={(e) => onChange({ fullName: e.target.value })}
              placeholder="Full name"
              autoComplete="name"
            />
          </div>
          <div>
            <Label htmlFor={`${baseId}-id`}>ID number</Label>
            <Input
              id={`${baseId}-id`}
              className="mt-1 h-11"
              value={person.idNumber}
              onChange={(e) => onChange({ idNumber: e.target.value })}
              placeholder="ID or passport"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={photoRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onPhoto(f);
                e.target.value = "";
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={onPickPhoto}>
              <Camera className="h-4 w-4 mr-1" />
              {person.photoUrl ? "Person photo added" : "Person photo"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
