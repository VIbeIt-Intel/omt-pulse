import { useEffect, useState } from "react";
import { Loader2, Radio, Users } from "lucide-react";
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
import { cn } from "@/lib/utils";

export function RadioPanel({
  className,
  compact = false,
  defaultCommandId,
}: {
  className?: string;
  compact?: boolean;
  /** Prefer this group when present in the channel list. */
  defaultCommandId?: number | null;
}) {
  const available = useRadioStatus();
  const enabled = available === true;
  const { channels, loading: channelsLoading } = useRadioChannels(enabled);
  const [commandId, setCommandId] = useState<number | null>(null);

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
  const statusLine = radio.transmitting
    ? "You are on air"
    : radio.remoteTalking
      ? `${radio.remoteTalking} talking`
      : busy && radio.floor
        ? `${radio.floor.displayName} has the floor`
        : radio.connected
          ? "Listening — hold to talk"
          : radio.connecting
            ? "Connecting…"
            : "Offline";

  if (available === null) {
    return (
      <div className={cn("rounded-xl border border-border/60 bg-card/40 px-4 py-3 text-sm text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
        Checking radio…
      </div>
    );
  }

  if (!available) {
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
          Live radio is not configured on this server yet. Ask an admin to set LiveKit keys —
          audio is never stored.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-emerald-500/30 bg-emerald-950/20",
        compact ? "p-3 space-y-2.5" : "p-4 space-y-3",
        className,
      )}
      data-testid="radio-panel"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-400">
            <Radio className="h-4 w-4 shrink-0" />
            Group radio
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
            <SelectTrigger className="h-9 bg-background/50" data-testid="select-radio-channel">
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

          <RadioPttButton
            disabled={!radio.connected || radio.connecting}
            transmitting={radio.transmitting}
            busy={busy}
            onPressStart={() => void radio.startTransmit()}
            onPressEnd={() => void radio.stopTransmit()}
          />

          {radio.error ? (
            <p className="text-xs text-amber-400" data-testid="text-radio-error">
              {radio.error}
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground/80">
              Live audio only — nothing is recorded or saved on the server.
            </p>
          )}
        </>
      )}
    </div>
  );
}
