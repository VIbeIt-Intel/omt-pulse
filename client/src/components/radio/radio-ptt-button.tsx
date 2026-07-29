import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Hold-to-talk PTT: transmit only while the pointer/finger is held down; release to stop.
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
  const pointerIdRef = useRef<number | null>(null);
  const onPressStartRef = useRef(onPressStart);
  const onPressEndRef = useRef(onPressEnd);
  onPressStartRef.current = onPressStart;
  onPressEndRef.current = onPressEnd;

  // Immediate visual feedback while floor/mic setup is still running.
  const [pressed, setPressed] = useState(false);

  const endHold = useCallback(() => {
    if (!holdingRef.current) return;
    holdingRef.current = false;
    pointerIdRef.current = null;
    setPressed(false);
    onPressEndRef.current();
  }, []);

  const beginHold = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (disabled || busy || holdingRef.current) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.preventDefault();
      holdingRef.current = true;
      pointerIdRef.current = e.pointerId;
      setPressed(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      onPressStartRef.current();
    },
    [busy, disabled],
  );

  const endHoldFromPointer = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) return;
      endHold();
    },
    [endHold],
  );

  useEffect(() => {
    const onBlur = () => endHold();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") endHold();
    };
    const onWindowPointerUp = (e: PointerEvent) => {
      if (!holdingRef.current) return;
      if (pointerIdRef.current != null && e.pointerId !== pointerIdRef.current) return;
      endHold();
    };
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    // Safety net if the button misses pointerup (scroll / capture quirks).
    window.addEventListener("pointerup", onWindowPointerUp);
    window.addEventListener("pointercancel", onWindowPointerUp);
    return () => {
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerup", onWindowPointerUp);
      window.removeEventListener("pointercancel", onWindowPointerUp);
      if (holdingRef.current) {
        holdingRef.current = false;
        pointerIdRef.current = null;
        onPressEndRef.current();
      }
    };
  }, [endHold]);

  const active = transmitting || pressed;

  return (
    <button
      type="button"
      disabled={disabled || (busy && !transmitting)}
      data-testid="button-radio-ptt"
      aria-pressed={active}
      className={cn(
        "select-none touch-manipulation rounded-2xl px-6 py-5 font-bold text-base transition-colors",
        "flex flex-col items-center justify-center gap-1.5 min-h-[5.5rem] w-full",
        "[-webkit-user-select:none] [-webkit-touch-callout:none]",
        active
          ? "bg-emerald-500 text-white shadow-lg shadow-emerald-900/40"
          : busy
            ? "bg-amber-600/80 text-white cursor-not-allowed"
            : disabled
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-emerald-500/40",
        className,
      )}
      onPointerDown={beginHold}
      onPointerUp={endHoldFromPointer}
      onPointerCancel={endHoldFromPointer}
      // Do NOT end on lostpointercapture — it often fires right after setPointerCapture
      // and was aborting hold-to-talk before the mic could open.
      onContextMenu={(e) => e.preventDefault()}
      onClick={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        if (e.repeat) return;
        e.preventDefault();
        if (disabled || busy || holdingRef.current) return;
        holdingRef.current = true;
        setPressed(true);
        onPressStartRef.current();
      }}
      onKeyUp={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        endHold();
      }}
    >
      <Radio className={cn("h-7 w-7", active && "animate-pulse")} />
      <span>
        {transmitting
          ? "On air — release to stop"
          : pressed
            ? "Opening mic…"
            : busy
              ? "Channel busy"
              : label}
      </span>
    </button>
  );
}
