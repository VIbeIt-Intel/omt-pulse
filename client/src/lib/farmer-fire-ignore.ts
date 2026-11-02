import { hasOmtAppSettingsPlugin } from "@/lib/omt-app-settings";
import { Capacitor, registerPlugin } from "@capacitor/core";

const KEY = "omt_fire_ignored";
const EVENT = "omt-fire-ignored";

type IgnorePlugin = {
  ignoreFire(options: { id: number }): Promise<{ id: number }>;
  getIgnoredFires(): Promise<{ ids: number[] }>;
};

const Native = registerPlugin<IgnorePlugin>("OmtAppSettings");

function read(): number[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(raw) ? raw.filter((id) => typeof id === "number" && id > 0) : [];
  } catch {
    return [];
  }
}

function write(ids: number[]): void {
  localStorage.setItem(KEY, JSON.stringify([...new Set(ids)]));
  window.dispatchEvent(new Event(EVENT));
}

export function isFireIgnored(id: number): boolean {
  return read().includes(id);
}

export function subscribeFireIgnored(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** Hide this fire on this phone. The group still has it. */
export function ignoreFire(id: number): void {
  if (!Number.isFinite(id) || id <= 0) return;
  write([...read(), id]);
  if (!hasOmtAppSettingsPlugin()) return;
  void Native.ignoreFire({ id }).catch(() => undefined);
}

/** Lock-screen Ignoreer is stored on the phone. Pull it in when the app opens. */
export async function syncIgnoredFiresFromPhone(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !Capacitor.isPluginAvailable("OmtAppSettings")) return;
  try {
    const { ids } = await Native.getIgnoredFires();
    if (!Array.isArray(ids) || ids.length === 0) return;
    write([...read(), ...ids.filter((id) => typeof id === "number")]);
  } catch {
    /* older APK */
  }
}
