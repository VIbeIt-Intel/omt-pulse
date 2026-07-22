import { useCallback, useRef } from "react";
import { Radio } from "lucide-react";
import { cn } from "@/lib/utils";

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
  const activeRef = useRef(false);

  const end = useCallback(() => {
    if (!activeRef.current) return;
    activeRef.current = false;
    onPressEnd();
  }, [onPressEnd]);

  const start = useCallback(() => {
    if (disabled || busy || activeRef.current) return;
    activeRef.current = true;
    onPressStart();
  }, [busy, disabled, onPressStart]);

  return (
    <button
      type="button"
      disabled={disabled}
      data-testid="button-radio-ptt"
      aria-pressed={transmitting}
      className={cn(
        "select-none touch-none rounded-2xl px-6 py-5 font-bold text-base transition-colors",
        "flex flex-col items-center justify-center gap-1.5 min-h-[5.5rem] w-full",
        transmitting
          ? "bg-emerald-500 text-white shadow-lg shadow-emerald-900/40 scale-[0.99]"
          : busy
            ? "bg-amber-600/80 text-white cursor-not-allowed"
            : disabled
              ? "bg-muted text-muted-foreground cursor-not-allowed"
              : "bg-slate-800 text-slate-100 hover:bg-slate-700 border border-emerald-500/40",
        className,
      )}
      onPointerDown={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
        start();
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onPointerLeave={() => {
        if (activeRef.current) end();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Radio className={cn("h-7 w-7", transmitting && "animate-pulse")} />
      <span>
        {transmitting ? "Transmitting…" : busy ? "Channel busy" : label}
      </span>
    </button>
  );
}
