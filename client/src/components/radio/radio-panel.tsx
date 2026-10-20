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
import { useControlRoomLang } from "@/hooks/use-control-room-lang";

const radioEn = {
  radio: "Radio",
  groupRadio: "Group radio",
  hold: "Hold",
  holdToTalk: "Hold to talk",
  hear: "Hear",
  online: "Online",
  onAir: "On air",
  incoming: "Incoming",
  connecting: "Connecting",
  offline: "Offline",
  central: "Central",
  selectChannel: "Select channel",
  checking: "Checking radio…",
  notConfigured: "Live radio is not configured on this server yet.",
  loadingChannels: "Loading channels…",
  noGroups: "No groups assigned — join a Pulse Group to use radio.",
  allowMic: "Allow microphone",
  openSettings: "Open app permission settings",
  enableSpeaker: "Tap to enable speaker",
  retry: "Retry radio connection",
  collapse: "Collapse radio",
  youOnAir: "You are on air — release to stop",
  connectingDots: "Connecting…",
  onlineHold: "Online — hold to talk",
  onlineEnable: "Online — tap Enable speaker to hear",
  offlineRetry: "Offline — tap Retry to reconnect",
  help: "Hold the button to transmit, release to stop. Mic stays allowed after the first Android Allow (same as voice notes). Audio is never saved.",
  paused: "Group radio paused — private radio is active",
};

const radioAf = {
  radio: "Radio",
  groupRadio: "Groepradio",
  hold: "Hou",
  holdToTalk: "Hou in om te praat",
  hear: "Hoor",
  online: "Aanlyn",
  onAir: "Op die lug",
  incoming: "Inkomend",
  connecting: "Koppel",
  offline: "Vanlyn",
  central: "Sentraal",
  selectChannel: "Kies kanaal",
  checking: "Kontroleer radio…",
  notConfigured: "Lewende radio is nog nie op hierdie bediener opgestel nie.",
  loadingChannels: "Laai kanale…",
  noGroups: "Geen groepe toegeken nie — sluit by 'n groep aan om radio te gebruik.",
  allowMic: "Laat mikrofoon toe",
  openSettings: "Maak toestemminginstellings oop",
  enableSpeaker: "Tik om die luidspreker aan te sit",
  retry: "Probeer radio weer",
  collapse: "Vou radio toe",
  youOnAir: "Jy is op die lug — los om te stop",
  connectingDots: "Koppel…",
  onlineHold: "Aanlyn — hou in om te praat",
  onlineEnable: "Aanlyn — tik om te hoor",
  offlineRetry: "Vanlyn — tik Probeer weer",
  help: "Hou die knoppie in om te praat en los om te stop. Klank word nie gestoor nie.",
  paused: "Groepradio wag — privaat radio is aktief",
};

