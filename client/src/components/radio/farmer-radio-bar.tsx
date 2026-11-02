import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import { RadioPttButton } from "@/components/radio/radio-ptt-button";
import { usePrivateRadioActions } from "@/components/radio/private-radio-host";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { useRadioChannel, useRadioChannels, useRadioStatus } from "@/hooks/use-radio-channel";
import { type FarmerCopy } from "@/lib/farmer-i18n";
import { apiRequest } from "@/lib/queryClient";

type RadioPerson = { id: string; name: string };

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function privateStartMessage(err: unknown, t: FarmerCopy): string {
  const msg = err instanceof Error ? err.message : "";
  if (/already/i.test(msg)) return t.privateBusy;
  return t.privateError;
}

export function FarmerPrivatePeopleSheet({
  people,
  loading,
  error,
  onClose,
  onPick,
}: {
  people: RadioPerson[];
  loading?: boolean;
  error?: string | null;
  onClose: () => void;
  onPick: (person: RadioPerson) => void;
}) {
  const { t } = useFarmerLang();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      data-testid="sheet-farmer-private"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[360px] rounded-[1.6rem] bg-white px-5 py-6 text-zinc-900 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-xl font-bold">{t.privateTitle}</h2>
        <p className="mt-1 text-sm text-zinc-500">{t.privateHint}</p>
        {error ? (
          <p className="mt-3 text-sm text-red-700" data-testid="text-farmer-private-error">{error}</p>
        ) : null}
        <div className="mt-4 max-h-64 space-y-2 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-zinc-500">{t.radioConnecting}</p>
          ) : people.length === 0 ? (
            <p className="text-sm text-zinc-500" data-testid="text-farmer-private-empty">{t.privateEmpty}</p>
          ) : (
            people.map((person) => (
              <button
                key={person.id}
                type="button"
                className="flex h-12 w-full items-center rounded-xl border border-zinc-200 bg-white px-4 text-left text-sm font-semibold text-zinc-900"
                data-testid={`button-private-person-${person.id}`}
                onClick={() => onPick(person)}
              >
                {person.name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export function FarmerPrivateIncoming({
  name,
  onAnswer,
  onDecline,
}: {
  name: string;
  onAnswer: () => void;
  onDecline: () => void;
}) {
  const { t } = useFarmerLang();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      data-testid="card-farmer-private-incoming"
    >
      <div className="w-full max-w-[360px] rounded-[1.6rem] bg-white px-5 py-6 text-zinc-900 shadow-2xl">
        <h2 className="text-xl font-bold" data-testid="text-farmer-private-incoming">
          {t.privateIncoming(firstName(name))}
        </h2>
        <p className="mt-1 text-sm text-zinc-500">{t.privateHint}</p>
        <button
          type="button"
          className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-[#006039] text-sm font-semibold text-white"
          data-testid="button-private-answer"
          onClick={onAnswer}
        >
          {t.privateAnswer}
        </button>
        <button
          type="button"
          className="mt-2 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold text-zinc-700"
          data-testid="button-private-decline"
          onClick={onDecline}
        >
          {t.privateDecline}
        </button>
      </div>
    </div>
  );
}

/** Group radio on the farmer phone. Joins while the app is open. Afrikaans. */
export function FarmerRadioBar() {
  const { t } = useFarmerLang();
  const available = useRadioStatus();
  const { channels } = useRadioChannels(available === true);
  const channel = channels.find((item) => !item.isCentral) ?? channels[0];
  const radio = useRadioChannel(available === true ? channel?.id ?? null : null);
  const alone = usePrivateRadioActions();
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const { data: people = [], isLoading: peopleLoading, isError: peopleError } = useQuery<RadioPerson[]>({
    queryKey: ["/api/radio/people", channel?.id],
    enabled: peopleOpen && !!channel,
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/radio/people?commandId=${channel!.id}`);
      return (await res.json()) as RadioPerson[];
    },
  });

  if (available !== true || !channel) return null;

  const privateCall = alone.call;
  const waiting = !!privateCall && privateCall.role === "caller" && privateCall.status === "ringing";
  const status = privateCall
    ? (waiting ? t.privateWaiting(firstName(privateCall.peerName)) : t.privateWith(firstName(privateCall.peerName)))
    : radio.connecting
      ? t.radioConnecting
      : radio.connected
        ? t.radioOn
        : t.radioConnecting;

  return (
    <div
      className="shrink-0 border-t border-[#006039] bg-[#f4f1ea] px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
      data-testid="farmer-radio-bar"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#006039]" data-testid="text-farmer-radio-status">
            {status}
          </p>
          {!privateCall && (
            <p className="truncate text-xs text-zinc-500">{channel.name}</p>
          )}
        </div>
        {!privateCall && (
          <button
            type="button"
            className="shrink-0 text-sm font-semibold text-[#006039]"
            data-testid="button-farmer-private"
            onClick={() => {
              setStartError(null);
              setPeopleOpen(true);
            }}
          >
            {t.privateTalk}
          </button>
        )}
      </div>
      {privateCall ? (
        <p className="mb-2 text-xs text-zinc-500">{t.privateOnly}</p>
      ) : null}
      {(radio.error && !privateCall) && (
        <p className="mb-2 text-xs text-red-700" data-testid="text-farmer-radio-error">
          {t.radioError}
        </p>
      )}
      {alone.error && privateCall ? (
        <p className="mb-2 text-xs text-red-700">{t.privateError}</p>
      ) : null}
      {privateCall ? (
        <>
          <RadioPttButton
            disabled={waiting || !alone.connected || alone.connecting}
            transmitting={alone.transmitting}
            busy={alone.busy}
            label={t.radioHold}
            openingLabel={t.radioOpening}
            onAirLabel={t.radioTalking}
            busyLabel={t.radioBusy}
            onPressStart={() => {
              void alone.unlockSpeaker();
              void alone.startTransmit();
            }}
            onPressEnd={() => void alone.stopTransmit()}
            className="bg-[#006039] text-white"
          />
          <button
            type="button"
            className="mt-2 flex h-11 w-full items-center justify-center rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800"
            data-testid="button-private-done"
            onClick={() => void alone.endCall()}
          >
            {t.privateDone}
          </button>
        </>
      ) : (
        <>
          <RadioPttButton
            disabled={!radio.connected || radio.connecting}
            transmitting={radio.transmitting}
            busy={!!radio.floor && !radio.floor.isMe}
            label={t.radioHold}
            openingLabel={t.radioOpening}
            onAirLabel={t.radioTalking}
            busyLabel={t.radioBusy}
            onPressStart={() => void radio.startTransmit()}
            onPressEnd={() => void radio.stopTransmit()}
            className="bg-[#006039] text-white"
          />
        </>
      )}
      {peopleOpen && !privateCall && (
        <FarmerPrivatePeopleSheet
          people={people}
          loading={peopleLoading}
          error={startError ?? (peopleError ? t.privateError : null)}
          onClose={() => setPeopleOpen(false)}
          onPick={(person) => {
            setStartError(null);
            void alone.startCall(person.id).then(() => {
              setPeopleOpen(false);
            }).catch((err) => {
              setStartError(privateStartMessage(err, t));
            });
          }}
        />
      )}
      {alone.incoming && (
        <FarmerPrivateIncoming
          name={alone.incoming.peerName}
          onAnswer={() => void alone.acceptCall(alone.incoming!.id)}
          onDecline={() => void alone.declineCall(alone.incoming!.id)}
        />
      )}
    </div>
  );
}

/** Preview stand-in. The live bar needs a signed-in radio channel. */
export function FarmerRadioPreview() {
  const { t } = useFarmerLang();
  const params = new URLSearchParams(window.location.search);
  const [open, setOpen] = useState(params.get("people") === "1");
  const [peer, setPeer] = useState<string | null>(params.get("alone"));
  const [ringing, setRinging] = useState(params.get("ring") === "1");
  const sample: RadioPerson[] = [{ id: "martin", name: "Martin Engels" }];

  return (
    <div className="shrink-0 border-t border-[#006039] bg-[#f4f1ea] px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#006039]">
            {peer ? t.privateWith(firstName(peer)) : t.radioOn}
          </p>
          {!peer && <p className="truncate text-xs text-zinc-500">Boere Burgersdorp</p>}
        </div>
        {!peer && (
          <button
            type="button"
            className="shrink-0 text-sm font-semibold text-[#006039]"
            data-testid="button-farmer-private"
            onClick={() => setOpen(true)}
          >
            {t.privateTalk}
          </button>
        )}
      </div>
      {peer ? <p className="mb-2 text-xs text-zinc-500">{t.privateOnly}</p> : null}
      {peer ? (
        <>
          <div className="flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#006039] px-6 py-5 text-base font-bold text-white">
            <Radio className="h-7 w-7" />
            <span>{t.radioHold}</span>
          </div>
          <button
            type="button"
            className="mt-2 flex h-11 w-full items-center justify-center rounded-xl border border-zinc-300 bg-white text-sm font-semibold text-zinc-800"
            data-testid="button-private-done"
            onClick={() => setPeer(null)}
          >
            {t.privateDone}
          </button>
        </>
      ) : (
        <>
          <div className="flex min-h-[5.5rem] w-full flex-col items-center justify-center gap-1.5 rounded-2xl bg-[#006039] px-6 py-5 text-base font-bold text-white">
            <Radio className="h-7 w-7" />
            <span>{t.radioHold}</span>
          </div>
        </>
      )}
      {open && !peer && (
        <FarmerPrivatePeopleSheet
          people={sample}
          onClose={() => setOpen(false)}
          onPick={(person) => {
            setPeer(person.name);
            setOpen(false);
          }}
        />
      )}
      {ringing && !peer && (
        <FarmerPrivateIncoming
          name="Martin Engels"
          onAnswer={() => {
            setRinging(false);
            setPeer("Martin Engels");
          }}
          onDecline={() => setRinging(false)}
        />
      )}
    </div>
  );
}
