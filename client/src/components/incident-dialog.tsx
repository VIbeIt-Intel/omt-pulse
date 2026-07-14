import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Category, Location, Incident, FormField, CustomMap, AttachmentWithUploader } from "@shared/schema";
import { usesLocationAssignmentScope } from "@shared/user-roles";
import { getEligibleManualTypes, getOtherManualTypes, getSeverityGroupKey, SEVERITY_GROUP_ORDER, SEVERITY_GROUP_LABELS } from "@/lib/incident-categories";
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
import { IncidentSapsSection, isSapsFormField, SapsCaseTile, hasSapsCaseData, clearSapsCustomFields } from "./incident-saps-section";
import { IncidentReportDescriptionField } from "./incident-report-description-field";
import { IncidentReportSuccess } from "./incident-report-success";
import { IncidentReportMoreDetailsSection } from "./incident-report-more-details-section";
import { IncidentReportSceneEvidenceSection } from "./incident-report-scene-evidence-section";
import { normalizeAudioMimeType, resolveAttachmentKind } from "@/lib/attachment-kind";
import { CalendarIcon, Clock, MapPin, Upload, X, Loader2, Camera, Mic, Square, Globe, Map, LocateFixed } from "lucide-react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";
import { quickPanicLocationCheck, acquirePanicLocation, hasPanicCoordinates, panicLocationWarning, type PanicLocationResult } from "@/lib/panic-location";
import { preloadLocationSettingsModule } from "@/lib/open-location-settings";
import { OpenLocationSettingsButton } from "@/components/open-location-settings-button";
import { AttachmentPreview, attachmentUploaderLabel } from "@/components/attachment-preview";
import { IncidentEvidenceSection } from "@/components/incident-evidence-section";
import { GeoLocationSheet, type GeoMapView } from "@/components/incident-location-sheet";
import { CoordinateLink } from "@/components/coordinate-link";
import { cn } from "@/lib/utils";
import {
  createAudioMediaRecorder,
  openMicStream,
  recorderMimeType,
  recordingErrorMessage,
} from "@/lib/voice-recorder";
import {
  cancelNativeRecording,
  getNativeRecordingMode,
  startNativeRecording,
  stopNativeRecording,
} from "@/lib/native-audio-recorder";
import { nativeMicDeniedHint, nativeVoiceApkUpdateHint } from "@/lib/native-mic-hint";

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
  canAdd?: boolean;
  canDelete?: boolean;
}

function isFieldVisible(fields: FormField[], key: string, _fieldsLoaded: boolean): boolean {
  const field = fields.find((f) => f.fieldKey === key);
  if (field) return field.isVisible;
  // Field not configured for this command — show by default.
  // This handles new commands that have no form-field config yet, so reporters
  // still see the full form rather than a blank Evidence-only dialog.
  return true;
}

interface PendingAttachment {
  url: string;
  filename: string;
  mimeType: string;
  byteSize?: number;
}

type LocationMode = "geographic" | "customMap";

