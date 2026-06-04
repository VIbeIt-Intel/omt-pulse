import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { hasPanicCoordinates, quickPanicLocationCheck } from "@/lib/panic-location";

/**
 * While the user's own panic is active, keep trying to share GPS (e.g. location was off at SOS).
 */
export function usePanickerLocationSync(
  incidentId: number | null | undefined,
  enabled: boolean,
  hasCoordsOnRecord: boolean,
) {
  const qc = useQueryClient();
  const watchIdRef = useRef<number | null>(null);
  const postedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !incidentId) return;

    const pushCoords = async (lat: number, lng: number) => {
      try {
        await apiRequest("PATCH", `/api/incidents/${incidentId}/panic-location`, { lat, lng });
        postedRef.current = true;
        void qc.invalidateQueries({ queryKey: ["/api/panic/recent"] });
        void qc.invalidateQueries({ queryKey: ["/api/incidents/live"] });
        void qc.invalidateQueries({ queryKey: ["/api/dashboard"] });
      } catch {
        /* retry on next tick */
      }
    };

    const tryOnce = async () => {
      const loc = await quickPanicLocationCheck();
      if (hasPanicCoordinates(loc)) {
        await pushCoords(loc.lat, loc.lng);
      }
    };

    if (!hasCoordsOnRecord) {
      void tryOnce();
    }

    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        void pushCoords(lat, lng);
      },
      () => { /* permission still off */ },
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
