import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, MapPin, Radio, Siren } from "lucide-react";
import { cn } from "@/lib/utils";

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
  onConfirm: () => void;
  onDecline: () => void;
};

export function LiveIncidentJoinPromptSheet({
  open,
  details,
  submitting = false,
  onConfirm,
  onDecline,
}: Props) {
  const isPanic = details?.isPanic ?? false;

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
                ? "If you respond, your GPS will be shared with dispatch and the panicker will be notified."
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
