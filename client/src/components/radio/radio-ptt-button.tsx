import { useCallback, useEffect, useRef } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hold-to-talk PTT: transmit while the pointer is held down; release to stop.
 */
export function RadioPttButton({
  disabled,
  transmitting,
  busy,
  onPressStart,
  onPressEnd,
  className,
  label = "Hold to talk",
}: {
  disabled?: boolean;
  transmitting: boolean;
  busy?: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
  className?: string;
  label?: string;
}) {
  const holdingRef = useRef(false);

  const endHold = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    onPressEnd();
  }, [onPressEnd]);

  const beginHold = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || busy || holdingRef.current) return;
      if (e.button !== 0) return;
      e.preventDefault();
      holdingRef.current = true;
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onPressStart();
    },
    [busy, disabled, onPressStart],
  );

  useEffect(() => {
    const onBlur = () => endHold();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") endHold();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (holdingRef.current) {
        holdingRef.current = false;
        onPressEnd();
      }
    };
  }, [endHold, onPressEnd]);

  return (
    <button
      type="button"
      disabled={disabled || (busy && !transmitting)}
      data-testid="button-radio-ptt"
      aria-pressed={transmitting}
      className={cn(
        "select-none touch-manipulation rounded-2xl px-6 py-5 font-bold text-base transition-colors",
        "flex flex-col items-center justify-center gap-1.5 min-h-[5.5rem] w-full",
        transmitting
          ? "bg-emerald-500 text-white shadow-lg shadow-emerald-900/40"
          : busy
            ? "bg-amber-600/80 text-white cursor-not-allowed"
            : disabled
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-emerald-500/40",
        className,
      )}
      onPointerDown={beginHold}
      onPointerUp={endHold}
      onPointerCancel={endHold}
      onLostPointerCapture={endHold}
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
    >
      <Radio className={cn("h-7 w-7", transmitting && "animate-pulse")} />
      <span>
        {transmitting
          ? "On air — release to stop"
          : busy
            ? "Channel busy"
            : label}
      </span>
    </button>
  );
}
