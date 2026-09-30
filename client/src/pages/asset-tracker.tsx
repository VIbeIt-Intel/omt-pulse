import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { Loader2, MapPin, TabletSmartphone } from "lucide-react";
import { ASSET_TYPE_LABELS, type AssetType } from "@shared/assets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  clearAssetTrackerToken,
  enrolAssetTracker,
  fetchAssetTrackerStatus,
  getAssetTrackerToken,
  startAssetTracking,
  stopAssetTracking,
  type AssetTrackerStatus,
} from "@/lib/asset-tracker";

function formatWhen(value: string | null): string {
  if (!value) return "Waiting for the first location";
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "Waiting for the first location";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60_000));
  if (mins < 1) return "Location sent just now";
  if (mins < 60) return `Location sent ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `Location sent ${hours} h ago`;
  return `Location sent ${Math.round(hours / 24)} d ago`;
}

export default function AssetTrackerPage() {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(() => getAssetTrackerToken());
  const [status, setStatus] = useState<AssetTrackerStatus | null>(null);
  const [localSentAt, setLocalSentAt] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let stopped = false;
    void fetchAssetTrackerStatus(token)
      .then((next) => {
        if (!stopped) setStatus(next);
      })
      .catch((err: Error) => {
        if (stopped || getAssetTrackerToken()) return;
        setToken(null);
        setStatus(null);
        toastRef.current({ title: "Tracker stopped", description: err.message, variant: "destructive" });
      });
    void startAssetTracking({
      onSent: () => {
        if (!stopped) setLocalSentAt(new Date().toISOString());
      },
      onRemoved: () => {
        if (stopped) return;
        setToken(null);
        setStatus(null);
        toastRef.current({
          title: "Tracker removed",
          description: "This tablet is no longer linked to an asset.",
          variant: "destructive",
        });
      },
    });
    const poll = window.setInterval(() => {
      const current = getAssetTrackerToken();
      if (!current) return;
      void fetchAssetTrackerStatus(current)
        .then((next) => {
          if (!stopped) setStatus(next);
        })
        .catch(() => {});
    }, 30_000);
    return () => {
      stopped = true;
      window.clearInterval(poll);
      void stopAssetTracking();
    };
  }, [token]);

  async function handleEnrol() {
    if (!code.trim()) return;
    setBusy(true);
    try {
      const enrolled = await enrolAssetTracker(code);
      setStatus({
        name: enrolled.name,
        assetType: enrolled.assetType,
        lastLat: null,
        lastLng: null,
        lastBatteryPercent: null,
        lastSeenAt: null,
      });
      setToken(getAssetTrackerToken());
      toast({ title: "Tracker on", description: `${enrolled.name} will share its location.` });
    } catch (err) {
      toast({
        title: "Enrolment failed",
        description: err instanceof Error ? err.message : "Invalid code",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleStop() {
    await stopAssetTracking();
    clearAssetTrackerToken();
    setToken(null);
    setStatus(null);
    setLocalSentAt(null);
  }

  const seenAt = localSentAt ?? status?.lastSeenAt ?? null;
  const typeLabel = status ? ASSET_TYPE_LABELS[status.assetType as AssetType] ?? status.assetType : null;

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background" data-testid="asset-tracker-page">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="text-center space-y-2">
          <TabletSmartphone className="h-10 w-10 mx-auto text-primary" />
          <h1 className="text-xl font-semibold">{status?.name ?? "Asset tracker"}</h1>
          <p className="text-sm text-muted-foreground">
            {token
              ? "This tablet is sharing its location with OMT. Leave the app installed and allow location all the time. Android keeps a small notification while tracking is on."
              : "Enter the code from Assets. This tablet does not sign in. It only reports where it is."}
          </p>
        </div>

        {token ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-1 text-sm">
              {typeLabel && <p className="text-muted-foreground">{typeLabel}</p>}
              <p>{formatWhen(seenAt)}</p>
              {status?.lastBatteryPercent != null && (
                <p className="text-muted-foreground">Battery {status.lastBatteryPercent}%</p>
              )}
              {status?.lastLat != null && status.lastLng != null && (
                <a
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                  href={`https://www.google.com/maps?q=${status.lastLat},${status.lastLng}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  Last position
                </a>
              )}
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={() => void handleStop()}>
              Stop tracking on this tablet
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="asset-tracker-code">Enrolment code</Label>
              <Input
                id="asset-tracker-code"
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="e.g. A1B2C3D4"
                className="h-12 text-center text-lg tracking-widest font-mono uppercase"
                autoComplete="off"
                autoCapitalize="characters"
              />
            </div>
            <Button type="button" className="w-full h-11" disabled={!code.trim() || busy} onClick={() => void handleEnrol()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start tracking"}
            </Button>
          </div>
        )}

        <Link href="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground hover:underline">
          Back to sign in
        </Link>
      </div>
    </div>
  );
}
