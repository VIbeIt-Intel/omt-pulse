import { BellOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useFarmerLang } from "@/hooks/use-farmer-lang";
import { isFarmerQuiet, readQuietUntil, setFarmerQuiet } from "@/lib/farmer-quiet";

function quietLabel(until: number, locale: string, untilText: (time: string) => string, hold: string): string {
  if (until < 0) return hold;
  if (until > Date.now()) {
    const time = new Date(until).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
    return untilText(time);
  }
  return "";
}

export function FarmerQuietButton() {
  const { t, lang } = useFarmerLang();
  const [until, setUntil] = useState(readQuietUntil);
  const [open, setOpen] = useState(false);
  const quiet = until < 0 || until > Date.now();

  useEffect(() => {
    const sync = () => setUntil(readQuietUntil());
    window.addEventListener("omt-quiet", sync);
    const timer = window.setInterval(sync, 15000);
    return () => {
      window.removeEventListener("omt-quiet", sync);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    if (new URLSearchParams(window.location.search).get("quiet") !== "1") return;
    if (isFarmerQuiet()) return;
    void setFarmerQuiet(Date.now() + 60 * 60 * 1000);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          quiet
            ? "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-[#006039] px-3 text-xs font-semibold text-white"
            : "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-zinc-300 bg-white px-3 text-xs font-semibold text-zinc-800"
        }
        data-testid="button-farmer-quiet"
      >
        <BellOff className="h-3.5 w-3.5" />
        {quiet ? quietLabel(until, lang === "af" ? "af-ZA" : "en-ZA", t.quietUntil, t.quietHold) : t.quiet}
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
          data-testid="sheet-farmer-quiet"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[360px] rounded-[1.6rem] bg-white px-5 py-6 text-zinc-900 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#006039]/10 text-[#006039]">
              <BellOff className="h-5 w-5" />
            </span>
            <h2 className="mt-3 text-xl font-bold">{t.quietTitle}</h2>
            <p className="mt-1 text-sm text-zinc-500">{t.quietPanic}</p>
            {quiet ? (
              <button
                type="button"
                className="mt-5 flex h-12 w-full items-center justify-center rounded-xl bg-[#006039] text-sm font-semibold text-white"
                data-testid="button-quiet-off"
                onClick={() => {
                  void setFarmerQuiet(0);
                  setOpen(false);
                }}
              >
                {t.quietDone}
              </button>
            ) : (
              <div className="mt-5 space-y-2">
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold"
                  data-testid="button-quiet-hour"
                  onClick={() => {
                    void setFarmerQuiet(Date.now() + 60 * 60 * 1000);
                    setOpen(false);
                  }}
                >
                  {t.quietHour}
                </button>
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold"
                  data-testid="button-quiet-two-hours"
                  onClick={() => {
                    void setFarmerQuiet(Date.now() + 2 * 60 * 60 * 1000);
                    setOpen(false);
                  }}
                >
                  {t.quietTwoHours}
                </button>
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center rounded-xl border border-zinc-200 text-sm font-semibold"
                  data-testid="button-quiet-three-hours"
                  onClick={() => {
                    void setFarmerQuiet(Date.now() + 3 * 60 * 60 * 1000);
                    setOpen(false);
                  }}
                >
                  {t.quietThreeHours}
                </button>
                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center rounded-xl bg-[#006039] text-sm font-semibold text-white"
                  data-testid="button-quiet-hold"
                  onClick={() => {
                    void setFarmerQuiet(-1);
                    setOpen(false);
                  }}
                >
                  {t.quietUntilOff}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