export function IncidentDialog({ open, onOpenChange, incident }: IncidentDialogProps) {
  const { toast } = useToast();
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [pendingLatLng, setPendingLatLng] = useState<{ lat: number; lng: number } | null>(null);
  const [pendingAddress, setPendingAddress] = useState<string | null>(null);
  const [mapLoading, setMapLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [locationProbe, setLocationProbe] = useState<PanicLocationResult | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<AttachmentWithUploader[]>([]);
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
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const useNativeRecorder = getNativeRecordingMode() === "plugin";
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
  const isAdmin = currentUser?.role === "administrator";

  const { data: locationAssignments } = useQuery<{ locationIds: number[] }>({
    queryKey: ["/api/users", currentUser?.id, "location-assignments"],
    queryFn: async () => {
      const res = await fetch(`/api/users/${currentUser!.id}/location-assignments`, { credentials: "include" });
      return res.json();
    },
    enabled: !!currentUser?.id && !!currentUser?.role && usesLocationAssignmentScope(currentUser.role),
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

  const [personInvolved, setPersonInvolved] = useState(false);
  const [vehicleInvolved, setVehicleInvolved] = useState(false);
  const [geoMapView, setGeoMapView] = useState<GeoMapView | null>(null);
  /** After a fast new report — success screen before optional enrich. */
  const [reportSuccess, setReportSuccess] = useState<Incident | null>(null);
  /** Re-open form to add Person / Vehicle / SAPS after initial submit. */
  const [enrichIncident, setEnrichIncident] = useState<Incident | null>(null);
  const [sapsSectionOpen, setSapsSectionOpen] = useState(false);

  const activeIncident = incident ?? enrichIncident;
  const isSuccessView = reportSuccess != null;
  const isNewQuickReport = !incident && !enrichIncident && !isSuccessView;

  type IncidentResponder = { id: number; userId: string; firstName: string; lastName: string; joinedAt: string; leftAt: string | null; arrivedAt: string | null; arrivalNote: string | null; lastLat: number | null; lastLng: number | null };
  const { data: incidentResponders = [] } = useQuery<IncidentResponder[]>({
    queryKey: ["/api/incidents", activeIncident?.id, "responders"],
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${activeIncident!.id}/responders`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!activeIncident?.id && !!activeIncident?.liveStartedAt,
    staleTime: 0,
  });

  const orgCustomFields = formFields.filter(
    (f) => !f.isSystem && f.isVisible && !INVOLVEMENT_FIELD_KEYS.has(f.fieldKey),
  );
  const sapsCustomFields = orgCustomFields.filter(isSapsFormField);
  const otherOrgCustomFields = orgCustomFields.filter((f) => !isSapsFormField(f));

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
    if (!open) {
      if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
      if (isRecording) {
        if (mediaRecorderRef.current?.state !== "inactive") {
          mediaRecorderRef.current?.stop();
        }
        if (useNativeRecorder) void cancelNativeRecording();
        recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        setIsRecording(false);
        setRecordingSeconds(0);
      }
      setAttachmentError(null);
    }
  }, [open, isRecording, useNativeRecorder]);

  useEffect(() => {
    if (!open) {
      setReportSuccess(null);
      setEnrichIncident(null);
      setSapsSectionOpen(false);
    }
  }, [open]);

  useEffect(() => {
    setPendingAttachments([]);
    if (activeIncident) {
      const hasCustomMap = activeIncident.customMapId != null;
      const mode: LocationMode = hasCustomMap ? "customMap" : "geographic";
      setLocationMode(mode);
      setSelectedCustomMapId(activeIncident.customMapId ?? null);
      form.reset({
        incidentDate: activeIncident.incidentDate,
        incidentTime: activeIncident.incidentTime,
        locationId: activeIncident.locationId,
        locationName: activeIncident.locationName,
        latitude: activeIncident.latitude,
        longitude: activeIncident.longitude,
        customMapId: activeIncident.customMapId ?? null,
        customMapX: activeIncident.customMapX ?? null,
        customMapY: activeIncident.customMapY ?? null,
        categoryId: activeIncident.categoryId,
        otherCategoryNote: activeIncident.otherCategoryNote,
        description: activeIncident.description,
        customFields: (activeIncident.customFields as Record<string, string | number | null>) || {},
      });
      const inv = readInvolvement(activeIncident.customFields as Record<string, string | number | null>);
      setPersonInvolved(inv.personInvolved);
      setVehicleInvolved(inv.vehicleInvolved);
      setSapsSectionOpen(hasSapsCaseData(sapsCustomFields, activeIncident.customFields as Record<string, string | number | null>));
      fetch(`/api/incidents/${activeIncident.id}/attachments`, { credentials: "include" })
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
      setSapsSectionOpen(false);
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
  }, [activeIncident, open]);

  const applyGpsPosition = (lat: number, lng: number) => {
    // Capture the GPS fix UNCONDITIONALLY. The raw lat/lng is what the incident
    // record, analytics map and live tracking actually need, and it must persist
    // even if the embedded picker map hasn't finished loading — on the native APK
    // WebView the Google Maps JS-API map can be slow or unavailable, and the old
    // `if (!map) return` guard silently discarded the position, saving incidents
    // with no location. The visual map is now treated as optional confirmation.
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
    // Reverse-geocode for a friendly place name. Lazy-init geocoder so inline
    // "Use current location" works without opening the map modal first.
    void (async () => {
      try {
        await loadGoogleMaps();
        if (!geocoderRef.current) {
          geocoderRef.current = new google.maps.Geocoder();
        }
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
      } catch {
        setMapLoading(false);
      }
    })();
  };

  const locationReady = locationProbe != null && hasPanicCoordinates(locationProbe);
  const watchedLat = form.watch("latitude");
  const watchedLng = form.watch("longitude");
  const confirmCoords =
    pendingLatLng ??
    (locationReady ? { lat: locationProbe!.lat!, lng: locationProbe!.lng! } : null) ??
    (watchedLat != null && watchedLng != null ? { lat: watchedLat, lng: watchedLng } : null);

  async function refreshLocationProbe(applyIfReady = false) {
    const loc = await quickPanicLocationCheck();
    setLocationProbe(loc);
    if (applyIfReady && hasPanicCoordinates(loc) && mapInstanceRef.current) {
      applyGpsPosition(loc.lat, loc.lng);
    }
    return loc;
  }

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setLocationProbe({ issue: "unsupported" });
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        const loc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setLocationProbe(loc);
        applyGpsPosition(loc.lat, loc.lng);
      },
      (err) => {
        setGpsLoading(false);
        const issue = err.code === 1 ? "denied" : err.code === 3 ? "timeout" : "unavailable";
        setLocationProbe({ issue });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  };

  async function handleUseCurrentLocation() {
    if (!navigator.geolocation) {
      toast({
        title: "Location unavailable",
        description: "This device does not support GPS.",
        variant: "destructive",
      });
      return;
    }
    setGpsLoading(true);
    try {
      const loc = await acquirePanicLocation();
      if (hasPanicCoordinates(loc)) {
        applyGpsPosition(loc.lat, loc.lng);
        toast({
          title: "Location set",
          description: "This incident will use your current GPS position.",
        });
      } else {
        toast({
          title: "Could not get location",
          description: panicLocationWarning(loc.issue),
          variant: "destructive",
        });
      }
    } finally {
      setGpsLoading(false);
    }
  }

  useEffect(() => {
    if (!mapModalOpen) {
      setLocationProbe(null);
      return;
    }
    preloadLocationSettingsModule();
    let cancelled = false;
    void quickPanicLocationCheck().then((loc) => {
      if (cancelled) return;
      setLocationProbe(loc);
      if (hasPanicCoordinates(loc)) {
        applyGpsPosition(loc.lat, loc.lng);
      }
    });
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void refreshLocationProbe(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [mapModalOpen]);

  useEffect(() => {
    if (!mapModalOpen) return;
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
        setPendingLatLng(pos);
        map.setCenter(pos);
        map.setZoom(13);
        pinRef.current = new google.maps.Marker({ position: pos, map, title: "Selected location" });
      } else {
        void quickPanicLocationCheck().then((loc) => {
          setLocationProbe(loc);
          if (hasPanicCoordinates(loc) && mapInstanceRef.current) {
            applyGpsPosition(loc.lat, loc.lng);
          }
        });
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
      if (activeIncident) {
        // If converting a live incident, try to capture the reporter's current GPS position
        let convertCoords: { liveConvertLat?: number; liveConvertLng?: number } = {};
        if (activeIncident.isLive) {
          try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
              navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000, maximumAge: 10000 });
            });
            convertCoords = { liveConvertLat: pos.coords.latitude, liveConvertLng: pos.coords.longitude };
          } catch {
            // geolocation unavailable or denied — submit without it
          }
        }
        const resp = await apiRequest("PATCH", `/api/incidents/${activeIncident.id}`, { ...resolvedData, ...convertCoords });
        savedIncident = await resp.json();
      } else {
        const resp = await apiRequest("POST", "/api/incidents", resolvedData);
        savedIncident = await resp.json();
      }
      if (pendingAttachments.length > 0) {
        for (const att of pendingAttachments) {
          await apiRequest("POST", `/api/incidents/${savedIncident.id}/attachments`, { ...att, evidencePhase: "scene" });
        }
      }
      return savedIncident;
    },
    onSuccess: (savedIncident) => {
      queryClient.invalidateQueries({ queryKey: ["/api/incidents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      setPendingAttachments([]);
      if (activeIncident) {
        toast({
          title: incident ? "Incident updated" : "Details saved",
          description: incident
            ? "The incident has been updated successfully."
            : "Extra details have been added to your report.",
        });
        setEnrichIncident(null);
        onOpenChange(false);
        return;
      }
      setReportSuccess(savedIncident);
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
    if (isFieldVisible(formFields, "categoryId", fieldsLoaded) && data.categoryId == null) {
      form.setError("categoryId", { message: "Please select an incident type" });
      return;
    }
    const selectedCategory = categories.find((c) => c.id === data.categoryId);
    const isOtherSelected = data.categoryId === -1 || selectedCategory?.isOther;
    if (isOtherSelected && !data.otherCategoryNote?.trim()) {
      form.setError("otherCategoryNote", { message: "Please specify the occurrence type" });
      return;
    }
    if (isFieldVisible(formFields, "location", fieldsLoaded)) {
      if (locationMode === "customMap") {
        if (data.customMapId == null || data.customMapX == null || data.customMapY == null) {
          form.setError("customMapId", { message: "Please select a map and place a pin" });
          return;
        }
      } else {
        const hasLocation =
          data.locationId != null
          || (data.latitude != null && data.longitude != null)
          || Boolean(data.locationName?.trim());
        if (!hasLocation) {
          form.setError("locationId", { message: "Please set a location using GPS, the map, or a predefined site" });
          return;
        }
      }
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
        let uploadMime = uploadFile.type || "application/octet-stream";
        if (source === "voice" || uploadFile.name.includes("voice-note")) {
          uploadMime = normalizeAudioMimeType(uploadMime, uploadFile.name);
        }
        const urlResp = await fetch("/api/uploads", {
          method: "POST",
          headers: { "Content-Type": uploadMime },
          body: uploadFile.type.startsWith("image/") ? uploadFile : new File([uploadFile], uploadFile.name, { type: uploadMime }),
          credentials: "include",
        });
        if (!urlResp.ok) {
          const errData = await urlResp.json().catch(() => ({}));
          throw new Error(errData.message || "Failed to upload file");
        }
        const { objectUrl, byteSize } = await urlResp.json();
        setPendingAttachments(prev => [...prev, {
          url: objectUrl,
          filename: uploadFile.name,
          mimeType: uploadMime,
          byteSize: typeof byteSize === "number" ? byteSize : uploadFile.size,
        }]);
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

  function voiceErrorDescription(description: string): string {
    if (description === "mic-denied") return nativeMicDeniedHint();
    if (description === "needs-apk-update") return nativeVoiceApkUpdateHint();
    return description;
  }

  function voiceBlobToFile(blob: Blob, mimeType: string): File {
    const ext = mimeType.includes("mp4") ? "m4a" : mimeType.includes("ogg") ? "ogg" : "webm";
    const name = `voice-note-${Date.now()}.${ext}`;
    const type = normalizeAudioMimeType(mimeType || blob.type, name);
    return new File([blob], name, { type });
  }

  const startRecording = async () => {
    if (isRecording || uploadingAttachment) return;
    setAttachmentError(null);

    if (useNativeRecorder) {
      try {
        await startNativeRecording();
        setRecordingSeconds(0);
        setIsRecording(true);
        recordingTimerRef.current = setInterval(() => {
          setRecordingSeconds((s) => s + 1);
        }, 1000);
      } catch (err: unknown) {
        setIsRecording(false);
        setRecordingSeconds(0);
        const { title, description } = recordingErrorMessage(err);
        toast({
          title,
          description: voiceErrorDescription(description),
          variant: "destructive",
        });
      }
      return;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await openMicStream();
      recordingStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = createAudioMediaRecorder(stream);
      const mimeType = recorderMimeType(recorder);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stream!.getTracks().forEach((t) => t.stop());
        recordingStreamRef.current = null;
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          void handleAttachmentUpload([voiceBlobToFile(blob, mimeType)], "voice");
        }
        mediaRecorderRef.current = null;
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
      recordingStreamRef.current = null;
      const { title, description } = recordingErrorMessage(err);
      if (description === "mic-denied") {
        setAttachmentError(voiceErrorDescription(description));
      } else {
        toast({
          title,
          description: voiceErrorDescription(description),
          variant: "destructive",
        });
      }
    }
  };

  const stopRecording = () => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }

    if (useNativeRecorder && isRecording) {
      setIsRecording(false);
      setRecordingSeconds(0);
      void stopNativeRecording()
        .then(({ blob, mimeType }) => {
          if (blob.size === 0) throw new Error("Recording was empty");
          return handleAttachmentUpload([voiceBlobToFile(blob, mimeType)], "voice");
        })
        .catch((err: unknown) => {
          const { title, description } = recordingErrorMessage(err);
          toast({
            title,
            description: voiceErrorDescription(description),
            variant: "destructive",
          });
        });
      return;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
      recordingStreamRef.current = null;
      setIsRecording(false);
      setRecordingSeconds(0);
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
    const lat = form.getValues("latitude");
    const lng = form.getValues("longitude");
    setMapModalOpen(true);
    setPendingLatLng(lat != null && lng != null ? { lat, lng } : null);
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

  const hasCustomMaps = customMaps.length > 0;
  const activeCustomMap = customMaps.find((m) => m.id === selectedCustomMapId) ?? null;
  const watchedCustomMapX = form.watch("customMapX");
  const watchedCustomMapY = form.watch("customMapY");
  const watchedCustomFields = (form.watch("customFields") as Record<string, string | number | null>) || {};

  const successTypeLabel = reportSuccess?.categoryId
    ? categories.find((c) => c.id === reportSuccess.categoryId)?.name ?? null
    : reportSuccess?.otherCategoryNote?.trim() ?? null;

  function handleDialogOpenChange(next: boolean) {
    if (!next) {
      setReportSuccess(null);
      setEnrichIncident(null);
    }
    onOpenChange(next);
  }

  function handleAddMoreDetails() {
    if (!reportSuccess) return;
    setEnrichIncident(reportSuccess);
    setReportSuccess(null);
  }

  return (
    <>
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-4xl p-0 flex flex-col gap-0 overflow-hidden" style={{ maxHeight: "calc(100dvh - 2rem)" }}>
        <DialogHeader className="shrink-0 px-6 pt-5 pb-4 border-b border-border/50 text-center sm:text-center space-y-0">
          <DialogTitle
            className="text-xl font-semibold tracking-tight text-center flex items-center justify-center gap-2 flex-wrap"
            data-testid="text-dialog-title"
          >
            {incident ? "Edit Incident" : enrichIncident ? "Add more details" : isSuccessView ? "Report sent" : "Report New Incident"}
            {activeIncident?.liveStartedAt && (
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 text-green-600 dark:text-green-400 border border-green-500/25 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" data-testid="badge-live-incident">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                Live Incident
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="overflow-y-auto flex-1 px-6 py-5" style={{ WebkitOverflowScrolling: "touch" } as React.CSSProperties}>
        {isSuccessView && reportSuccess ? (
          <IncidentReportSuccess
            incident={reportSuccess}
            typeLabel={successTypeLabel}
            onAddDetails={handleAddMoreDetails}
            onDone={() => handleDialogOpenChange(false)}
          />
        ) : (
        <Form {...form}>
          <form id="incident-report-form" onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            {(showDate || showTime) && (
              <div className="grid grid-cols-2 gap-3">
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
                              const eligible = getEligibleManualTypes(categories);
                              const byName = (a: typeof eligible[0], b: typeof eligible[0]) =>
                                a.name.localeCompare(b.name);
                              const grouped = SEVERITY_GROUP_ORDER.map((key) => ({
                                key,
                                label: SEVERITY_GROUP_LABELS[key],
                                types: eligible.filter((c) => getSeverityGroupKey(c) === key).sort(byName),
                              })).filter((g) => g.types.length > 0);
                              const otherCats = getOtherManualTypes(categories);

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
                                  {grouped.map((group) => (
                                    <SelectGroup key={group.key}>
                                      <SelectLabel className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{group.label}</SelectLabel>
                                      {group.types.map(renderItem)}
                                    </SelectGroup>
                                  ))}
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
                    <div className="grid grid-cols-2 gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleUseCurrentLocation()}
                        disabled={gpsLoading}
                        data-testid="button-use-current-location"
                        className="gap-1.5 bg-primary hover:bg-primary/90 text-primary-foreground border-0 h-10"
                      >
                        {gpsLoading ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <LocateFixed className="h-3.5 w-3.5" />
                        )}
                        Use current location
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={openMapPicker}
                        disabled={gpsLoading}
                        data-testid="button-toggle-map"
                        className="gap-1.5 bg-red-700/90 hover:bg-red-800 text-white border-0 h-10"
                      >
                        <MapPin className="h-3.5 w-3.5" />
                        {form.watch("latitude") && form.watch("longitude") ? "Change on map" : "Pick on map"}
                      </Button>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      {isNewQuickReport
                        ? "Tap green for GPS, or red to adjust on the map."
                        : "Use current location for a quick GPS fix, pick on the map to adjust, or choose a predefined site below."}
                    </p>

                    {allowedLocations.length > 0 && (
                      isNewQuickReport ? (
                        <details className="group">
                          <summary className="text-xs text-muted-foreground cursor-pointer list-none flex items-center gap-1 hover:text-foreground">
                            <span className="underline-offset-2 group-open:underline">Or choose a predefined site</span>
                          </summary>
                          <div className="pt-2">
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
                          </div>
                        </details>
                      ) : (
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
                      )
                    )}

                    {form.watch("latitude") != null && form.watch("longitude") != null && (
                      <div className="rounded-xl border border-primary/25 bg-primary/5 px-3 py-2.5 space-y-1" data-testid="banner-location-set">
                        <p className="text-xs font-medium text-primary" data-testid="text-coordinates">
                          GPS: {form.watch("latitude")?.toFixed(5)}, {form.watch("longitude")?.toFixed(5)}
                        </p>
                        {(pendingAddress || form.watch("locationName")) && (
                          <p className="text-xs text-muted-foreground" data-testid="text-picked-address">
                            {mapLoading ? "Finding nearest address…" : (pendingAddress ?? form.watch("locationName"))}
                          </p>
                        )}
                      </div>
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

            {showDescription && (
              <FormFieldComponent
                control={form.control}
                name="description"
                render={({ field, fieldState }) => (
                  <IncidentReportDescriptionField
                    value={field.value || ""}
                    onChange={(v) => field.onChange(v)}
                    error={fieldState.error?.message}
                    isRecording={isRecording}
                    recordingSeconds={recordingSeconds}
                    onStartVoice={startRecording}
                    onStopVoice={stopRecording}
                    voiceBusy={uploadingAttachment && uploadSource === "voice"}
                  />
                )}
              />
            )}

            <IncidentReportSceneEvidenceSection>
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

              <div className="grid grid-cols-3 gap-2">
                {isRecording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    data-testid="button-stop-recording"
                    className={cn(
                      "col-span-3 flex items-center justify-center gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-3.5",
                      "text-destructive animate-pulse active:scale-[0.99] transition-all touch-manipulation",
                    )}
                  >
                    <Square className="h-4 w-4 shrink-0" />
                    <span className="text-sm font-semibold">
                      Stop recording ({Math.floor(recordingSeconds / 60)}:{String(recordingSeconds % 60).padStart(2, "0")})
                    </span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => { setAttachmentError(null); fileInputRef.current?.click(); }}
                      disabled={uploadingAttachment}
                      data-testid="button-upload-file"
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3.5",
                        "hover:border-primary/35 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
                        "disabled:opacity-50 disabled:pointer-events-none min-h-[4.75rem]",
                      )}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {uploadingAttachment && uploadSource === "file" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Upload className="h-4 w-4" />
                        )}
                      </span>
                      <span className="text-[11px] font-medium leading-tight text-center">Upload</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleTakePhoto}
                      disabled={uploadingAttachment}
                      data-testid="button-take-photo"
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3.5",
                        "hover:border-primary/35 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
                        "disabled:opacity-50 disabled:pointer-events-none min-h-[4.75rem]",
                      )}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {uploadingAttachment && uploadSource === "camera" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Camera className="h-4 w-4" />
                        )}
                      </span>
                      <span className="text-[11px] font-medium leading-tight text-center">Photo</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => { setAttachmentError(null); startRecording(); }}
                      disabled={uploadingAttachment}
                      data-testid="button-start-recording"
                      className={cn(
                        "flex flex-col items-center justify-center gap-2 rounded-xl border border-border/70 bg-card px-2 py-3.5",
                        "hover:border-primary/35 hover:bg-muted/35 active:scale-[0.98] transition-all touch-manipulation",
                        "disabled:opacity-50 disabled:pointer-events-none min-h-[4.75rem]",
                      )}
                    >
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10 text-primary">
                        {uploadingAttachment && uploadSource === "voice" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Mic className="h-4 w-4" />
                        )}
                      </span>
                      <span className="text-[11px] font-medium leading-tight text-center">
                        {uploadingAttachment && uploadSource === "voice" ? "Saving…" : "Voice"}
                      </span>
                    </button>
                  </>
                )}
              </div>

              {attachmentError && (
                <p className="text-xs text-destructive" data-testid="text-attachment-error">
                  {attachmentError}
                </p>
              )}

              {existingAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Saved</p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {existingAttachments.map((att) => (
                      <div
                        key={att.id}
                        className="relative rounded-lg border border-border/80 overflow-hidden bg-card shadow-sm"
                        data-testid={`card-existing-attachment-${att.id}`}
                      >
                        <AttachmentPreview url={att.url} alt={att.filename} mimeType={att.mimeType} filename={att.filename} />
                        <div className="p-1.5 text-[10px] bg-background border-t border-border/60 space-y-0.5">
                          <p className="truncate font-medium">{att.filename}</p>
                          <p className="text-muted-foreground leading-tight truncate">
                            {attachmentUploaderLabel(att)}
                          </p>
                        </div>
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => handleDeleteExistingAttachment(att.id)}
                            className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80"
                            data-testid={`button-delete-existing-attachment-${att.id}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {pendingAttachments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Ready to submit ({pendingAttachments.length})
                  </p>
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                    {pendingAttachments.map((att, i) => {
                      const isAudio = resolveAttachmentKind(att.mimeType, att.filename) === "audio";
                      return (
                      <div
                        key={i}
                        className={cn(
                          "relative rounded-lg border border-primary/25 overflow-hidden bg-card shadow-sm",
                          isAudio && "col-span-3 sm:col-span-4",
                        )}
                        data-testid={`card-pending-attachment-${i}`}
                      >
                        <AttachmentPreview
                          url={att.url}
                          alt={att.filename}
                          mimeType={att.mimeType}
                          filename={att.filename}
                          compact={!isAudio}
                        />
                        {!isAudio && (
                        <div className="p-1.5 text-[10px] text-center truncate bg-background border-t border-border/60 font-medium">
                          {att.filename}
                        </div>
                        )}
                        <button
                          type="button"
                          onClick={() => setPendingAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                          className="absolute top-1 right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:opacity-80 z-10"
                          data-testid={`button-remove-pending-attachment-${i}`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );})}
                  </div>
                </div>
              )}
            </IncidentReportSceneEvidenceSection>

            <IncidentReportMoreDetailsSection enrichMode={Boolean(enrichIncident)}>
              <IncidentInvolvementSection
                customFields={watchedCustomFields}
                onChange={(next) => form.setValue("customFields", next)}
                personInvolved={personInvolved}
                vehicleInvolved={vehicleInvolved}
                onPersonInvolvedChange={setPersonInvolved}
                onVehicleInvolvedChange={setVehicleInvolved}
                threeColumnTiles={sapsCustomFields.length > 0}
                thirdColumnTile={
                  sapsCustomFields.length > 0 ? (
                    <SapsCaseTile
                      open={sapsSectionOpen}
                      onToggle={() => {
                        const next = !sapsSectionOpen;
                        setSapsSectionOpen(next);
                        if (!next) {
                          form.setValue(
                            "customFields",
                            clearSapsCustomFields(sapsCustomFields, watchedCustomFields),
                          );
                        }
                      }}
                    />
                  ) : undefined
                }
              />

              {sapsCustomFields.length > 0 && (
                <IncidentSapsSection
                  fields={sapsCustomFields}
                  customFields={watchedCustomFields}
                  onChange={(next) => form.setValue("customFields", next)}
                  hideTile
                  open={sapsSectionOpen}
                  onOpenChange={setSapsSectionOpen}
                />
              )}
            </IncidentReportMoreDetailsSection>

            {otherOrgCustomFields.length > 0 && (
              <div className="space-y-4">
                <h3 className="text-sm font-medium text-muted-foreground">Additional Fields</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {otherOrgCustomFields.map((cf) => {
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

            {activeIncident?.liveStartedAt && (
              <div className="rounded-md border border-border bg-muted/30 p-4 space-y-3" data-testid="section-live-timeline">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                  Live Incident Timeline
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Live Started</p>
                    <p className="text-sm mt-0.5" data-testid="text-live-started">{new Date(activeIncident.liveStartedAt).toLocaleString()}</p>
                  </div>
                  {activeIncident.responderArrivedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Responder Arrived</p>
                      <p className="text-sm mt-0.5" data-testid="text-responder-arrived">{new Date(activeIncident.responderArrivedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {activeIncident.liveStartLat != null && activeIncident.liveStartLng != null && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Origin Coordinates</p>
                      <div className="mt-0.5">
                        <CoordinateLink
                          lat={activeIncident.liveStartLat}
                          lng={activeIncident.liveStartLng}
                          onOpenMap={setGeoMapView}
                          className="text-sm"
                          testId="link-live-origin"
                        />
                      </div>
                    </div>
                  )}
                  {(activeIncident as any).destinationName && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Destination</p>
                      {(activeIncident as any).destinationLat != null && (activeIncident as any).destinationLng != null ? (
                        <div className="mt-0.5">
                          <CoordinateLink
                            lat={Number((activeIncident as any).destinationLat)}
                            lng={Number((activeIncident as any).destinationLng)}
                            label={(activeIncident as any).destinationName}
                            onOpenMap={setGeoMapView}
                            className="text-sm"
                            testId="link-live-destination"
                          />
                        </div>
                      ) : (
                        <p className="text-sm mt-0.5" data-testid="text-live-destination">{(activeIncident as any).destinationName}</p>
                      )}
                    </div>
                  )}
                  {activeIncident.responderArrivedAt && (() => {
                    const mins = (new Date(activeIncident.responderArrivedAt).getTime() - new Date(activeIncident.liveStartedAt!).getTime()) / 60000;
                    const label = mins < 1 ? "< 1 min" : `${Math.round(mins)} min`;
                    return (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Response Time</p>
                        <p className="text-sm mt-0.5 font-medium" data-testid="text-response-time">{label}</p>
                      </div>
                    );
                  })()}
                  {activeIncident.liveEndedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Closed</p>
                      <p className="text-sm mt-0.5" data-testid="text-live-ended">{new Date(activeIncident.liveEndedAt).toLocaleString()}</p>
                    </div>
                  )}
                  {activeIncident.liveEndedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">End Type</p>
                      <p className="text-sm mt-0.5 font-medium" data-testid="text-live-end-type">
                        {activeIncident.liveClosedManually ? "Manually closed" : "Converted to incident"}
                      </p>
                    </div>
                  )}
                  {(activeIncident as any).closedByName && activeIncident.liveEndedAt && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Closed by</p>
                      <p className="text-sm mt-0.5 font-medium" data-testid="text-live-closed-by">{(activeIncident as any).closedByName}</p>
                    </div>
                  )}
                  {activeIncident.liveEndedAt && (() => {
                    const totalMs = new Date(activeIncident.liveEndedAt).getTime() - new Date(activeIncident.liveStartedAt!).getTime();
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
                  {activeIncident.liveEndedAt && !activeIncident.liveClosedManually && activeIncident.liveConvertLat != null && activeIncident.liveConvertLng != null && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Location at Submission</p>
                      <div className="mt-0.5">
                        <CoordinateLink
                          lat={activeIncident.liveConvertLat}
                          lng={activeIncident.liveConvertLng}
                          onOpenMap={setGeoMapView}
                          className="text-sm"
                          testId="link-live-convert-location"
                        />
                      </div>
                    </div>
                  )}
                  {activeIncident.liveEndedAt && activeIncident.liveClosedManually && (activeIncident as any).liveEndLat != null && (activeIncident as any).liveEndLng != null && (
                    <div>
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Closed From</p>
                      <div className="mt-0.5">
                        <CoordinateLink
                          lat={Number((activeIncident as any).liveEndLat)}
                          lng={Number((activeIncident as any).liveEndLng)}
                          onOpenMap={setGeoMapView}
                          className="text-sm"
                          testId="link-live-end-location"
                        />
                      </div>
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
                                  <CoordinateLink
                                    lat={r.lastLat}
                                    lng={r.lastLng}
                                    onOpenMap={setGeoMapView}
                                    className="text-xs"
                                    testId={`link-responder-gps-${r.id}`}
                                  />
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

          </form>
        </Form>
        )}
        </div>

        {!isSuccessView && (
        <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 px-6 py-4 border-t border-border/50 bg-muted/20">
          <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)} data-testid="button-cancel-incident" className="h-11 sm:min-w-[6.5rem]">
            Cancel
          </Button>
          <Button
            type="submit"
            form="incident-report-form"
            data-testid="button-submit-incident"
            disabled={mutation.isPending}
            className={cn(
              "h-12 text-base font-semibold shadow-sm",
              !incident && "flex-1 sm:flex-none sm:min-w-[11rem] bg-primary hover:bg-primary/90 text-primary-foreground",
            )}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {incident ? "Update Incident" : enrichIncident ? "Save details" : "Report Incident"}
          </Button>
        </div>
        )}
      </DialogContent>
    </Dialog>

      <GeoLocationSheet view={geoMapView} onClose={() => setGeoMapView(null)} />

      {mapModalOpen && (
        <Dialog open={mapModalOpen} onOpenChange={cancelMapModal}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Pick Location on Map</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              {locationProbe != null && !locationReady && (
                <div className="space-y-3" data-testid="banner-incident-location-off">
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/15 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
                    <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Location is off or unavailable.</strong> Open settings to turn on Location for OMT Pulse, then return here to centre the map on your position.
                    </span>
                  </div>
                  <OpenLocationSettingsButton
                    variant="light"
                    testId="button-incident-open-location-settings"
                    onAfterOpen={() => void refreshLocationProbe(true)}
                  />
                </div>
              )}
              {locationReady && (
                <div
                  className="flex items-start gap-2 rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm text-green-800 dark:text-green-200"
                  data-testid="banner-incident-location-ready"
                >
                  <MapPin className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>GPS ready — your position is selected. Tap <strong>Use This Location</strong> or move the pin on the map.</span>
                </div>
              )}
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
                {mapLoading ? "Finding the nearest address..." : pendingAddress || "Tap anywhere on the map to pick the incident location."}
              </p>
              {confirmCoords && (
                <p className="text-xs text-muted-foreground" data-testid="text-picked-coordinates">
                  Selected: {confirmCoords.lat.toFixed(5)}, {confirmCoords.lng.toFixed(5)}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={cancelMapModal} data-testid="button-map-cancel">
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    if (confirmCoords) {
                      form.setValue("latitude", confirmCoords.lat);
                      form.setValue("longitude", confirmCoords.lng);
                      form.setValue("locationId", null);
                      if (!form.getValues("locationName")) {
                        form.setValue("locationName", `Dropped pin (${confirmCoords.lat.toFixed(5)}, ${confirmCoords.lng.toFixed(5)})`);
                      }
                    }
                    setMapModalOpen(false);
                  }}
                  disabled={!confirmCoords}
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

export function AttachmentsDialog({
  open,
  onOpenChange,
  incidentId,
  canAdd = true,
  canDelete = false,
}: AttachmentsDialogProps) {
  const { data: incident } = useQuery<Incident>({
    queryKey: ["/api/incidents", incidentId],
    queryFn: async () => {
      const res = await fetch(`/api/incidents/${incidentId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load incident");
      return res.json();
    },
    enabled: open && incidentId > 0,
    staleTime: 60_000,
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle data-testid="text-attachments-title">Evidence</DialogTitle>
        </DialogHeader>
        <IncidentEvidenceSection
          incidentId={incidentId}
          canAdd={canAdd}
          canDelete={canDelete}
          splitPhases
          liveEndedAt={incident?.liveEndedAt}
          incidentCreatedAt={incident?.createdAt}
        />
      </DialogContent>
    </Dialog>
  );
}
