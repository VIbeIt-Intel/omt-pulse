import { useCallback } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Toggle PTT: first tap locks the floor / goes on air; second tap releases.
 */
export function RadioPttButton({
  disabled,
  transmitting,
  busy,
  onPressStart,
  onPressEnd,
  className,
  label = "Tap to talk",
}: {
  disabled?: boolean;
  transmitting: boolean;
  busy?: boolean;
  onPressStart: () => void;
  onPressEnd: () => void;
  className?: string;
  label?: string;
}) {
  const toggle = useCallback(() => {
    if (disabled) return;
    if (transmitting) {
      onPressEnd();
      return;
    }
    if (busy) return;
    onPressStart();
  }, [busy, disabled, onPressEnd, onPressStart, transmitting]);

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
      onClick={(e) => {
        e.preventDefault();
        toggle();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Radio className={cn("h-7 w-7", transmitting && "animate-pulse")} />
      <span>
        {transmitting
          ? "On air — tap to stop"
          : busy
            ? "Channel busy"
            : label}
      </span>
    </button>
  );
}
