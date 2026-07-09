import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Delete, Loader2 } from "lucide-react";

type ShiftPinScreenProps = {
  workstationName: string;
  locationName?: string | null;
  onSubmit: (pin: string) => Promise<void>;
  onUnenrol?: () => void;
  error?: string | null;
};

export function ShiftPinScreen({
  workstationName,
  locationName,
  onSubmit,
  onUnenrol,
  error,
}: ShiftPinScreenProps) {
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(nextPin: string) {
    if (nextPin.length < 4) return;
    setLoading(true);
    try {
      await onSubmit(nextPin);
      setPin("");
    } finally {
      setLoading(false);
    }
  }

  function press(digit: string) {
    if (loading || pin.length >= 6) return;
    setPin((p) => p + digit);
  }

  function backspace() {
    setPin((p) => p.slice(0, -1));
  }

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Shift sign-in</p>
          <h1 className="text-2xl font-semibold mt-1">{workstationName}</h1>
          {locationName && (
            <p className="text-sm text-muted-foreground mt-1">{locationName}</p>
          )}
        </div>

        <div className="flex justify-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-3 w-3 rounded-full border",
                i < pin.length ? "bg-primary border-primary" : "border-muted-foreground/40",
              )}
            />
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid grid-cols-3 gap-3">
          {keys.map((key, idx) => {
            if (key === "") return <div key={idx} />;
            if (key === "del") {
              return (
                <Button
                  key={key}
                  type="button"
                  variant="outline"
                  className="h-14 text-lg"
                  disabled={loading || pin.length === 0}
                  onClick={backspace}
                >
                  <Delete className="h-5 w-5" />
                </Button>
              );
            }
            return (
              <Button
                key={key}
                type="button"
                variant="outline"
                className="h-14 text-xl font-semibold"
                disabled={loading}
                onClick={() => press(key)}
              >
                {key}
              </Button>
            );
          })}
        </div>

        {loading && <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />}

        <Button
          type="button"
          className="w-full"
          disabled={loading || pin.length < 4}
          onClick={() => void submit(pin)}
        >
          Sign in to shift
        </Button>

        {onUnenrol && (
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={onUnenrol}>
            Unenrol this device
          </Button>
        )}
      </div>
    </div>
  );
}
