import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { initNativePushListeners } from "./lib/native-push";
import { ensureAppCacheCurrent } from "./lib/ensure-app-cache-current";
import { installNativeApiBaseFetch } from "./lib/api-base";
import App from "./App";
import "./index.css";

// Tag <html> when running inside the Capacitor native shell so CSS can punch a
// transparent hole through to the native Google Map view drawn behind the WebView.
if (Capacitor.isNativePlatform()) {
  document.documentElement.classList.add("capacitor-native");
  installNativeApiBaseFetch();
  initNativePushListeners();
} else if ("serviceWorker" in navigator) {
  // PWA only — Capacitor serves bundled assets; a SW causes stale-cache pain.
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {});
  });
}

// --- PWA blank-screen recovery ---
// On Android, the OS can kill the PWA's WebView process while the user is in
// another app (e.g. Google Maps navigation). When the user switches back via
// the recents button, Android tries to restore the WebView. If the process was
// killed, the page may start blank. We detect this and reload to the last known
// URL so the user lands back where they were without needing a hard refresh.

const ROOT_ID = "root";
const RETURN_KEY = "omt_return_url";

function getReturnUrl(): string {
  try { return localStorage.getItem(RETURN_KEY) || "/"; } catch { return "/"; }
}

function clearReturnUrl(): void {
  try { localStorage.removeItem(RETURN_KEY); } catch { /* ignore */ }
}

function isRootEmpty(): boolean {
  const el = document.getElementById(ROOT_ID);
  return !el || el.childNodes.length === 0;
}

// visibilitychange: fires when the user switches back to the PWA tab/window.
// If the root is empty at that point the WebView was killed and re-created blank.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && isRootEmpty()) {
    const url = getReturnUrl();
    clearReturnUrl();
    window.location.replace(url);
  }
});

// pageshow with persisted=true: fires when the page is restored from the
// bfcache (Android Chrome back/forward cache). The bfcache snapshot can be
// stale; force a full reload to ensure the live-incident state is current.
window.addEventListener("pageshow", (event) => {
  if (event.persisted && isRootEmpty()) {
    clearReturnUrl();
    window.location.reload();
  }
});

createRoot(document.getElementById(ROOT_ID)!).render(<App />);

void ensureAppCacheCurrent();
