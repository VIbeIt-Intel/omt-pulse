import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Flame, Loader2, MapPin, Radio, ShieldAlert, Siren } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "wouter";
import { useFarmerLang } from "@/hooks/use-farmer-lang";

export type JoinPromptDetails = {
  id: number;
  isPanic: boolean;
  initiatorName: string;
  categoryName?: string | null;
  severityLabel?: string | null;
  destinationName?: string | null;
};

type Props = {
  open: boolean;
  details: JoinPromptDetails | null;
  submitting?: boolean;
  /** Farmer phone: panic join sits in the middle, in the farmer's language. */
  farmer?: boolean;
  onConfirm: () => void;
  onDecline: () => void;
};

function FarmerPanicJoinCard({
  name,
  submitting,
  onConfirm,
  onDecline,
}: {
  name: string;
  submitting: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { t, toggle } = useFarmerLang();
  return (
    <div className="w-full max-w-[340px] rounded-[1.6rem] bg-white px-5 py-6 text-center text-zinc-900 shadow-2xl" data-testid="card-farmer-panic-join">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={toggle}
          className="h-8 rounded-full border border-zinc-200 px-3 text-xs font-semibold"
          data-testid="button-farmer-join-lang"
        >
          {t.langLabel}
        </button>
      </div>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-600/15 text-red-700">
        <Siren className="h-6 w-6" />
      </span>
      <h1 className="mt-3 text-xl font-bold tracking-tight">{t.joinPanicAsk}</h1>
      <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-zinc-600">
        <span className="font-semibold text-zinc-900">{name}</span> {t.joinPanicNeeds}
      </p>
      <p className="mx-auto mt-3 max-w-[300px] text-xs leading-relaxed text-zinc-500">{t.joinPanicHint}</p>
      <button
        type="button"
        disabled={submitting}
        onClick={onConfirm}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-red-700 text-sm font-semibold text-white disabled:opacity-60"
        data-testid="button-join-prompt-confirm"
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Siren className="h-5 w-5" />}
        {t.joinPanicYes}
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={onDecline}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-medium disabled:opacity-60"
        data-testid="button-join-prompt-decline"
      >
        {t.joinPanicNo}
      </button>
    </div>
  );
}

function isCrimeJoin(name?: string | null): boolean {
  const n = (name ?? "").trim().toLowerCase();
  return n === "veediefstal"
    || n === "vee en wildediere"
    || n === "inbraak"
    || n === "verdagte voertuig"
    || n === "verdagte persoon"
    || n === "ander misdaad";
}

function FarmerCrimeJoinCard({
  name,
  submitting,
  onConfirm,
  onDecline,
}: {
  name: string;
  submitting: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { t, toggle } = useFarmerLang();
  return (
    <div className="w-full max-w-[340px] rounded-[1.6rem] bg-white px-5 py-6 text-center text-zinc-900 shadow-2xl" data-testid="card-farmer-crime-join">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={toggle}
          className="h-8 rounded-full border border-zinc-200 px-3 text-xs font-semibold"
          data-testid="button-farmer-join-lang"
        >
          {t.langLabel}
        </button>
      </div>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/15 text-orange-700">
        <ShieldAlert className="h-6 w-6" />
      </span>
      <h1 className="mt-3 text-xl font-bold tracking-tight">{t.joinCrimeAsk}</h1>
      <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-zinc-600">
        <span className="font-semibold text-zinc-900">{name}</span> {t.joinCrimeNeeds}
      </p>
      <p className="mx-auto mt-3 max-w-[300px] text-xs leading-relaxed text-zinc-500">{t.joinCrimeHint}</p>
      <button
        type="button"
        disabled={submitting}
        onClick={onConfirm}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:opacity-60"
        data-testid="button-join-prompt-confirm"
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldAlert className="h-5 w-5" />}
        {t.joinCrimeYes}
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={onDecline}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-medium disabled:opacity-60"
        data-testid="button-join-prompt-decline"
      >
        {t.joinCrimeNo}
      </button>
    </div>
  );
}

