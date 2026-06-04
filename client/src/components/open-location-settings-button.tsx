import { useState } from "react";
import { Settings, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { locationSettingsHint, openLocationSettings } from "@/lib/open-location-settings";

type Props = {
  /** Runs after Settings opens (native) or permission prompt finishes — keep this fast. */
  onAfterOpen?: () => void;
  className?: string;
  testId?: string;
  variant?: "dark" | "light";
};

export function OpenLocationSettingsButton({
  onAfterOpen,
  className = "",
  testId = "button-open-location-settings",
  variant = "dark",
}: Props) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setOpening(true);
    try {
      const result = await openLocationSettings();
      if (result === "opened") {
        toast({
          title: "Location settings",
          description: "Turn on Location for OMT Pulse, then return to this app.",
        });
        onAfterOpen?.();
        return;
      }
      if (result === "prompted") {
        toast({
          title: "Location",
          description: "If you allowed access, your GPS should work now.",
        });
        onAfterOpen?.();
        return;
      }
      toast({
        title: "Turn on location manually",
        description: locationSettingsHint(),
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

  return (
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
  );
}
