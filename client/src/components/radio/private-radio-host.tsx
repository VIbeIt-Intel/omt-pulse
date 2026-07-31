import { createContext, useContext, useMemo, type ReactNode } from "react";
import { MessageSquare, PhoneOff, Volume2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioPttButton } from "@/components/radio/radio-ptt-button";
import { usePrivateRadio } from "@/hooks/use-private-radio";
import { cn } from "@/lib/utils";

type PrivateRadioApi = {
  startCall: (peerUserId: string, incidentId?: number | null) => Promise<void>;
  callActive: boolean;
};

const PrivateRadioCtx = createContext<PrivateRadioApi | null>(null);

export function usePrivateRadioActions(): PrivateRadioApi {
  const ctx = useContext(PrivateRadioCtx);
  if (!ctx) {
    return {
      startCall: async () => {
        throw new Error("Private radio is not mounted");
      },
      callActive: false,
    };
  }
  return ctx;
}

export function PrivateRadioHost({ children }: { children?: ReactNode }) {
  const radio = usePrivateRadio();

  const api = useMemo<PrivateRadioApi>(
    () => ({
      startCall: radio.startCall,
      callActive: !!radio.call,
    }),
    [radio.startCall, radio.call],
  );

  const showOverlay = !!radio.call;

  const statusText = radio.connecting
    ? "Connecting private channel…"
    : radio.call?.role === "caller" && radio.call.status === "ringing"
      ? "Opening private channel to field unit…"
      : radio.transmitting
        ? "You are on air — release to stop"
        : radio.remoteTalking
          ? `${radio.remoteTalking} talking`
          : radio.connected
            ? radio.speakerReady
              ? "Live — hold to talk (private)"
              : "Live — tap Enable speaker to hear"
            : "Private channel";

  return (
    <PrivateRadioCtx.Provider value={api}>
      {children}

      {showOverlay ? (
        <div
          className="fixed inset-x-0 bottom-0 z-[75] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
          data-testid="private-radio-overlay"
        >
          <div
            className={cn(
              "pointer-events-auto mx-auto max-w-lg rounded-xl border shadow-2xl shadow-black/40 px-3 py-3 space-y-2",
              "border-violet-500/40 bg-[#12101a]/97 backdrop-blur-sm",
            )}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-violet-300">
                  Private radio · forced open
                </p>
                <p className="text-sm font-semibold text-slate-100 truncate">
                  {radio.call!.peerName}
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{statusText}</p>
              </div>
              <button
                type="button"
                className="rounded-md p-1.5 text-slate-400 hover:bg-white/5 hover:text-slate-200"
                aria-label="End private radio"
                data-testid="button-private-radio-end"
                onClick={() => void radio.endCall()}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {radio.error ? (
              <p className="text-xs text-amber-300" data-testid="text-private-radio-error">
                {radio.error}
              </p>
            ) : null}

            {radio.connected && !radio.speakerReady ? (
              <Button
                type="button"
                className="w-full h-10 gap-2 bg-amber-600 hover:bg-amber-500 text-white"
                data-testid="button-private-radio-speaker"
                onClick={() => void radio.unlockSpeaker()}
              >
                <Volume2 className="h-4 w-4" />
                Enable speaker
              </Button>
            ) : null}

            <RadioPttButton
              disabled={!radio.connected || radio.connecting || radio.micPermission === "denied"}
              transmitting={radio.transmitting}
              busy={radio.busy}
              label="Hold to talk (private)"
              className="min-h-[3.5rem] py-2 rounded-xl"
              onPressStart={() => {
                void radio.unlockSpeaker();
                void radio.startTransmit();
              }}
              onPressEnd={() => void radio.stopTransmit()}
            />

            <div className="flex gap-2">
              <Button
                type="button"
                variant="destructive"
                className="flex-1 h-9 gap-1.5"
                data-testid="button-private-radio-hangup"
                onClick={() => void radio.endCall()}
              >
                <PhoneOff className="h-3.5 w-3.5" />
                End private
              </Button>
            </div>
            <p className="text-[10px] text-slate-500 text-center">
              Auto-connected for ops. Only you and {radio.call!.peerName.split(" ")[0]} hear this.
            </p>
          </div>
        </div>
      ) : null}
    </PrivateRadioCtx.Provider>
  );
}

export function PrivateRadioMessageHint() {
  return (
    <span className="inline-flex items-center gap-1">
      <MessageSquare className="h-3 w-3" />
      Message
    </span>
  );
}
