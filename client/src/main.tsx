import { createRoot } from "react-dom/client";
import { Capacitor } from "@capacitor/core";
import { initNativePushListeners } from "./lib/native-push";
import { ensureAppCacheCurrent } from "./lib/ensure-app-cache-current";
import { installNativeApiBaseFetch } from "./lib/api-base";
import App from "./App";
import "./index.css";

// Farmer phones stay on a light page. The control-room dark preference must
// not paint these screens black.
if (import.meta.env.VITE_FARMER_PHONE === "1") {
  document.documentElement.classList.add("farmer-phone");
  document.documentElement.dataset.forceTheme = "light";
  document.documentElement.classList.remove("dark");
  document.documentElement.classList.add("light");
}

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

// Only recover a WebView that had already drawn and was then killed.
// A blank root during the first paint is normal. Reloading there flashes
// black and white forever when the user comes back from Settings.
let appPainted = false;

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !appPainted || !isRootEmpty()) return;
  const url = getReturnUrl();
  clearReturnUrl();
  appPainted = false;
  window.location.replace(url);
});

window.addEventListener("pageshow", (event) => {
  if (event.persisted && appPainted && isRootEmpty()) {
    clearReturnUrl();
    appPainted = false;
    window.location.reload();
  }
});

createRoot(document.getElementById(ROOT_ID)!).render(<App />);
requestAnimationFrame(() => {
  requestAnimationFrame(() => {
    if (!isRootEmpty()) appPainted = true;
  });
});

void ensureAppCacheCurrent();
