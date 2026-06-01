import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Category, Location, Incident, FormField, Attachment, CustomMap } from "@shared/schema";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Form,
  FormControl,
  FormField as FormFieldComponent,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CustomMapPicker } from "./custom-map-picker";
import {
  IncidentInvolvementSection,
  INVOLVEMENT_FIELD_KEYS,
  readInvolvement,
} from "./incident-involvement-section";
import { CalendarIcon, Clock, MapPin, Upload, Paperclip, X, FileText, Loader2, Camera, Mic, Square, Globe, Map, LocateFixed } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

const incidentFormSchema = z.object({
  incidentDate: z.string().min(1, "Date is required"),
  incidentTime: z.string().min(1, "Time is required"),
  locationId: z.number().optional().nullable(),
  locationName: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  customMapId: z.number().optional().nullable(),
  customMapX: z.number().optional().nullable(),
  customMapY: z.number().optional().nullable(),
  categoryId: z.number().optional().nullable(),
  otherCategoryNote: z.string().optional().nullable(),
  description: z.string().max(500, "Description cannot exceed 500 characters").optional().nullable(),
  customFields: z.record(z.any()).optional().nullable(),
});

type IncidentFormValues = z.infer<typeof incidentFormSchema>;

interface IncidentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incident?: Incident | null;
}

interface AttachmentsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  incidentId: number;
}

function isFieldVisible(fields: FormField[], key: string, _fieldsLoaded: boolean): boolean {
  const field = fields.find((f) => f.fieldKey === key);
  if (field) return field.isVisible;
  // Field not configured for this command — show by default.
  // This handles new commands that have no form-field config yet, so reporters
  // still see the full form rather than a blank Evidence-only dialog.
  return true;
}

