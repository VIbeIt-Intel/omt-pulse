import { useEffect } from "react";
import { getStoredWorkstationToken, workstationAuthHeaders } from "@/lib/workstation-session";

/** Keep dedicated-device lastSeenAt fresh while the app is open. */
export function useWorkstationHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    if (!getStoredWorkstationToken()) return;

    let stopped = false;

    async function beat() {
      if (stopped || !navigator.onLine) return;
      try {
        await fetch("/api/workstations/heartbeat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...workstationAuthHeaders(),
          },
          credentials: "include",
          body: "{}",
        });
      } catch {
        /* ignore */
      }
    }

    void beat();
    const id = window.setInterval(() => void beat(), 60_000);
    return () => {
      stopped = true;
      window.clearInterval(id);
    };
  }, [enabled]);
}