export function controlRoomRadioCopy(lang: "en" | "af") {
  return lang === "af" ? radioAf : radioEn;
}

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
  const { lang } = useControlRoomLang();
  const r = controlRoomRadioCopy(lang);
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
    ? `${selectedChannel.name}${selectedChannel.isCentral ? ` (${r.central})` : ""}`
    : r.selectChannel;

  const isConnecting = radio.connecting || channelsLoading || (enabled && commandId == null);
  const connectionStatus = radio.transmitting
    ? { label: r.onAir, tone: "live" as const }
    : radio.remoteTalking
      ? { label: r.incoming, tone: "talk" as const }
      : isConnecting
        ? { label: r.connecting, tone: "wait" as const }
        : radio.connected
          ? { label: r.online, tone: "live" as const }
          : { label: r.offline, tone: "bad" as const };

  const statusLine = radio.transmitting
    ? r.youOnAir
    : radio.remoteTalking && !radio.speakerReady
      ? lang === "af"
        ? `${radio.remoteTalking} praat — tik om te hoor`
        : `${radio.remoteTalking} talking — tap Enable speaker`
      : radio.remoteTalking
      ? lang === "af"
        ? `${radio.remoteTalking} praat`
        : `${radio.remoteTalking} talking`
      : busy && radio.floor
        ? lang === "af"
          ? `${radio.floor.displayName} het die beurt`
          : `${radio.floor.displayName} has the floor`
        : isConnecting
          ? r.connectingDots
          : radio.connected
            ? radio.speakerReady
              ? r.onlineHold
              : r.onlineEnable
            : radio.error
              ? radio.error
              : r.offlineRetry;

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
        {r.checking}
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
          {r.radio}
        </div>
        <p className="mt-1 text-xs leading-relaxed">
          {r.notConfigured}
        </p>
      </div>
    );
  }

  if (dock && collapsed) {
    const toneClass =
      connectionStatus.tone === "live"
        ? "border-emerald-500/35 bg-[#0f1a14]"
        : connectionStatus.tone === "talk"
          ? "border-amber-500/40 bg-[#1a160f]"
          : connectionStatus.tone === "wait"
            ? "border-sky-500/35 bg-[#0f161c]"
            : "border-red-500/35 bg-[#1a1111]";

    const detail =
      radio.remoteTalking || radio.transmitting || isConnecting || !radio.connected
        ? statusLine
        : channelLabel;

    return (
      <div
        className={cn(
          "rounded-lg border px-2 py-2 overflow-hidden",
          toneClass,
          className,
        )}
        data-testid="radio-dock"
        data-collapsed="true"
        data-radio-status={connectionStatus.label.toLowerCase()}
      >
        <div className="flex items-center gap-2.5 min-h-14">
          <button
            type="button"
            className="min-w-0 flex-1 flex items-start gap-1.5 text-left rounded-md px-1 py-1 hover:bg-white/[0.04]"
            aria-label={lang === "af" ? `Maak radio oop — ${detail}` : `Expand radio — ${detail}`}
            data-testid="button-radio-expand"
            onClick={() => onCollapsedChange?.(false)}
          >
            <ChevronUp className="h-4 w-4 shrink-0 text-emerald-400/90 mt-0.5" />
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Radio className="h-4 w-4 shrink-0 text-emerald-400" />
                <span className="text-xs font-semibold text-emerald-400 shrink-0">{r.radio}</span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide shrink-0",
                    statusPillClass,
                  )}
                  data-testid="radio-dock-status"
                >
                  {connectionStatus.tone === "wait" ? (
                    <Loader2 className="h-2.5 w-2.5 animate-spin" aria-hidden />
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
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 tabular-nums shrink-0">
                    <Users className="h-3 w-3" />
                    {radio.listenerCount}
                  </span>
                ) : null}
              </div>
              <p
                className="truncate text-[11px] font-medium text-slate-100 leading-tight pl-0.5"
                data-testid="radio-dock-channel"
                title={detail}
              >
                {detail}
              </p>
            </div>
          </button>
          {radio.connected && !radio.speakerReady ? (
            <Button
              type="button"
              size="sm"
              className="h-14 shrink-0 gap-1.5 bg-amber-600 hover:bg-amber-500 text-white px-4 text-base font-bold"
              data-testid="button-radio-enable-speaker"
              onClick={() => void radio.unlockSpeaker()}
            >
              <Volume2 className="h-5 w-5" />
              {r.hear}
            </Button>
          ) : (
            <RadioPttButton
              disabled={!radio.connected || radio.connecting || needsMicAllow}
              transmitting={radio.transmitting}
              busy={busy}
              compact
              label={r.hold}
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
            {dock ? r.radio : r.groupRadio}
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
              aria-label={r.collapse}
              data-testid="button-radio-collapse"
              onClick={() => onCollapsedChange(true)}
            >
              <ChevronDown className="h-4 w-4" />
            </button>
          ) : null}
        </div>
      </div>

      {channelsLoading ? (
        <p className="text-xs text-muted-foreground">{r.loadingChannels}</p>
      ) : channels.length === 0 ? (
        <p className="text-xs text-muted-foreground">{r.noGroups}</p>
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
              <SelectValue placeholder={r.selectChannel} />
            </SelectTrigger>
            <SelectContent>
              {channels.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                  {c.isCentral ? ` (${r.central})` : ""}
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
                {r.allowMic}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="w-full h-9 gap-2"
                data-testid="button-radio-open-mic-settings"
                onClick={() => void openOmtAppDetailsSettings()}
              >
                <Settings className="h-4 w-4" />
                {r.openSettings}
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
                ? lang === "af"
                  ? `Tik om ${radio.remoteTalking} te hoor`
                  : `Tap to hear ${radio.remoteTalking}`
                : r.enableSpeaker}
            </Button>
          ) : null}

          <RadioPttButton
            disabled={!radio.connected || radio.connecting || needsMicAllow}
            transmitting={radio.transmitting}
            busy={busy}
            compact={dock}
            className={dock ? "w-full min-h-11" : undefined}
            label={r.holdToTalk}
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
                {r.retry}
              </Button>
            </div>
          ) : dock ? null : (
            <p className="text-[10px] text-muted-foreground/80">
              {r.help}
            </p>
          )}
        </>
      )}
    </div>
  );
}