function AttachmentPreview({ url, alt, mimeType, filename }: { url: string; alt: string; mimeType?: string; filename?: string }) {
  const isServable = url.startsWith("data:") || url.startsWith("/objects/") || url.startsWith("https://") || url.startsWith("http://");
  const [broken, setBroken] = useState(() => !isServable);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (mimeType?.startsWith("audio/")) {
    return (
      <div className="flex flex-col gap-1 p-2 border border-border rounded-md bg-muted/30">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mic className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[160px]">{filename ?? alt}</span>
        </div>
        <audio controls src={url} className="w-full h-8" />
      </div>
    );
  }

  if (mimeType && !mimeType.startsWith("image/")) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 p-2 border border-border rounded-md text-xs text-primary hover:underline bg-muted/30"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[160px]">{filename ?? alt}</span>
      </a>
    );
  }

  if (broken) {
    return (
      <div className="flex flex-col items-center justify-center h-20 text-muted-foreground gap-1">
        <FileText className="h-6 w-6 opacity-40" />
        <span className="text-xs opacity-60">File unavailable</span>
      </div>
    );
  }
  return (
    <>
      <button
        type="button"
        className="w-full block cursor-zoom-in focus:outline-none"
        onClick={() => setLightboxOpen(true)}
        aria-label={`View ${filename ?? alt}`}
      >
        <img
          src={url}
          alt={alt}
          className="w-full h-20 object-cover rounded"
          onError={() => setBroken(true)}
        />
      </button>
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-3xl p-2 bg-black/90 border-0" hideDefaultClose>
          <DialogTitle className="sr-only">{filename ?? alt}</DialogTitle>
          <DialogClose className="absolute right-3 top-3 z-10 rounded-full bg-black/75 hover:bg-black/95 text-white border border-white/30 p-2 transition-colors focus:outline-none">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
          <img
            src={url}
            alt={alt}
            className="w-full max-h-[85vh] object-contain rounded"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

interface PendingAttachment {
  url: string;
  filename: string;
  mimeType: string;
}

type LocationMode = "geographic" | "customMap";

export function IncidentDialog({ open, onOpenChange, incident }: IncidentDialogProps) {
  const { toast } = useToast();
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [pendingLatLng, setPendingLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<Attachment[]>([]);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [locationMode, setLocationMode] = useState<LocationMode>("geographic");
  const [selectedCustomMapId, setSelectedCustomMapId] = useState<number | null>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<google.maps.Map | null>(null);
  const pinRef = useRef<google.maps.Marker | null>(null);
  const geocoderRef = useRef<google.maps.Geocoder | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [uploadSource, setUploadSource] = useState<"file" | "camera" | "voice" | null>(null);

  const { data: categories = [] } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });

  const { data: locations = [] } = useQuery<Location[]>({
    queryKey: ["/api/locations"],
  });

  const { data: customMaps = [] } = useQuery<CustomMap[]>({
    queryKey: ["/api/custom-maps"],
  });

  const { data: currentUser } = useQuery<{
    id: string;
    role: string;
    canManageAttachments: boolean;
  }>({
    queryKey: ["/api/auth/me"],
  });
  const userCanManageAttachments = currentUser?.role === "administrator" || (currentUser?.canManageAttachments ?? true);

  const { data: locationAssignments } = useQuery<{ locationIds: number[] }>({
    queryKey: ["/api/users", currentUser?.id, "location-assignments"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${currentUser!.id}/location-assignments`, { credentials: "include" });
      return res.json();
    },
    enabled: !!currentUser?.id && (currentUser?.role === "supervisor" || currentUser?.role === "reporter"),
  });

  const allowedLocations = (() => {
    if (!currentUser || currentUser.role === "administrator") return locations;
    const assigned = locationAssignments?.locationIds ?? [];
    if (assigned.length === 0) return locations;
    return locations.filter((l) => assigned.includes(l.id));
  })();

  const { data: formFields = [], isLoading: fieldsLoading } = useQuery<FormField[]>({
    queryKey: ["/api/form-fields"],
  });
  const fieldsLoaded = !fieldsLoading;

  type IncidentResponder = { id: number; userId: string; firstName: string; lastName: string; joinedAt: string; leftAt: string | null; arrivedAt: string | null; arrivalNote: string | null; lastLat: number | null; lastLng: number | null };
  const { data: incidentResponders = [] } = useQuery<IncidentResponder[]>({
    queryKey: ["/api/incidents", incident?.id, "responders"],
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${incident!.id}/responders`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!incident?.id && !!incident?.liveStartedAt,
    staleTime: 0,
  });

  const orgCustomFields = formFields.filter(
    (f) => !f.isSystem && f.isVisible && !INVOLVEMENT_FIELD_KEYS.has(f.fieldKey),
  );
  const [personInvolved, setPersonInvolved] = useState(false);
  const [vehicleInvolved, setVehicleInvolved] = useState(false);

  const form = useForm<IncidentFormValues>({
    resolver: zodResolver(incidentFormSchema),
    defaultValues: {
      incidentDate: new Date().toISOString().split("T")[0],
      incidentTime: new Date().toTimeString().slice(0, 5),
      locationId: null,
      locationName: null,
      latitude: null,
      longitude: null,
      customMapId: null,
      customMapX: null,
      customMapY: null,
      categoryId: null,
      otherCategoryNote: null,
      description: null,
      customFields: {},
    },
  });

  useEffect(() => {
    if (!open && isRecording) {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
      }
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      setIsRecording(false);
      setRecordingSeconds(0);
    }
    if (!open) {
      setAttachmentError(null);
    }
  }, [open]);

  useEffect(() => {
    setPendingAttachments([]);
    if (incident) {
      const hasCustomMap = incident.customMapId != null;
      const mode: LocationMode = hasCustomMap ? "customMap" : "geographic";
      setLocationMode(mode);
      setSelectedCustomMapId(incident.customMapId ?? null);
      form.reset({
        incidentDate: incident.incidentDate,
        incidentTime: incident.incidentTime,
        locationId: incident.locationId,
        locationName: incident.locationName,
        latitude: incident.latitude,
        longitude: incident.longitude,
        customMapId: incident.customMapId ?? null,
        customMapX: incident.customMapX ?? null,
        customMapY: incident.customMapY ?? null,
        categoryId: incident.categoryId,
        otherCategoryNote: incident.otherCategoryNote,
        description: incident.description,
        customFields: (incident.customFields as Record<string, string | number | null>) || {},
      });
      const inv = readInvolvement(incident.customFields as Record<string, string | number | null>);
      setPersonInvolved(inv.personInvolved);
      setVehicleInvolved(inv.vehicleInvolved);
      fetch(`/api/incidents/${incident.id}/attachments`, { credentials: "include" })
        .then(r => r.json())
        .then(data => setExistingAttachments(data))
        .catch(() => setExistingAttachments([]));
    } else {
      setLocationMode("geographic");
      setSelectedCustomMapId(null);
      setExistingAttachments([]);
      const defaults: Record<string, string | number | null> = {};
      orgCustomFields.forEach((f) => {
        defaults[f.fieldKey] = null;
      });
      setPersonInvolved(false);
      setVehicleInvolved(false);
      form.reset({
        incidentDate: new Date().toISOString().split("T")[0],
        incidentTime: new Date().toTimeString().slice(0, 5),
        locationId: null,
        locationName: null,
        latitude: null,
        longitude: null,
        customMapId: null,
        customMapX: null,
        customMapY: null,
        categoryId: null,
        otherCategoryNote: null,
        description: null,
        customFields: defaults,
      });
    }
  }, [incident, open]);

  const applyGpsPosition = (lat: number, lng: number) => {
    // Capture the GPS fix UNCONDITIONALLY. The raw lat/lng is what the incident
    // record, analytics map and live tracking actually need, and it must persist
    // even if the embedded picker map hasn't finished loading — on the native APK
    // WebView the Google Maps JS-API map can be slow or unavailable, and the old
    // `if (!map) return` guard silently discarded the position, saving incidents
    // with no location. The visual map is now treated as optional confirmation.
    setLocationError(null);
    setPendingLatLng({ lat, lng });
    form.setValue("latitude", lat);
    form.setValue("longitude", lng);
    form.setValue("locationId", null);
    form.setValue("locationName", `Dropped pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
    // Visual map updates only when the interactive map is available.
    const map = mapInstanceRef.current;
    if (map) {
      if (pinRef.current) pinRef.current.setMap(null);
      pinRef.current = new google.maps.Marker({ position: { lat, lng }, map, title: "My location" });
      map.setCenter({ lat, lng });
      map.setZoom(14);
    }
    // Reverse-geocode for a friendly place name. The geocoder is a standalone
    // service and works even when the visual map isn't ready.
    if (geocoderRef.current) {
      setMapLoading(true);
      geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
        setMapLoading(false);
        if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
          const address = results[0].formatted_address;
          const placeName =
            results[0].address_components?.find((component) =>
              component.types.some((type) =>
                [
                  "street_address",
                  "premise",
                  "subpremise",
                  "route",
                  "point_of_interest",
                  "establishment",
                  "neighborhood",
                  "sublocality",
                  "locality",
                  "administrative_area_level_3",
                  "administrative_area_level_2",
                ].includes(type)
              )
            )?.long_name ||
            results[0].address_components?.find((component) => !/^[A-Z0-9]{4}\+[A-Z0-9]{2}$/i.test(component.long_name))?.long_name ||
            address;
          setPendingAddress(address);
          form.setValue("locationName", placeName);
          if (pinRef.current) pinRef.current.setTitle(placeName);
        } else {
          setPendingAddress(null);
        }
      });
    }
  };

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationError("Location services are not available on this device.");
      return;
    }
    setGpsLoading(true);
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        applyGpsPosition(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => {
        setGpsLoading(false);
        if (err.code === err.PERMISSION_DENIED) {
          setLocationError("Location access was denied. Please enable location services in your device settings and try again.");
        } else if (err.code === err.POSITION_UNAVAILABLE) {
          setLocationError("Your location could not be determined. Please enable location services in your device settings and try again.");
        } else {
          setLocationError("Location request timed out. Please enable location services in your device settings and try again.");
        }
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  useEffect(() => {
    if (!mapModalOpen) return;
    setLocationError(null);
    loadGoogleMaps().then(() => {
      if (!mapRef.current || mapInstanceRef.current) return;
      const map = new google.maps.Map(mapRef.current, {
        center: { lat: -26.2041, lng: 28.0473 },
        zoom: 6,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: false,
        gestureHandling: "greedy",
      });
      mapInstanceRef.current = map;
      geocoderRef.current = new google.maps.Geocoder();

      const existingLat = form.getValues("latitude");
      const existingLng = form.getValues("longitude");
      if (existingLat != null && existingLng != null) {
        const pos = { lat: existingLat, lng: existingLng };
        map.setCenter(pos);
        map.setZoom(13);
        pinRef.current = new google.maps.Marker({ position: pos, map, title: "Selected location" });
      } else if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            if (mapInstanceRef.current) {
              applyGpsPosition(pos.coords.latitude, pos.coords.longitude);
            }
          },
          () => {},
          { timeout: 5000, maximumAge: 60000 }
        );
      }

      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        const latLng = e.latLng;
        if (!latLng || !geocoderRef.current) return;
        const lat = latLng.lat();
        const lng = latLng.lng();
        setPendingLatLng({ lat, lng });
        form.setValue("latitude", lat);
        form.setValue("longitude", lng);
        form.setValue("locationId", null);
        form.setValue("locationName", `Dropped pin (${lat.toFixed(5)}, ${lng.toFixed(5)})`);
        if (pinRef.current) {
          pinRef.current.setMap(null);
        }
        pinRef.current = new google.maps.Marker({ position: { lat, lng }, map, title: "Selected location" });
        map.setCenter({ lat, lng });
        map.setZoom(14);
        setMapLoading(true);
        geocoderRef.current.geocode({ location: { lat, lng } }, (results, status) => {
          setMapLoading(false);
          if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
            const result = results[0];
            const address = result.formatted_address;
            const placeName =
              result.address_components?.find((component) =>
                component.types.some((type) =>
                  [
                    "street_address",
                    "premise",
                    "subpremise",
                    "route",
                    "point_of_interest",
                    "establishment",
                    "neighborhood",
                    "sublocality",
                    "locality",
                    "administrative_area_level_3",
                    "administrative_area_level_2",
                  ].includes(type)
                )
              )?.long_name ||
              result.address_components?.find((component) => !/^[A-Z0-9]{4}\+[A-Z0-9]{2}$/i.test(component.long_name))?.long_name ||
              address;
            setPendingAddress(address);
            form.setValue("locationName", placeName);
            if (pinRef.current) pinRef.current.setTitle(placeName);
          } else {
            setPendingAddress(null);
          }
        });
      });
    });
    return () => {
      if (mapInstanceRef.current) {
        google.maps.event.clearInstanceListeners(mapInstanceRef.current);
        mapInstanceRef.current = null;
      }
      if (pinRef.current) {
        pinRef.current.setMap(null);
        pinRef.current = null;
      }
      setPendingLatLng(null);
      setPendingAddress(null);
      setMapLoading(false);
    };
  }, [mapModalOpen]);

  const mutation = useMutation({
    mutationFn: async (data: IncidentFormValues) => {
      let resolvedData = data;
      if (data.categoryId === -1) {
        const ensureResp = await apiRequest("POST", "/api/categories/ensure-other", {});
        const otherCat = await ensureResp.json();
        resolvedData = { ...data, categoryId: otherCat.id };
        queryClient.invalidateQueries({ queryKey: ["/api/categories"] });
      }
      let savedIncident: Incident;
      if (incident) {
        // If converting a live incident, try to capture the reporter's current GPS position
        let convertCoords: { liveConvertLat?: number; liveConvertLng?: number } = {};
        if (incident.isLive) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 10000 });
            });
            convertCoords = { liveConvertLat: pos.coords.latitude, liveConvertLng: pos.coords.longitude };
          } catch {
            // geolocation unavailable or denied — submit without it
          }
        }
        const resp = await apiRequest("PATCH", `/api/incidents/${incident.id}`, { ...resolvedData, ...convertCoords });
        savedIncident = await resp.json();
      } else {
        const resp = await apiRequest("POST", "/api/incidents", resolvedData);
        savedIncident = await resp.json();
      }
      if (pendingAttachments.length > 0) {
        for (const att of pendingAttachments) {
          await apiRequest("POST", `/api/incidents/${savedIncident.id}/attachments`, att);
        }
      }
      return savedIncident;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setPendingAttachments([]);
      toast({
        title: incident ? "Incident updated" : "Incident reported",
        description: incident ? "The incident has been updated successfully." : "A new incident has been recorded in the occurrence book.",
      });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const onSubmit = async (data: IncidentFormValues) => {
    const selectedCategory = categories.find((c) => c.id === data.categoryId);
    const isOtherSelected = data.categoryId === -1 || selectedCategory?.isOther;
    if (isOtherSelected && !data.otherCategoryNote?.trim()) {
      form.setError("otherCategoryNote", { message: "Please specify the occurrence type" });
      return;
    }
    let normalizedData = data;
    if (locationMode === "customMap") {
      normalizedData = { ...data, latitude: null, longitude: null, locationId: null, locationName: null };
    } else {
      normalizedData = { ...data, customMapId: null, customMapX: null, customMapY: null };
    }
    // Auto-geocode: if there's a free-text location name but no coordinates, try to resolve them silently.
    if (
      locationMode !== "customMap" &&
      normalizedData.locationName &&
      normalizedData.latitude == null &&
      normalizedData.longitude == null &&
      !normalizedData.locationId
    ) {
      try {
        await loadGoogleMaps();
        if (!geocoderRef.current) geocoderRef.current = new google.maps.Geocoder();
        const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
          geocoderRef.current!.geocode({ address: normalizedData.locationName!, componentRestrictions: { country: "za" } }, (results, status) => {
            if (status === google.maps.GeocoderStatus.OK && results?.[0]) {
              const loc = results[0].geometry.location;
              resolve({ lat: loc.lat(), lng: loc.lng() });
            } else {
              resolve(null);
            }
          });
        });
        if (coords) {
          normalizedData = { ...normalizedData, latitude: coords.lat, longitude: coords.lng };
        }
      } catch {
        // Geocoding failed — submit without coords rather than blocking the save
      }
    }
    mutation.mutate(normalizedData);
  };

  async function compressImageFile(file: File, maxPx = 1600, quality = 0.82): Promise<File> {
    return new Promise((resolve) => {
      const blobUrl = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
        canvas.toBlob(
          (blob) => resolve(blob ? new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" }) : file),
          "image/jpeg",
          quality
        );
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(file); };
      img.src = blobUrl;
    });
  }

  const handleAttachmentUpload = async (files: FileList | File[], source: "file" | "camera" | "voice" = "file") => {
    setUploadingAttachment(true);
    setUploadSource(source);
    try {
      const arr = Array.from(files);
      for (const file of arr) {
        // Compress images before uploading to keep storage size small
        const uploadFile = file.type.startsWith("image/") ? await compressImageFile(file) : file;
        const urlResp = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": uploadFile.type || "application/octet-stream" },
          body: uploadFile,
          credentials: "include",
        });
        if (!urlResp.ok) {
          const errData = await urlResp.json().catch(() => ({}));
          throw new Error(errData.message || "Failed to upload file");
        }
        const { objectUrl } = await urlResp.json();
        setPendingAttachments(prev => [...prev, { url: objectUrl, filename: uploadFile.name, mimeType: uploadFile.type || "application/octet-stream" }]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Could not upload the file. Please try again.";
      toast({ title: "Upload failed", description: msg, variant: "destructive" });
    } finally {
      setUploadingAttachment(false);
      setUploadSource(null);
    }
  };

  const handleTakePhoto = () => {
    setAttachmentError(null);
    // Click the hidden camera input synchronously — the previous implementation
    // called getUserMedia() first and then .click() after an await, which Android
    // Chrome blocks as a non-user-gesture action (silently drops the click and
    // loses dialog focus).  The <input capture="environment"> handles camera
    // permissions natively via the browser's own permission prompt.
    cameraInputRef.current?.click();
  };

  const startRecording = async () => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const supportedType = ["audio/webm", "audio/ogg", "audio/mp4"].find((t) =>
        MediaRecorder.isTypeSupported(t)
      );
      if (!supportedType) {
        stream.getTracks().forEach((t) => t.stop());
        toast({ title: "Recording not supported", description: "Your browser does not support audio recording.", variant: "destructive" });
        return;
      }
      const recorder = new MediaRecorder(stream, { mimeType: supportedType });
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream!.getTracks().forEach((t) => t.stop());
        const blob = new Blob(audioChunksRef.current, { type: supportedType });
        const ext = supportedType.split("/")[1] ?? "webm";
        const file = new File([blob], `voice-note-${Date.now()}.${ext}`, { type: supportedType });
        handleAttachmentUpload([file], "voice");
        if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
        setIsRecording(false);
        setRecordingSeconds(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => s + 1);
      }, 1000);
    } catch (err: unknown) {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      const isDenied = err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError");
      if (isDenied) {
        setAttachmentError("Microphone access was denied. Please enable microphone access in your device settings and try again.");
      } else {
        toast({
          title: "Recording failed",
          description: "Could not start recording. Please try again.",
          variant: "destructive",
        });
      }
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
  };

  const handleDeleteExistingAttachment = async (attachmentId: number) => {
    try {
      await apiRequest("DELETE", `/api/attachments/${attachmentId}`);
      setExistingAttachments(prev => prev.filter(a => a.id !== attachmentId));
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
    } catch {
      toast({ title: "Error", description: "Could not remove attachment.", variant: "destructive" });
    }
  };

  const handleLocationSelect = (locationId: number) => {
    const loc = locations.find((l) => l.id === locationId);
    if (loc) {
      form.setValue("locationId", loc.id);
      form.setValue("locationName", loc.name);
      if (loc.latitude && loc.longitude) {
        form.setValue("latitude", loc.latitude);
        form.setValue("longitude", loc.longitude);
      }
    }
  };

  const openMapPicker = () => {
    setMapModalOpen(true);
    setPendingLatLng(null);
    setPendingAddress(null);
  };

  const cancelMapModal = () => {
    setMapModalOpen(false);
    setPendingLatLng(null);
    setPendingAddress(null);
    setMapLoading(false);
  };

  const switchToGeographic = () => {
    setLocationMode("geographic");
    form.setValue("customMapId", null);
    form.setValue("customMapX", null);
    form.setValue("customMapY", null);
    setSelectedCustomMapId(null);
  };

  const switchToCustomMap = () => {
    setLocationMode("customMap");
    form.setValue("latitude", null);
    form.setValue("longitude", null);
    form.setValue("locationId", null);
    form.setValue("locationName", null);
  };

  const handleCustomMapSelect = (mapIdStr: string) => {
    const mapId = parseInt(mapIdStr);
    setSelectedCustomMapId(mapId);
    form.setValue("customMapId", mapId);
    form.setValue("customMapX", null);
    form.setValue("customMapY", null);
  };

  const handleCustomPinSelect = (x: number, y: number) => {
    form.setValue("customMapX", x);
    form.setValue("customMapY", y);
  };

  const showDate = isFieldVisible(formFields, "incidentDate", fieldsLoaded);
  const showTime = isFieldVisible(formFields, "incidentTime", fieldsLoaded);
  const showCategory = isFieldVisible(formFields, "categoryId", fieldsLoaded);
  const showLocation = isFieldVisible(formFields, "location", fieldsLoaded);
  const showDescription = isFieldVisible(formFields, "description", fieldsLoaded);
  const showDescriptionField = showDescription && Boolean(incident?.description?.trim());

  const hasCustomMaps = customMaps.length > 0;
  const activeCustomMap = customMaps.find((m) => m.id === selectedCustomMapId) ?? null;
  const watchedCustomMapX = form.watch("customMapX");
  const watchedCustomMapY = form.watch("customMapY");

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl p-0 flex flex-col" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
        <div className="overflow-y-auto flex-1 p-6" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold flex items-center gap-2 flex-wrap" data-testid="text-dialog-title">
            {incident ? "Edit Incident" : "Report New Incident"}
            {incident?.liveStartedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" data-testid="badge-live-incident">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                Live Incident
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {(showDate || showTime) && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {showDate && (
                  <FormFieldComponent
                    control={form.control}
                    name="incidentDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5">
                          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          Incident Date <span className="text-red-500 ml-0.5">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input type="date" {...field} data-testid="input-incident-date" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {showTime && (
                  <FormFieldComponent
                    control={form.control}
                    name="incidentTime"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                          Incident Time <span className="text-red-500 ml-0.5">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input type="time" {...field} data-testid="input-incident-time" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>
            )}

            {showCategory && (
              <>
                <FormFieldComponent
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => {
                    const hasOtherCategory = categories.some((c) => c.isOther);
                    return (
                      <FormItem>
                        <FormLabel>Incident Type <span className="text-red-500 ml-0.5">*</span></FormLabel>
                        <Select
                          onValueChange={(val) => {
                            const numVal = parseInt(val);
                            field.onChange(numVal);
                            const isOtherSelected = numVal === -1 || categories.find((c) => c.id === numVal)?.isOther;
                            if (!isOtherSelected) {
                              form.setValue("otherCategoryNote", null);
                            }
                          }}
                          value={field.value?.toString() || ""}
                        >
                          <FormControl>
                            <SelectTrigger data-testid="select-category">
                              <SelectValue placeholder="Select incident type" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {(() => {
                              const eligible = categories.filter(
                                (cat) => cat.name !== "Live Incident" && !cat.isOther
                              );
                              const byName = (a: typeof eligible[0], b: typeof eligible[0]) =>
                                a.name.localeCompare(b.name);
                              const high   = eligible.filter((c) => c.severity === "red").sort(byName);
                              const medium = eligible.filter((c) => c.severity === "orange").sort(byName);
                              const low    = eligible.filter((c) => c.severity === "yellow").sort(byName);
                              const general = eligible.filter(
                                (c) => c.severity !== "red" && c.severity !== "orange" && c.severity !== "yellow"
                              ).sort(byName);
                              const otherCats = categories.filter(
                                (cat) => cat.name !== "Live Incident" && cat.isOther
                              ).sort(byName);

                              const renderItem = (cat: typeof eligible[0]) => (
                                <SelectItem key={cat.id} value={cat.id.toString()}>
                                  <span className="flex items-center gap-2">
                                    <span
                                      className="inline-block w-2.5 h-2.5 rounded-full"
                                      style={{ backgroundColor: cat.color || "#3B82F6" }}
                                    />
                                    {cat.name}
                                  </span>
                                </SelectItem>
                              );

                              return (
                                <>
                                  {high.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">High</SelectLabel>
                                      {high.map(renderItem)}
                                    </SelectGroup>
                                  )}
                                  {medium.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Medium</SelectLabel>
                                      {medium.map(renderItem)}
                                    </SelectGroup>
                                  )}
                                  {low.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Low</SelectLabel>
                                      {low.map(renderItem)}
                                    </SelectGroup>
                                  )}
                                  {general.length > 0 && (
                                    <SelectGroup>
                                      <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">General</SelectLabel>
                                      {general.map(renderItem)}
                                    </SelectGroup>
                                  )}
                                  {(otherCats.length > 0 || !hasOtherCategory) && (
                                    <SelectGroup>
                                      <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Other</SelectLabel>
                                      {otherCats.map(renderItem)}
                                      {!hasOtherCategory && (
                                        <SelectItem value="-1">
                                          <span className="flex items-center gap-2">
                                            <span
                                              className="inline-block w-2.5 h-2.5 rounded-full"
                                              style={{ backgroundColor: "#6B7280" }}
                                            />
                                            Other (specify)
                                          </span>
                                        </SelectItem>
                                      )}
                                    </SelectGroup>
                                  )}
                                </>
                              );
                            })()}
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    );
                  }}
                />
                {(() => {
                  const selectedCategoryId = form.watch("categoryId");
                  const selectedCategory = categories.find((c) => c.id === selectedCategoryId);
                  const isOtherSelected = selectedCategoryId === -1 || selectedCategory?.isOther;
                  return isOtherSelected ? (
                    <FormFieldComponent
                      control={form.control}
                      name="otherCategoryNote"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Specify occurrence type <span className="text-red-500">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              placeholder="Describe the type of occurrence..."
                              {...field}
                              value={field.value || ""}
                              data-testid="input-other-category-note"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null;
                })()}
              </>
            )}

            {showLocation && (
              <div className="space-y-3">
                <FormLabel className="flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
                  Location <span className="text-red-500 ml-0.5">*</span>
                </FormLabel>

                {incident?.customMapId == null &&
                  (incident?.customMapX != null || incident?.customMapY != null) && (
                    <div
                      className="flex items-center gap-2 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400"
                      data-testid="notice-map-removed"
                    >
                      <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                      <span>
                        The site map this incident was pinned to has been removed. You can reassign a
                        new location below.
                      </span>
                    </div>
                  )}

                {hasCustomMaps && (
                  <div className="flex gap-2" data-testid="location-mode-toggle">
                    <Button
                      type="button"
                      size="sm"
                      variant={locationMode === "geographic" ? "default" : "outline"}
                      onClick={switchToGeographic}
                      data-testid="button-mode-geographic"
                      className="gap-1.5"
                    >
                      <Globe className="h-3.5 w-3.5" />
                      Geographic Map
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={locationMode === "customMap" ? "default" : "outline"}
                      onClick={switchToCustomMap}
                      data-testid="button-mode-custom-map"
                      className="gap-1.5"
                    >
                      <Map className="h-3.5 w-3.5" />
                      Custom Map
                    </Button>
                  </div>
                )}

                {locationMode === "geographic" && (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={openMapPicker}
                      data-testid="button-toggle-map"
                      className="gap-1.5 bg-red-700/90 hover:bg-red-800 text-white border-0"
                    >
                      <LocateFixed className="h-3.5 w-3.5" />
                      {form.watch("latitude") && form.watch("longitude") ? "Change Location" : "Pick on Map"}
                    </Button>

                    <p className="text-xs text-muted-foreground">
                      Tap the map to place the pin, or choose a predefined site below.
                    </p>

                    <FormFieldComponent
                      control={form.control}
                      name="locationId"
                      render={({ field }) => (
                        <FormItem>
                          <Select
                            onValueChange={(val) => handleLocationSelect(parseInt(val))}
                            value={field.value?.toString() || ""}
                          >
                            <FormControl>
                              <SelectTrigger data-testid="select-location">
                                <SelectValue placeholder="Select predefined location" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {allowedLocations.map((loc) => (
                                <SelectItem key={loc.id} value={loc.id.toString()}>
                                  {loc.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {form.watch("latitude") && form.watch("longitude") && (
                      <p className="text-xs text-muted-foreground" data-testid="text-coordinates">
                        Coordinates: {form.watch("latitude")?.toFixed(5)}, {form.watch("longitude")?.toFixed(5)}
                      </p>
                    )}
                    {pendingAddress && (
                      <p className="text-xs text-muted-foreground" data-testid="text-picked-address">
                        {pendingAddress}
                      </p>
                    )}
                  </>
                )}

                {locationMode === "customMap" && (
                  <div className="space-y-3">
                    {incident?.customMapId != null && activeCustomMap && (
                      <div className="space-y-2">
                        <div
                          className="flex items-center gap-2 px-3 py-2 rounded-md bg-muted text-sm"
                          data-testid="text-incident-map-name"
                        >
                          <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                          <span className="text-muted-foreground">Map:</span>
                          <span className="font-medium">{activeCustomMap.name}</span>
                        </div>
                        {(() => {
                          const pinX = watchedCustomMapX;
                          const pinY = watchedCustomMapY;
                          const imgW = activeCustomMap.imageWidth;
                          const imgH = activeCustomMap.imageHeight;
                          const thumbW = 120;
                          const thumbH = 80;
                          let dotLeft: number | null = null;
                          let dotTop: number | null = null;
                          if (pinX != null && pinY != null && imgW && imgH) {
                            const scale = Math.max(thumbW / imgW, thumbH / imgH);
                            const renderedW = imgW * scale;
                            const renderedH = imgH * scale;
                            const offsetX = (renderedW - thumbW) / 2;
                            const offsetY = (renderedH - thumbH) / 2;
                            dotLeft = pinX * scale - offsetX;
                            dotTop = pinY * scale - offsetY;
                          }
                          return (
                            <div
                              className="relative rounded overflow-hidden border border-border bg-muted"
                              style={{ width: thumbW, height: thumbH }}
                              data-testid="img-custom-map-thumbnail"
                            >
                              <img
                                src={activeCustomMap.imageUrl}
                                alt={activeCustomMap.name}
                                className="w-full h-full object-cover"
                              />
                              {dotLeft != null && dotTop != null && (
                                <div
                                  className="absolute w-3 h-3 rounded-full bg-red-500 border-2 border-white shadow pointer-events-none"
                                  style={{
                                    left: dotLeft,
                                    top: dotTop,
                                    transform: "translate(-50%, -50%)",
                                  }}
                                  data-testid="img-custom-map-pin-dot"
                                />
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    )}
                    <Select
                      onValueChange={handleCustomMapSelect}
                      value={selectedCustomMapId?.toString() || ""}
                    >
                      <SelectTrigger data-testid="select-custom-map">
                        <SelectValue placeholder="Select a map" />
                      </SelectTrigger>
                      <SelectContent>
                        {customMaps.map((m) => (
                          <SelectItem key={m.id} value={m.id.toString()}>
                            {m.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {activeCustomMap && (
                      <>
                        <CustomMapPicker
                          key={activeCustomMap.id}
                          imageUrl={activeCustomMap.imageUrl}
                          imageWidth={activeCustomMap.imageWidth}
                          imageHeight={activeCustomMap.imageHeight}
                          pinX={watchedCustomMapX}
                          pinY={watchedCustomMapY}
                          onPinSelect={handleCustomPinSelect}
                          height="320px"
                        />
                        {watchedCustomMapX != null && watchedCustomMapY != null ? (
                          <p className="text-xs text-muted-foreground" data-testid="text-custom-map-coords">
                            Pin placed at ({Math.round(watchedCustomMapX)}, {Math.round(watchedCustomMapY)}) on{" "}
                            <span className="font-medium">{activeCustomMap.name}</span>
                          </p>
                        ) : (
                          <p className="text-xs text-amber-600 dark:text-amber-400" data-testid="text-custom-map-no-pin">
                            Click the map above to place the incident pin.
                          </p>
                        )}
                      </>
                    )}

                    {!activeCustomMap && (
                      <p className="text-xs text-muted-foreground">
                        Select a map above to place a pin.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            <IncidentInvolvementSection
              customFields={(form.watch("customFields") as Record<string, string | number | null>) || {}}
              onChange={(next) => form.setValue("customFields", next)}
              personInvolved={personInvolved}
              vehicleInvolved={vehicleInvolved}
              onPersonInvolvedChange={setPersonInvolved}
              onVehicleInvolvedChange={setVehicleInvolved}
            />

            {showDescriptionField && (
              <FormFieldComponent
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Description</FormLabel>
                    <FormControl>
                      <Textarea
                        placeholder="Describe the incident in detail..."
                        className="min-h-[100px] resize-none"
                        {...field}
                        value={field.value || ""}
                        maxLength={500}
                        data-testid="input-description"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            {orgCustomFields.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Additional Fields</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {orgCustomFields.map((cf) => {
                    const currentCustomFields = form.watch("customFields") || {};
                    const value = currentCustomFields[cf.fieldKey] ?? "";

                    if (cf.fieldType === "select") {
                      const opts = (cf.options || "").split(",").map((o) => o.trim()).filter(Boolean);
                      return (
                        <FormFieldComponent
                          key={cf.id}
                          control={form.control}
                          name={`customFields.${cf.fieldKey}` as any}
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{cf.label}</FormLabel>
                              <Select
                                value={(field.value as string) || ""}
                                onValueChange={(val) => field.onChange(val)}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid={`select-custom-field-${cf.fieldKey}`}>
                                    <SelectValue placeholder={`Select ${cf.label.toLowerCase()}`} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {opts.map((opt) => (
                                    <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      );
                    }

                    return (
                      <FormFieldComponent
                        key={cf.id}
                        control={form.control}
                        name={`customFields.${cf.fieldKey}` as any}
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{cf.label}</FormLabel>
                            <FormControl>
                              <Textarea
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value)}
                                className="min-h-[80px]"
                                data-testid={`input-custom-field-${cf.fieldKey}`}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-4 border border-border rounded-lg p-4 bg-muted/30">
              <div className="flex items-center gap-2">
                <Paperclip className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium">Evidence</h3>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.txt"
                className="hidden"
                data-testid="input-file-upload"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    setAttachmentError(null);
                    handleAttachmentUpload(e.target.files);
                  }
                  e.target.value = "";
                }}
              />
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                data-testid="input-camera-upload"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    setAttachmentError(null);
                    handleAttachmentUpload(e.target.files, "camera");
                  }
                  e.target.value = "";
                }}
              />

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setAttachmentError(null); fileInputRef.current?.click(); }}
                  disabled={uploadingAttachment || isRecording}
                  data-testid="button-upload-file"
                  className="gap-1.5"
                >
                  {uploadingAttachment && uploadSource === "file" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  Upload File
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleTakePhoto}
                  disabled={uploadingAttachment || isRecording}
                  data-testid="button-take-photo"
                  className="gap-1.5"
                >
                  {uploadingAttachment && uploadSource === "camera" ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Camera className="h-3.5 w-3.5" />
                  )}
                  Take Photo
                </Button>

                {!isRecording ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => { setAttachmentError(null); startRecording(); }}
                    disabled={uploadingAttachment}
                    data-testid="button-start-recording"
                    className="gap-1.5"
                  >
                    {uploadingAttachment && uploadSource === "voice" ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Mic className="h-3.5 w-3.5" />
                    )}
                    {uploadingAttachment && uploadSource === "voice" ? "Saving…" : "Record Voice"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={stopRecording}
                    data-testid="button-stop-recording"
                    className="gap-1.5 animate-pulse"
                  >
                    <Square className="h-3.5 w-3.5" />
                    Stop ({Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")})
                  </Button>
                )}
              </div>

              {attachmentError && (
                <p className="text-xs text-destructive" data-testid="text-attachment-error">
                  {attachmentError}
                </p>
              )}

              {existingAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">Saved Evidence</p>
                  <div className="flex flex-wrap gap-2">
                    {existingAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="relative border border-border rounded-md overflow-hidden w-28"
                        data-testid={`card-existing-attachment-${att.id}`}
                      >
                        <AttachmentPreview url={att.url} alt={att.filename} mimeType={att.mimeType} filename={att.filename} />
                        <div className="p-1 text-xs text-center truncate bg-background border-t border-border">
                          {att.filename}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteExistingAttachment(att.id)}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80"
                          data-testid={`button-delete-existing-attachment-${att.id}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pendingAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground font-medium">
                    Pending Evidence ({pendingAttachments.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {pendingAttachments.map((att, i) => (
                      <div
                        key={i}
                        className="relative border border-border rounded-md overflow-hidden w-28"
                        data-testid={`card-pending-attachment-${i}`}
                      >
                        <AttachmentPreview url={att.url} alt={att.filename} mimeType={att.mimeType} filename={att.filename} />
                        <div className="p-1 text-xs text-center truncate bg-background border-t border-border">
                          {att.filename}
                        </div>
                        <button
                          type="button"
                          onClick={() => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80"
                          data-testid={`button-remove-pending-attachment-${i}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {incident?.liveStartedAt && (
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3" data-testid="section-live-timeline">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  Live Incident Timeline
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Live Started</p>
                    <p className="text-sm mt-0.5" data-testid="text-live-started">{new Date(incident.liveStartedAt).toLocaleString()}</p>
                  </div>
                  {incident.responderArrivedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Responder Arrived</p>
                      <p className="text-sm mt-0.5" data-testid="text-responder-arrived">{new Date(incident.responderArrivedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {incident.liveStartLat != null && incident.liveStartLng != null && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Origin Coordinates</p>
                      <a
                        href={`https://www.google.com/maps?q=${incident.liveStartLat},${incident.liveStartLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm mt-0.5 text-primary hover:underline flex items-center gap-1"
                        data-testid="link-live-origin"
                      >
                        {Number(incident.liveStartLat).toFixed(5)}, {Number(incident.liveStartLng).toFixed(5)} ↗
                      </a>
                    </div>
                  )}
                  {(incident as any).destinationName && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Destination</p>
                      {(incident as any).destinationLat != null && (incident as any).destinationLng != null ? (
                        <a
                          href={`https://www.google.com/maps?q=${(incident as any).destinationLat},${(incident as any).destinationLng}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm mt-0.5 text-primary hover:underline flex items-center gap-1"
                          data-testid="link-live-destination"
                        >
                          {(incident as any).destinationName} ↗
                        </a>
                      ) : (
                        <p className="text-sm mt-0.5" data-testid="text-live-destination">{(incident as any).destinationName}</p>
                      )}
                    </div>
                  )}
                  {incident.responderArrivedAt && (() => {
                    const mins = (new Date(incident.responderArrivedAt).getTime() - new Date(incident.liveStartedAt).getTime()) / 60000;
                    const label = mins < 1 ? "< 1 min" : `${Math.round(mins)} min`;
                    return (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Response Time</p>
                        <p className="text-sm mt-0.5 font-medium" data-testid="text-response-time">{label}</p>
                      </div>
                    );
                  })()}
                  {incident.liveEndedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Closed</p>
                      <p className="text-sm mt-0.5" data-testid="text-live-ended">{new Date(incident.liveEndedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {incident.liveEndedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">End Type</p>
                      <p className="text-sm mt-0.5 font-medium" data-testid="text-live-end-type">
                        {incident.liveClosedManually ? "Manually closed" : "Converted to incident"}
                      </p>
                    </div>
                  )}
                  {(incident as any).closedByName && incident.liveEndedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Closed by</p>
                      <p className="text-sm mt-0.5 font-medium" data-testid="text-live-closed-by">{(incident as any).closedByName}</p>
                    </div>
                  )}
                  {incident.liveEndedAt && (() => {
                    const totalMs = new Date(incident.liveEndedAt).getTime() - new Date(incident.liveStartedAt).getTime();
                    const totalSecs = Math.floor(totalMs / 1000);
                    const hours = Math.floor(totalSecs / 3600);
                    const mins = Math.floor((totalSecs % 3600) / 60);
                    const secs = totalSecs % 60;
                    const parts: string[] = [];
                    if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
                    if (mins > 0) parts.push(`${mins} minute${mins !== 1 ? "s" : ""}`);
                    if (secs > 0 || parts.length === 0) parts.push(`${secs} second${secs !== 1 ? "s" : ""}`);
                    return (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Duration</p>
                        <p className="text-sm mt-0.5 font-medium" data-testid="text-live-duration">{parts.join(" ")}</p>
                      </div>
                    );
                  })()}
                  {incident.liveEndedAt && !incident.liveClosedManually && incident.liveConvertLat != null && incident.liveConvertLng != null && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Location at Submission</p>
                      <a
                        href={`https://www.google.com/maps?q=${incident.liveConvertLat},${incident.liveConvertLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm mt-0.5 text-primary hover:underline flex items-center gap-1"
                        data-testid="link-live-convert-location"
                      >
                        {Number(incident.liveConvertLat).toFixed(5)}, {Number(incident.liveConvertLng).toFixed(5)} ↗
                      </a>
                    </div>
                  )}
                  {incident.liveEndedAt && incident.liveClosedManually && (incident as any).liveEndLat != null && (incident as any).liveEndLng != null && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Closed From</p>
                      <a
                        href={`https://www.google.com/maps?q=${(incident as any).liveEndLat},${(incident as any).liveEndLng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm mt-0.5 text-primary hover:underline flex items-center gap-1"
                        data-testid="link-live-end-location"
                      >
                        {Number((incident as any).liveEndLat).toFixed(5)}, {Number((incident as any).liveEndLng).toFixed(5)} ↗
                      </a>
                    </div>
                  )}
                </div>

                {incidentResponders.length > 0 && (
                  <div className="border-t border-border/40 pt-3 space-y-2" data-testid="section-live-responders">
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                      Responders ({incidentResponders.length})
                    </p>
                    <div className="space-y-2">
                      {incidentResponders.map((r) => {
                        const name = `${r.firstName} ${r.lastName}`.trim();
                        const joinedAt = new Date(r.joinedAt);
                        const leftAt = r.leftAt ? new Date(r.leftAt) : null;
                        const arrivedAt = r.arrivedAt ? new Date(r.arrivedAt) : null;
                        const durationMs = leftAt ? leftAt.getTime() - joinedAt.getTime() : null;
                        const durationMin = durationMs != null ? Math.round(durationMs / 60000) : null;
                        const fmt = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                        return (
                          <div key={r.id} className="rounded border border-border bg-background px-3 py-2 space-y-1" data-testid={`responder-row-${r.id}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-medium">{name}</span>
                              {leftAt ? (
                                <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Left</span>
                              ) : (
                                <span className="text-[10px] text-green-600 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">Active</span>
                              )}
                            </div>
                            <div className="grid grid-cols-3 gap-x-3 gap-y-0.5">
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
                              {r.lastLat != null && r.lastLng != null && (
                                <div className="col-span-3">
                                  <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Last GPS</p>
                                  <a href={`https://www.google.com/maps?q=${r.lastLat},${r.lastLng}`} target="_blank" rel="noopener noreferrer" className="text-xs text-primary hover:underline" data-testid={`link-responder-gps-${r.id}`}>
                                    {Number(r.lastLat).toFixed(5)}, {Number(r.lastLng).toFixed(5)} ↗
                                  </a>
                                </div>
                              )}
                            </div>
                            {r.arrivalNote && (
                              <p className="text-xs text-muted-foreground italic border-t border-border/30 pt-1">"{r.arrivalNote}"</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} data-testid="button-cancel-incident">
                Cancel
              </Button>
              <Button type="submit" data-testid="button-submit-incident" disabled={mutation.isPending}>
                {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {incident ? "Update Incident" : "Report Incident"}
              </Button>
            </div>
          </form>
        </Form>
        </div>
      </DialogContent>
    </Dialog>

      {mapModalOpen && (
        <Dialog open={mapModalOpen} onOpenChange={cancelMapModal}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Pick Location on Map</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="relative">
                <div
                  ref={mapRef}
                  className="h-[420px] w-full rounded-md border"
                  data-testid="map-pick-location"
                />
                <button
                  type="button"
                  onClick={handleUseMyLocation}
                  disabled={gpsLoading}
                  title="Use my location"
                  data-testid="button-use-my-location"
                  className="absolute top-2 right-2 z-10 flex items-center justify-center w-9 h-9 rounded bg-white shadow-md border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LocateFixed className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mapLoading ? "Finding the nearest address..." : pendingAddress || (locationError ? "" : "Tap anywhere on the map to pick the incident location.")}
              </p>
              {locationError && (
                <p className="text-xs text-destructive" data-testid="text-location-error">{locationError}</p>
              )}
              {pendingLatLng && (
                <p className="text-xs text-muted-foreground" data-testid="text-picked-coordinates">
                  Selected: {pendingLatLng.lat.toFixed(5)}, {pendingLatLng.lng.toFixed(5)}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={cancelMapModal} data-testid="button-map-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (pendingLatLng) {
                      form.setValue("latitude", pendingLatLng.lat);
                      form.setValue("longitude", pendingLatLng.lng);
                      form.setValue("locationId", null);
                      if (!form.getValues("locationName")) {
                        form.setValue("locationName", `Dropped pin (${pendingLatLng.lat.toFixed(5)}, ${pendingLatLng.lng.toFixed(5)})`);
                      }
                    }
                    setMapModalOpen(false);
                  }}
                  disabled={!pendingLatLng}
                  data-testid="button-map-confirm"
                >
                  Use This Location
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

export function AttachmentsDialog({ open, onOpenChange, incidentId }: AttachmentsDialogProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetch(`/api/incidents/${incidentId}/attachments`, { credentials: "include" })
        .then((r) => r.json())
        .then((data) => setAttachments(data))
        .catch(() => setAttachments([]))
        .finally(() => setLoading(false));
    }
  }, [open, incidentId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-attachments-title">Attachments</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="space-y-2">Loading...</div>
        ) : attachments.length === 0 ? (
          <div className="text-sm text-muted-foreground">No attachments yet.</div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {attachments.map((att) => (
              <AttachmentPreview key={att.id} url={att.url} alt={att.filename} mimeType={att.mimeType} filename={att.filename} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