function FarmerFireJoinCard({
  name,
  submitting,
  onConfirm,
  onDecline,
}: {
  name: string;
  submitting: boolean;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  const { t, toggle } = useFarmerLang();
  return (
    <div className="w-full max-w-[340px] rounded-[1.6rem] bg-white px-5 py-6 text-center text-zinc-900 shadow-2xl" data-testid="card-farmer-fire-join">
      <div className="mb-1 flex justify-end">
        <button
          type="button"
          onClick={toggle}
          className="h-8 rounded-full border border-zinc-200 px-3 text-xs font-semibold"
          data-testid="button-farmer-join-lang"
        >
          {t.langLabel}
        </button>
      </div>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/15 text-orange-700">
        <Flame className="h-6 w-6" />
      </span>
      <h1 className="mt-3 text-xl font-bold tracking-tight">{t.joinFireAsk}</h1>
      <p className="mx-auto mt-2 max-w-[300px] text-sm leading-relaxed text-zinc-600">
        <span className="font-semibold text-zinc-900">{name}</span> {t.joinFireNeeds}
      </p>
      <p className="mx-auto mt-3 max-w-[300px] text-xs leading-relaxed text-zinc-500">{t.joinFireHint}</p>
      <button
        type="button"
        disabled={submitting}
        onClick={onConfirm}
        className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 text-sm font-semibold text-white disabled:opacity-60"
        data-testid="button-join-prompt-confirm"
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Flame className="h-5 w-5" />}
        {t.joinFireYes}
      </button>
      <button
        type="button"
        disabled={submitting}
        onClick={onDecline}
        className="mt-2 flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-medium disabled:opacity-60"
        data-testid="button-join-prompt-decline"
      >
        {t.joinFireNo}
      </button>
    </div>
  );
}

