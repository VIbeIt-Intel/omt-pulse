import { apiRequest } from "@/lib/queryClient";
import { setOmtQuietUntil } from "@/lib/omt-app-settings";

const KEY = "omt_quiet_until";

/** 0 off, -1 until they turn sound on, otherwise quiet until this epoch ms. */
export function readQuietUntil(): number {
  try {
    const until = Number(localStorage.getItem(KEY) ?? "0");
    if (!Number.isFinite(until) || until === 0) return 0;
    if (until > 0 && until <= Date.now()) {
      localStorage.removeItem(KEY);
      return 0;
    }
    return until;
  } catch {
    return 0;
  }
}

export function isFarmerQuiet(): boolean {
  const until = readQuietUntil();
  return until < 0 || until > Date.now();
}

export async function setFarmerQuiet(until: number): Promise<void> {
  try {
    if (!until) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(until));
  } catch { /* private mode */ }
  window.dispatchEvent(new Event("omt-quiet"));
  await setOmtQuietUntil(until);
  try {
    await apiRequest("POST", "/api/me/quiet", { until });
  } catch { /* preview, or the server is not on this build yet */ }
}
