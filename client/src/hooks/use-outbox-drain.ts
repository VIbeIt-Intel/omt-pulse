import { useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { drainOutbox, countOutboxJobs } from "@/lib/offline-outbox";
import { readCachedAuthUser } from "@/lib/auth-cache";
import { usesFarmerPhone } from "@/lib/farmer-phone";
import { useQueryClient } from "@tanstack/react-query";

/** Drain SOS / Report Incident outbox whenever connectivity returns. */
export function useOutboxDrain(enabled: boolean) {
  const { toast } = useToast();
  const { t } = useFarmerLang();
  const qc = useQueryClient();
  const drainingRef = useRef(false);

  useEffect(() => {
    if (!enabled) return;

    async function runDrain(reason: string) {
      if (drainingRef.current || !navigator.onLine) return;
      drainingRef.current = true;
      try {
        const pending = await countOutboxJobs();
        if (pending === 0) return;
        const { drained, failed } = await drainOutbox();
        if (drained > 0) {
          qc.invalidateQueries({ queryKey: ["/api/incidents"] });
          qc.invalidateQueries({ queryKey: ["/api/stats"] });
          qc.invalidateQueries({ queryKey: ["/api/fire/active"] });
          qc.invalidateQueries({ queryKey: ["/api/crime"] });
          qc.invalidateQueries({ queryKey: ["/api/chat/messages"] });
          qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
          const farmer = usesFarmerPhone(readCachedAuthUser()?.role ?? "");
          toast({
            title: farmer ? t.syncedFromPhone : "Offline items synced",
            description: farmer
              ? t.syncedFromPhoneHint
              : drained === 1
                ? "1 queued alert/report was sent."
                : `${drained} queued alerts/reports were sent.`,
          });
        } else if (failed > 0 && reason === "online") {
          toast({
            title: "Sync incomplete",
            description: "Could not send all offline items. Will retry when you’re back online.",
            variant: "destructive",
          });
        }
      } catch {
        /* ignore — next online event retries */
      } finally {
        drainingRef.current = false;
      }
    }

    const onOnline = () => void runDrain("online");
    window.addEventListener("online", onOnline);
    void runDrain("mount");

    return () => window.removeEventListener("online", onOnline);
  }, [enabled, toast, qc, t]);
}