export function LiveIncidentJoinPromptSheet({
  open,
  details,
  submitting = false,
  farmer = false,
  onConfirm,
  onDecline,
}: Props) {
  const isPanic = details?.isPanic ?? false;

  if (farmer && (isPanic || details)) {
    if (!open || !details) return null;
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-5"
        data-testid="sheet-join-prompt"
        onClick={() => { if (!submitting) onDecline(); }}
      >
        <div onClick={(e) => e.stopPropagation()}>
          {isPanic ? (
            <FarmerPanicJoinCard
              name={details.initiatorName}
              submitting={submitting}
              onConfirm={onConfirm}
              onDecline={onDecline}
            />
          ) : isCrimeJoin(details.categoryName) || isCrimeJoin(details.destinationName) ? (
            <FarmerCrimeJoinCard
              name={details.initiatorName}
              submitting={submitting}
              onConfirm={onConfirm}
              onDecline={onDecline}
            />
          ) : (
            <FarmerFireJoinCard
              name={details.initiatorName}
              submitting={submitting}
              onConfirm={onConfirm}
              onDecline={onDecline}
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <Sheet open={open} onOpenChange={(o) => { if (!o && !submitting) onDecline(); }}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-6 max-h-[min(92vh,640px)]"
        data-testid="sheet-join-prompt"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="mx-auto mb-3 h-1 w-12 rounded-full bg-muted-foreground/25" aria-hidden />

        {details ? (
          <div className="space-y-5 max-w-md mx-auto">
            <SheetHeader className="text-center space-y-2 items-center p-0">
              <span
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-full",
                  isPanic ? "bg-red-600/15 text-red-700 dark:text-red-300" : "bg-primary/10 text-primary",
                )}
              >
                {isPanic ? <Siren className="h-6 w-6" /> : <Radio className="h-6 w-6" />}
              </span>
              <SheetTitle className="text-xl font-bold tracking-tight">
                {isPanic ? "Respond to panic?" : "Join live incident?"}
              </SheetTitle>
              <SheetDescription className="text-sm leading-relaxed text-muted-foreground max-w-[320px]">
                {isPanic ? (
                  <>
                    <span className="font-semibold text-foreground">{details.initiatorName}</span> needs immediate
                    help. Their location is being shared live.
                  </>
                ) : (
                  <>
                    <span className="font-semibold text-foreground">{details.initiatorName}</span> started incident
                    #{details.id}
                    {details.categoryName ? ` · ${details.categoryName}` : ""}
                    {details.severityLabel ? ` · ${details.severityLabel}` : ""}.
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            {!isPanic && details.destinationName ? (
              <div
                className="rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-3 flex items-start gap-2.5"
                data-testid="join-prompt-destination"
              >
                <MapPin className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-primary">Heading to</p>
                  <p className="text-sm font-medium text-foreground leading-snug">{details.destinationName}</p>
                </div>
              </div>
            ) : null}

            <p className="text-xs text-center text-muted-foreground px-2">
              {isPanic
                ? "If you respond, GPS is shared with dispatch and turn-by-turn navigation to the panicker starts."
                : "If you join, your GPS will be shared with dispatch for this response."}
            </p>

            <div className="space-y-2.5 pt-1">
              <Button
                size="lg"
                className={cn(
                  "w-full font-semibold",
                  isPanic && "bg-red-700 hover:bg-red-800 text-white",
                )}
                disabled={submitting}
                onClick={onConfirm}
                data-testid="button-join-prompt-confirm"
              >
                {submitting ? (
                  <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                ) : isPanic ? (
                  <Siren className="h-5 w-5 mr-2" />
                ) : (
                  <Radio className="h-5 w-5 mr-2" />
                )}
                {isPanic ? "Respond now" : "Join response"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="lg"
                className="w-full"
                disabled={submitting}
                onClick={onDecline}
                data-testid="button-join-prompt-decline"
              >
                Not now
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Local look at the card a neighbour gets after tapping a paniek notification. */
export function PanicJoinPreview() {
  const [, navigate] = useLocation();
  return (
    <div className="flex h-full items-center justify-center bg-zinc-950 p-5" data-testid="preview-panic-join">
      <FarmerPanicJoinCard
        name="Anna Venter"
        submitting={false}
        onConfirm={() => navigate("/preview/farmer/paniek?going=1")}
        onDecline={() => {}}
      />
    </div>
  );
}

/** Local look at the map after Reageer nou. */
export function PanicGoingPreview() {
  const { t, toggle } = useFarmerLang();
  return (
    <div className="flex h-full flex-col bg-[#101410] text-white" data-testid="preview-panic-going">
      <header className="flex items-center gap-2 px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-tight">{t.joinGoing}</p>
          <p className="truncate text-[11px] text-white/60">{t.joinGoingTo} Anna Venter</p>
        </div>
        <button
          type="button"
          onClick={toggle}
          className="h-8 shrink-0 rounded-full border border-white/15 px-3 text-xs font-semibold"
        >
          {t.langLabel}
        </button>
        <span className="shrink-0 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold">{t.joinGoingBadge}</span>
      </header>
      <div className="relative min-h-0 flex-1 bg-[#1a3326]">
        <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 460" aria-hidden>
          <path d="M70 90 C 110 160, 90 220, 150 250 S 210 340, 230 390" fill="none" stroke="#8fd9b0" strokeWidth="4" strokeLinecap="round" />
        </svg>
        <span className="absolute left-[18%] top-[16%] h-3.5 w-3.5 rounded-full bg-blue-500 ring-4 ring-blue-500/30" />
        <span className="absolute bottom-[12%] right-[16%] flex flex-col items-center">
          <span className="rounded-full bg-red-600 px-2 py-1 text-[10px] font-bold">Anna Venter</span>
          <span className="mt-1 h-3 w-3 rotate-45 bg-red-600" />
        </span>
      </div>
      <div className="px-4 py-4">
        <p className="text-lg font-semibold">12 km · {t.panicAbout} 20 min</p>
        <p className="mt-1 text-sm text-white/70">{t.joinGoingShare}</p>
      </div>
    </div>
  );
}
