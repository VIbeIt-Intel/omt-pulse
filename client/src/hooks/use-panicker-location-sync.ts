import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { hasPanicCoordinates, quickPanicLocationCheck } from "@/lib/panic-location";

/** Avoid hammering the API on every GPS tick while still tracking movement. */
const PANIC_GPS_MIN_INTERVAL_MS = 10_000;
/** Ignore tiny jitter so we don't rewrite the same spot. */
const PANIC_GPS_MIN_MOVE_M = 12;

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * While the user's own panic is active, keep sharing GPS (dashboard or live page).
 * Live Monitor "No GPS" / frozen pins happen when this is not running.
 */
export function usePanickerLocationSync(
  incidentId: number | null | undefined,
  enabled: boolean,
  hasCoordsOnRecord: boolean,
) {
  const qc = useQueryClient();
  const watchIdRef = useRef<number | null>(null);
  const lastSentRef = useRef<{ lat: number; lng: number; at: number } | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!enabled || !incidentId) return;

    const pushCoords = async (lat: number, lng: number, force = false) => {
      const now = Date.now();
      const last = lastSentRef.current;
      if (!force && last) {
        if (now - last.at < PANIC_GPS_MIN_INTERVAL_MS) return;
        if (haversineM(last, { lat, lng }) < PANIC_GPS_MIN_MOVE_M) return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        await apiRequest("PATCH", `/api/incidents/${incidentId}/panic-location`, { lat, lng });
        lastSentRef.current = { lat, lng, at: now };
        void qc.invalidateQueries({ queryKey: ["/api/panic/recent"] });
        void qc.invalidateQueries({ queryKey: ["/api/incidents/live"] });
        void qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
      } catch {
        /* retry on next tick */
      } finally {
        inFlightRef.current = false;
      }
    };

    const tryOnce = async () => {
      const loc = await quickPanicLocationCheck();
      if (hasPanicCoordinates(loc)) {
        await pushCoords(loc.lat, loc.lng, true);
      }
    };

    // Always push once on enable so Live Monitor gets responderLat even if the
    // create payload already had coords (covers older incidents + permission grants).
    void tryOnce();

    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        void pushCoords(lat, lng, !hasCoordsOnRecord && !lastSentRef.current);
      },
      () => {
        /* permission still off */
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 },
    );

    return () => {
      if (watchIdRef.current != null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
    };
  }, [enabled, incidentId, hasCoordsOnRecord, qc]);
}
