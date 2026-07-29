import { RadioPanel } from "@/components/radio/radio-panel";

/**
 * Always-mounted group radio for the authenticated app shell.
 * Stays connected across Dashboard, Fleet, Cameras, Chat, etc.
 */
export function PersistentRadioDock() {
  return (
    <div
      className="shrink-0 border-t border-emerald-500/20 bg-[#0d141c]/95 backdrop-blur-sm px-3 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] z-40"
      data-testid="persistent-radio-dock"
    >
      <RadioPanel dock compact className="max-w-2xl mx-auto shadow-none" />
    </div>
  );
}
