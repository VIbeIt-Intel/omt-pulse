import { useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Camera, Mic, MapPin, ShieldCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

const PRIMER_KEY = "omt-permission-primer-seen";

const isSupported =
  typeof window !== "undefined" &&
  window.isSecureContext &&
  (Capacitor.isNativePlatform() || !!navigator.permissions);

function hasSeen(): boolean {
  return localStorage.getItem(PRIMER_KEY) === "1";
}

function markSeen(): void {
  localStorage.setItem(PRIMER_KEY, "1");
}

export function PermissionPrimerModal() {
  const [visible] = useState(() => isSupported && !hasSeen());
  const [requesting, setRequesting] = useState(false);
  const [done, setDone] = useState(false);

  if (!visible || done) return null;

  async function handleAllow() {
    setRequesting(true);
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ video: true }).catch(() => null);
      stream?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    try {
      const stream = await navigator.mediaDevices?.getUserMedia({ audio: true }).catch(() => null);
      stream?.getTracks().forEach((t) => t.stop());
    } catch { /* ignore */ }
    await new Promise<void>((resolve) => {
      if (!navigator.geolocation) { resolve(); return; }
      navigator.geolocation.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 8000 });
    });
    markSeen();
    setDone(true);
    setRequesting(false);
  }

  function handleSkip() {
    markSeen();
    setDone(true);
  }

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/90 backdrop-blur-sm px-4"
      data-testid="overlay-permission-primer"
    >
      <div className="w-full max-w-sm bg-card border border-border rounded-2xl shadow-xl p-6 space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center">
            <ShieldCheck className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold" data-testid="text-primer-title">
              Before you start
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              OMT uses your device's camera, microphone, and location to capture evidence and pin incidents on the map.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <PermissionRow
            icon={<Camera className="h-5 w-5 text-primary" />}
            label="Camera"
            reason="Photograph evidence at the scene"
          />
          <PermissionRow
            icon={<Mic className="h-5 w-5 text-primary" />}
            label="Microphone"
            reason="Record voice notes while reporting"
          />
          <PermissionRow
            icon={<MapPin className="h-5 w-5 text-primary" />}
            label="Location"
            reason="Pin exactly where the incident occurred"
          />
        </div>

        <div className="space-y-2">
          <Button
            className="w-full"
            onClick={handleAllow}
            disabled={requesting}
            data-testid="button-allow-permissions"
          >
            {requesting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Requesting access…</>
            ) : (
              "Allow Permissions"
            )}
          </Button>
          <button
            type="button"
            onClick={handleSkip}
            disabled={requesting}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
            data-testid="button-skip-permissions"
          >
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}

function PermissionRow({ icon, label, reason }: { icon: React.ReactNode; label: string; reason: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-muted/40 px-3 py-2.5">
      <div className="shrink-0 h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium leading-tight">{label}</p>
        <p className="text-xs text-muted-foreground mt-0.5 leading-tight">{reason}</p>
      </div>
    </div>
  );
}
