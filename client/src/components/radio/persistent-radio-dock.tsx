import { useEffect, useRef, useState } from "react";
import { RadioPanel } from "@/components/radio/radio-panel";
import { cn } from "@/lib/utils";
import { isPrivateRadioBusy, subscribePrivateRadioBusy } from "@/hooks/use-private-radio";

/** Idle after expand before snapping back to the slim bar. */
const AUTO_COLLAPSE_MS = 8000;

/**
 * Always-mounted group radio for the authenticated app shell.
 * Stays connected across Dashboard, Fleet, Cameras, Chat, etc.
 * Collapsed = thin bar (default); expanded = channel + full PTT. Connection never drops.
 * Expanded view auto-collapses on outside tap or after idle — slim bar is the normal state.
 */
export function PersistentRadioDock() {
  const [collapsed, setCollapsed] = useState(true);
  const [privateBusy, setPrivateBusy] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setPrivateBusy(isPrivateRadioBusy());
    return subscribePrivateRadioBusy(setPrivateBusy);
  }, []);

  const clearIdle = () => {
    if (idleTimerRef.current != null) {
      window.clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  };

  const scheduleIdleCollapse = () => {
    clearIdle();
    idleTimerRef.current = window.setTimeout(() => {
      setCollapsed(true);
    }, AUTO_COLLAPSE_MS);
  };

  const onCollapsedChange = (next: boolean) => {
    setCollapsed(next);
    if (next) clearIdle();
    else scheduleIdleCollapse();
  };

  // Outside tap → collapse (Radix select portal stays allowed).
  useEffect(() => {
    if (collapsed) return;
    const onPointerDown = (e: PointerEvent) => {
      const el = dockRef.current;
      if (!el) return;
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (el.contains(target)) return;
      if (
        target.closest(
          '[data-radix-select-content], [data-radix-popper-content-wrapper], [role="listbox"]',
        )
      ) {
        return;
      }
      setCollapsed(true);
      clearIdle();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [collapsed]);

  // While expanded, any interaction inside the dock resets the idle timer.
  useEffect(() => {
    if (collapsed) {
      clearIdle();
      return;
    }
    scheduleIdleCollapse();
    const el = dockRef.current;
    if (!el) return;
    const bump = () => scheduleIdleCollapse();
    el.addEventListener("pointerdown", bump);
    el.addEventListener("keydown", bump);
    return () => {
      el.removeEventListener("pointerdown", bump);
      el.removeEventListener("keydown", bump);
      clearIdle();
    };
  }, [collapsed]);

  if (privateBusy) {
    return (
      <div
        className="shrink-0 border-t border-violet-500/20 bg-[#12101a]/95 px-3 py-1.5 text-center text-[11px] text-violet-300 z-40"
        data-testid="persistent-radio-dock-paused"
      >
        Group radio paused — private radio is active
      </div>
    );
  }

  return (
    <div
      ref={dockRef}
      className={cn(
        "shrink-0 border-t border-emerald-500/15 bg-[#0d141c]/95 backdrop-blur-sm z-40",
        collapsed
          ? "px-2 py-1.5 pb-[max(0.4rem,env(safe-area-inset-bottom))]"
          : "px-3 py-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))]",
      )}
      data-testid="persistent-radio-dock"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <RadioPanel
        dock
        compact
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        className="max-w-2xl mx-auto shadow-none"
      />
    </div>
  );
}
