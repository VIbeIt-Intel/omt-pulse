import { useState } from "react";
import { Settings, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  locationSettingsHint,
  openLocationSettings,
} from "@/lib/open-location-settings";

type Props = {
  onAfterOpen?: () => void;
  className?: string;
  testId?: string;
  variant?: "dark" | "light";
  /** Show status text under the button (required on panic overlay — toasts are behind z-300). */
  showInlineStatus?: boolean;
};

export function OpenLocationSettingsButton({
  onAfterOpen,
  className = "",
  testId = "button-open-location-settings",
  variant = "dark",
  showInlineStatus = true,
}: Props) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpening(true);
    setStatus(null);
    try {
      const { result, message } = await openLocationSettings();
      setStatus(message);

      if (showInlineStatus) {
        if (result === "opened" || result === "prompted") {
          onAfterOpen?.();
        }
        return;
      }

      if (result === "opened") {
        toast({
          title: "Location settings",
          description: message,
        });
        onAfterOpen?.();
        return;
      }
      if (result === "prompted") {
        toast({ title: "Location", description: message });
        onAfterOpen?.();
        return;
      }
      toast({
        title: "Turn on location manually",
        description: message || locationSettingsHint(),
        variant: "destructive",
      });
    } finally {
      setOpening(false);
    }
  }

  const styles =
    variant === "dark"
      ? "w-full h-12 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm disabled:opacity-60"
      : "w-full h-11 rounded-lg border border-amber-500/60 bg-amber-500/10 hover:bg-amber-500/20 text-amber-950 dark:text-amber-100 font-semibold text-sm disabled:opacity-60";

  const statusClass =
    variant === "dark"
      ? "text-xs text-blue-100/90 text-left leading-relaxed rounded-xl bg-blue-950/40 border border-blue-500/30 px-3 py-2"
      : "text-xs text-amber-900 dark:text-amber-100 text-left leading-relaxed rounded-lg bg-amber-500/15 border border-amber-500/40 px-3 py-2";

  return (
    <div className="w-full space-y-2">
      <button
        type="button"
        onClick={(e) => void handleClick(e)}
        disabled={opening}
        className={`inline-flex items-center justify-center gap-2 transition-colors touch-manipulation ${styles} ${className}`}
        data-testid={testId}
      >
        {opening ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
        ) : (
          <Settings className="h-4 w-4 shrink-0" />
        )}
        {opening ? "Opening settings…" : "Open location settings"}
      </button>
      {showInlineStatus && status ? (
        <p className={statusClass} role="status" data-testid={`${testId}-status`}>
          {status}
        </p>
      ) : null}
    </div>
  );
}
