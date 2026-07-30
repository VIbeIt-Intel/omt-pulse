import { useEffect, useState } from "react";
import { RadioPanel } from "@/components/radio/radio-panel";

const COLLAPSED_KEY = "omt-radio-dock-collapsed-v2";

function loadCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (raw === null) return true; // slim by default
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

/**
 * Always-mounted group radio for the authenticated app shell.
 * Stays connected across Dashboard, Fleet, Cameras, Chat, etc.
 * Collapsed = thin bar (default); expanded = full controls. Connection never drops.
 */
export function PersistentRadioDock() {
  const [collapsed, setCollapsed] = useState(loadCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  return (
    <div
      className="shrink-0 border-t border-emerald-500/20 bg-[#0d141c]/95 backdrop-blur-sm px-3 py-1.5 pb-[max(0.35rem,env(safe-area-inset-bottom))] z-40"
      data-testid="persistent-radio-dock"
      data-collapsed={collapsed ? "true" : "false"}
    >
      <RadioPanel
        dock
        compact
        collapsed={collapsed}
        onCollapsedChange={setCollapsed}
        className="max-w-2xl mx-auto shadow-none"
      />
    </div>
  );
}
