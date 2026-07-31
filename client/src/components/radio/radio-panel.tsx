import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Loader2, Mic, Radio, Settings, Users, Volume2 } from "lucide-react";
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
  /** Slim bar when docked; radio stays connected either way. */
  collapsed = false,
  onCollapsedChange,
  defaultCommandId,
}: {
  className?: string;
  compact?: boolean;
  dock?: boolean;
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
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

  // First interaction unlocks speaker (Android/WebView autoplay).
  // Keep listening until unlock succeeds — a single missed tap left phones deaf.
  useEffect(() => {
    if (!radio.connected || radio.speakerReady) return;
    const unlock = () => {
      void radio.unlockSpeaker();
    };
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("touchstart", unlock, { capture: true });
    // Retry a few times after connect in case LiveKit tracks arrive late.
    const t1 = window.setTimeout(unlock, 400);
    const t2 = window.setTimeout(unlock, 1500);
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("touchstart", unlock, true);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [radio.connected, radio.speakerReady, radio.unlockSpeaker]);

  // Whenever someone talks and speaker is still locked, keep trying + flash the CTA.
  useEffect(() => {
    if (!radio.connected || !radio.remoteTalking || radio.speakerReady) return;
    void radio.unlockSpeaker();
  }, [radio.connected, radio.remoteTalking, radio.speakerReady, radio.unlockSpeaker]);

  // Keep dock collapsed while traffic happens — status pill shows Incoming / On air.
  // Auto-expand was overcrowding phones; users expand manually for channel changes.

  const selectedChannel = channels.find((c) => c.id === commandId);
  const channelLabel = selectedChannel
    ? `${selectedChannel.name}${selectedChannel.isCentral ? " (Central)" : ""}`
    : "Select channel";

  const isConnecting = radio.connecting || channelsLoading || (enabled && commandId == null);
  const connectionStatus = radio.transmitting
    ? { label: "On air", tone: "live" as const }
    : radio.remoteTalking
      ? { label: "Incoming", tone: "talk" as const }
      : isConnecting
        ? { label: "Connecting", tone: "wait" as const }
        : radio.connected
          ? { label: "Online", tone: "live" as const }
          : { label: "Offline", tone: "bad" as const };

  const statusLine = radio.transmitting
    ? "You are on air — release to stop"
    : radio.remoteTalking && !radio.speakerReady
      ? `${radio.remoteTalking} talking — tap Enable speaker`
      : radio.remoteTalking
      ? `${radio.remoteTalking} talking`
      : busy && radio.floor
        ? `${radio.floor.displayName} has the floor`
        : isConnecting
          ? "Connecting…"
          : radio.connected
            ? radio.speakerReady
              ? "Online — hold to talk"
              : "Online — tap Enable speaker to hear"
            : radio.error
              ? radio.error
              : "Offline — tap Retry to reconnect";

  const statusPillClass =
    connectionStatus.tone === "live"
      ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
      : connectionStatus.tone === "talk"
        ? "bg-amber-500/25 text-amber-200 border border-amber-500/35"
        : connectionStatus.tone === "wait"
          ? "bg-sky-500/20 text-sky-200 border border-sky-500/35"
          : "bg-red-500/20 text-red-300 border border-red-500/35";

  const statusDotClass =
    connectionStatus.tone === "live"
      ? "bg-emerald-400"
      : connectionStatus.tone === "talk"
        ? "bg-amber-400"
        : connectionStatus.tone === "wait"
          ? "bg-sky-400"
          : "bg-red-400";

  if (available === null) {
    if (dock) return null;
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

  if (dock && collapsed) {
    const toneClass =
      connectionStatus.tone === "live"
        ? "border-emerald-500/40 bg-emerald-950/30"
        : connectionStatus.tone === "talk"
          ? "border-amber-500/40 bg-amber-950/25"
          : connectionStatus.tone === "wait"
            ? "border-sky-500/40 bg-sky-950/20"
            : "border-red-500/40 bg-red-950/20";

    return (
      <div
        className={cn("rounded-lg border px-2 py-1.5", toneClass, className)}
        data-testid="radio-dock"
        data-collapsed="true"
        data-radio-status={connectionStatus.label.toLowerCase()}
      >
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="min-w-0 flex-1 flex items-center gap-2 text-left rounded-md hover:bg-white/5 -ml-0.5 pl-0.5 py-0.5"
            aria-label="Expand radio"
            data-testid="button-radio-expand"
            onClick={() => onCollapsedChange?.(false)}
          >
            <ChevronUp className="h-4 w-4 shrink-0 text-emerald-400" />
            <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-400">
              <Radio className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">Radio</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                  statusPillClass,
                )}
                data-testid="radio-dock-status"
              >
                {connectionStatus.tone === "wait" ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      statusDotClass,
                      (connectionStatus.tone === "live" || connectionStatus.tone === "talk") &&
                        "animate-pulse",
                    )}
                    aria-hidden
                  />
                )}
                {connectionStatus.label}
              </span>
              {radio.connected ? (
                <span className="inline-flex items-center gap-0.5 text-[10px] font-normal text-muted-foreground tabular-nums">
                  <Users className="h-3 w-3" />
                  {radio.listenerCount}
                </span>
              ) : null}
            </div>
            <p className="truncate text-[10px] text-muted-foreground leading-tight">
              {radio.remoteTalking || radio.transmitting || isConnecting || !radio.connected
                ? statusLine
                : channelLabel}
            </p>
            </div>
          </button>
          {radio.connected && !radio.speakerReady ? (
            <Button
              type="button"
              size="sm"
              className="h-9 shrink-0 gap-1 bg-amber-600 hover:bg-amber-500 text-white px-2"
              data-testid="button-radio-enable-speaker"
              onClick={() => void radio.unlockSpeaker()}
            >
              <Volume2 className="h-3.5 w-3.5" />
              Hear
            </Button>
          ) : (
            <RadioPttButton
              disabled={!radio.connected || radio.connecting || needsMicAllow}
              transmitting={radio.transmitting}
              busy={busy}
              compact
              label="Hold"
              onPressStart={() => {
                void radio.unlockSpeaker();
                void radio.startTransmit();
              }}
              onPressEnd={() => void radio.stopTransmit()}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-500/30 bg-emerald-950/20",
        dock ? "p-2 sm:p-3 space-y-1.5 sm:space-y-2 shadow-lg shadow-black/20" : compact ? "p-3 space-y-2.5" : "p-4 space-y-3",
        className,
      )}
      data-testid={dock ? "radio-dock" : "radio-panel"}
      data-collapsed={dock ? "false" : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400 flex-wrap">
            <Radio className="h-4 w-4 shrink-0" />
            {dock ? "Radio" : "Group radio"}
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
                statusPillClass,
              )}
              data-testid="radio-dock-status"
            >
              {connectionStatus.tone === "wait" ? (
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
              ) : (
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    statusDotClass,
                    (connectionStatus.tone === "live" || connectionStatus.tone === "talk") &&
                      "animate-pulse",
                  )}
                  aria-hidden
                />
              )}
              {connectionStatus.label}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">{statusLine}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {radio.connected ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground tabular-nums">
              <Users className="h-3.5 w-3.5" />
              {radio.listenerCount}
            </span>
          ) : null}
          {dock && onCollapsedChange ? (
            <button
              type="button"
              className="rounded-md p-1.5 text-muted-foreground hover:bg-emerald-500/10 hover:text-emerald-400"
              aria-label="Collapse radio"
              data-testid="button-radio-collapse"
              onClick={() => onCollapsedChange(true)}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : null}
        </div>
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

          {radio.connected && !radio.speakerReady ? (
            <Button
              type="button"
              variant="secondary"
              className={cn(
                "w-full gap-2 bg-amber-600 hover:bg-amber-500 text-white",
                dock ? "h-10 text-sm font-semibold" : "h-11",
              )}
              data-testid="button-radio-enable-speaker"
              onClick={() => void radio.unlockSpeaker()}
            >
              <Volume2 className="h-4 w-4" />
              {radio.remoteTalking
                ? `Tap to hear ${radio.remoteTalking}`
                : "Tap to enable speaker"}
            </Button>
          ) : null}

          <RadioPttButton
            disabled={!radio.connected || radio.connecting || needsMicAllow}
            transmitting={radio.transmitting}
            busy={busy}
            compact={dock}
            className={dock ? "w-full min-h-11" : undefined}
            label="Hold to talk"
            onPressStart={() => {
              void radio.unlockSpeaker();
              void radio.startTransmit();
            }}
            onPressEnd={() => void radio.stopTransmit()}
          />

          {radio.error ? (
            <div className="space-y-2">
              <p className="text-xs text-amber-400" data-testid="text-radio-error">
                {radio.error}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full h-9"
                data-testid="button-radio-retry"
                disabled={radio.connecting}
                onClick={() => radio.reconnect()}
              >
                {radio.connecting ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : null}
                Retry radio connection
              </Button>
            </div>
          ) : dock ? null : (
            <p className="text-[10px] text-muted-foreground/80">
              Hold the button to transmit, release to stop. Mic stays allowed after the first Android
              Allow (same as voice notes). Audio is never saved.
            </p>
          )}
        </>
      )}
    </div>
  );
}
