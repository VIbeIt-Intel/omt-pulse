import { useEffect, useState } from "react";
import { Loader2, Mic, Radio, Settings, Users, Volume2 } from "lucide-react";
import {
  useRadioChannel,
  useRadioChannels,
  useRadioStatus,
} from "@/hooks/use-radio-channel";
import { RadioPttButton } from "@/components/radio/radio-ptt-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { openOmtAppDetailsSettings } from "@/lib/omt-app-settings";
import { Capacitor } from "@capacitor/core";
import { cn } from "@/lib/utils";

export function RadioPanel({
  className,
  compact = false,
  /** Sticky dock for field home — always listening, big PTT, minimal chrome. */
  dock = false,
  defaultCommandId,
}: {
  className?: string;
  compact?: boolean;
  dock?: boolean;
  /** Prefer this group when present in the channel list. */
  defaultCommandId?: number | null;
}) {
  const available = useRadioStatus();
  const enabled = available === true;
  const { channels, loading: channelsLoading } = useRadioChannels(enabled);
  const [commandId, setCommandId] = useState<number | null>(null);
  const [requestingMic, setRequestingMic] = useState(false);

  useEffect(() => {
    if (channels.length === 0) {
      setCommandId(null);
      return;
    }
    setCommandId((prev) => {
      if (prev != null && channels.some((c) => c.id === prev)) return prev;
      if (defaultCommandId != null && channels.some((c) => c.id === defaultCommandId)) {
        return defaultCommandId;
      }
      const central = channels.find((c) => c.isCentral);
      return central?.id ?? channels[0].id;
    });
  }, [channels, defaultCommandId]);

  const radio = useRadioChannel(enabled ? commandId : null);
  const busy = !!(radio.floor && !radio.floor.isMe);
  const needsMicAllow =
    Capacitor.isNativePlatform() && radio.micPermission === "denied";

  // First interaction on the dock unlocks speaker (Android/WebView autoplay).
  useEffect(() => {
    if (!radio.connected || radio.speakerReady) return;
    const unlock = () => {
      void radio.unlockSpeaker();
    };
    window.addEventListener("pointerdown", unlock, { once: true, capture: true });
    return () => window.removeEventListener("pointerdown", unlock, true);
  }, [radio.connected, radio.speakerReady, radio.unlockSpeaker]);

  const statusLine = radio.transmitting
    ? "You are on air — tap again to stop"
    : radio.remoteTalking
      ? `${radio.remoteTalking} talking`
      : busy && radio.floor
        ? `${radio.floor.displayName} has the floor`
        : radio.connecting
          ? "Connecting radio…"
          : radio.connected
            ? radio.speakerReady
              ? "Live — tap to talk"
              : "Live — tap once, then tap to talk"
            : "Radio offline";

  if (available === null) {
    return (
      <div className={cn("rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        Checking radio…
      </div>
    );
  }

  if (!available) {
    if (dock) return null;
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground",
          className,
        )}
        data-testid="radio-unavailable"
      >
        <div className="flex items-center gap-2 font-medium text-foreground/80">
          <Radio className="h-4 w-4" />
          Radio
        </div>
        <p className="mt-1 text-xs leading-relaxed">
          Live radio is not configured on this server yet.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-500/30 bg-emerald-950/20",
        dock ? "p-3 space-y-2 shadow-lg shadow-black/20" : compact ? "p-3 space-y-2.5" : "p-4 space-y-3",
        className,
      )}
      data-testid={dock ? "radio-dock" : "radio-panel"}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <Radio className="h-4 w-4 shrink-0" />
            {dock ? "Radio" : "Group radio"}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{statusLine}</p>
        </div>
        {radio.connected ? (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums shrink-0">
            <Users className="h-3.5 w-3.5" />
            {radio.listenerCount}
          </span>
        ) : null}
      </div>

      {channelsLoading ? (
        <p className="text-xs text-muted-foreground">Loading channels…</p>
      ) : channels.length === 0 ? (
        <p className="text-xs text-muted-foreground">No groups assigned — join a Pulse Group to use radio.</p>
      ) : (
        <>
          <Select
            value={commandId != null ? String(commandId) : undefined}
            onValueChange={(v) => setCommandId(Number(v))}
          >
            <SelectTrigger
              className={cn("bg-background/50", dock ? "h-8 text-xs" : "h-9")}
              data-testid="select-radio-channel"
            >
              <SelectValue placeholder="Select channel" />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                  {c.isCentral ? " (Central)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {needsMicAllow ? (
            <div className="space-y-2">
              <Button
                type="button"
                className="w-full h-11 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white"
                data-testid="button-radio-allow-mic"
                disabled={requestingMic}
                onClick={() => {
                  setRequestingMic(true);
                  void radio.requestMicAccess().finally(() => setRequestingMic(false));
                }}
              >
                {requestingMic ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Mic className="h-4 w-4" />
                )}
                Allow microphone
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 gap-2"
                data-testid="button-radio-open-mic-settings"
                onClick={() => void openOmtAppDetailsSettings()}
              >
                <Settings className="h-4 w-4" />
                Open app permission settings
              </Button>
            </div>
          ) : null}

          {radio.connected && !radio.speakerReady && !dock ? (
            <Button
              type="button"
              variant="secondary"
              className="w-full h-11 gap-2"
              data-testid="button-radio-enable-speaker"
              onClick={() => void radio.unlockSpeaker()}
            >
              <Volume2 className="h-4 w-4" />
              Enable speaker
            </Button>
          ) : null}

          <RadioPttButton
            disabled={!radio.connected || radio.connecting || needsMicAllow}
            transmitting={radio.transmitting}
            busy={busy}
            className={dock ? "min-h-[4.25rem] py-3" : undefined}
            label="Tap to talk"
            onPressStart={() => void radio.startTransmit()}
            onPressEnd={() => void radio.stopTransmit()}
          />

          {radio.error ? (
            <p className="text-xs text-amber-400" data-testid="text-radio-error">
              {radio.error}
            </p>
          ) : dock ? (
            <p className="text-[10px] text-muted-foreground/80">
              Tap to talk, tap again to stop. Always on while you are on this screen — audio is never
              saved.
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/80">
              Mic stays allowed after the first Android Allow (same as voice notes). Audio is never saved.
            </p>
          )}
        </>
      )}
    </div>
  );
}
