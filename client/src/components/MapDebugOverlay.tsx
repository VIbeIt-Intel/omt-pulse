import { useEffect, useState } from "react";

export interface MapDebugSnapshot {
  isNative: boolean;
  mapsReady: boolean;
  mapsError: boolean;
  mapsErrorMsg: string | null;
  geocoderReady: boolean;
  autocompleteReady: boolean;
  nativeMapStatus: "idle" | "creating" | "ready" | "timeout" | "error";
  nativeMapErrorMsg: string | null;
  nativeMapCreateAt: number | null;
  nativeMapReadyAt: number | null;
  useWebMap: boolean;
  errors: string[];
}

interface Props {
  snapshot: MapDebugSnapshot;
  visible: boolean;
  onClose: () => void;
}

export default function MapDebugOverlay({ snapshot, visible, onClose }: Props) {
  const [expanded, setExpanded] = useState(true);
  const [swVersion, setSwVersion] = useState<string>("?");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!visible) return;
    if (!("serviceWorker" in navigator)) {
      setSwVersion("no SW");
      return;
    }
    let cancelled = false;
    const channel = new MessageChannel();
    channel.port1.onmessage = (e) => {
      if (cancelled) return;
      setSwVersion(e.data?.version ?? "?");
    };
    navigator.serviceWorker.ready.then((reg) => {
      const target = reg.active || navigator.serviceWorker.controller;
      if (!target) { setSwVersion("no controller"); return; }
      target.postMessage({ type: "GET_VERSION" }, [channel.port2]);
    }).catch(() => setSwVersion("ready-failed"));
    const t = setTimeout(() => { if (!cancelled && swVersion === "?") setSwVersion("no reply"); }, 2000);
    return () => { cancelled = true; clearTimeout(t); };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!visible) return null;

  const lines: string[] = [
    `SW cache:        ${swVersion}`,
    `isNative:        ${snapshot.isNative}`,
    `JS API:          ${snapshot.mapsError ? "ERROR: " + (snapshot.mapsErrorMsg ?? "?") : snapshot.mapsReady ? "ready" : "loading"}`,
    `Geocoder init:   ${snapshot.geocoderReady ? "yes" : "no"}`,
    `Autocomplete:    ${snapshot.autocompleteReady ? "yes" : "no"}`,
    `Native map:      ${snapshot.nativeMapStatus}${snapshot.nativeMapErrorMsg ? " — " + snapshot.nativeMapErrorMsg : ""}`,
    `Map rendering:   ${snapshot.useWebMap ? "web fallback" : "native"}`,
    `Native create:   ${snapshot.nativeMapCreateAt ? new Date(snapshot.nativeMapCreateAt).toLocaleTimeString() : "—"}`,
    `Native ready:    ${snapshot.nativeMapReadyAt ? new Date(snapshot.nativeMapReadyAt).toLocaleTimeString() : "—"}`,
    `URL:             ${typeof window !== "undefined" ? window.location.href : "?"}`,
    `UA:              ${typeof navigator !== "undefined" ? navigator.userAgent : "?"}`,
    "",
    `Recent errors (${snapshot.errors.length}):`,
    ...snapshot.errors.map((e, i) => `  ${i + 1}. ${e}`),
  ];

  const text = lines.join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed top-16 right-2 z-[9999] max-w-[92vw] sm:max-w-md bg-black/90 text-white text-xs font-mono rounded-md shadow-lg border border-white/20"
      data-testid="map-debug-overlay"
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-white/20">
        <button
          className="font-bold tracking-wide uppercase text-[10px]"
          onClick={() => setExpanded((v) => !v)}
          data-testid="button-debug-toggle"
        >
          🛠 Map Debug {expanded ? "▾" : "▸"}
        </button>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]"
            onClick={copy}
            data-testid="button-debug-copy"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
          <button
            className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]"
            onClick={onClose}
            data-testid="button-debug-close"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded && (
        <pre className="px-3 py-2 whitespace-pre-wrap break-words leading-tight max-h-[60vh] overflow-auto">{text}</pre>
      )}
    </div>
  );
}
