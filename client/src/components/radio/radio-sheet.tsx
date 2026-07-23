import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { RadioPanel } from "@/components/radio/radio-panel";

export function RadioSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="rounded-t-2xl px-4 pb-8 pt-4 max-h-[85vh]">
        <SheetHeader className="text-left mb-3">
          <SheetTitle>Group radio</SheetTitle>
          <SheetDescription>
            Tap to talk — tap again to stop. Everyone in the selected Pulse Group hears you live.
            Audio is not saved.
          </SheetDescription>
        </SheetHeader>
        {open ? <RadioPanel /> : null}
      </SheetContent>
    </Sheet>
  );
}
