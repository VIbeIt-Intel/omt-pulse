/** Product screenshots + presentation mocks for omtpulse.com */

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle,
  Car,
  ChevronRight,
  CirclePause,
  Download,
  Gauge,
  Play,
  Radio,
  Route,
  Timer,
  User,
  WifiOff,
  X,
  Expand,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type LightboxItem = {
  src?: string;
  alt: string;
  caption: string;
  kind?: "image" | "phone" | "fleet-mock" | "routes-mock" | "analytics-mock" | "analytics-map-mock";
};

/** Matches marketing/mobile-dashboard.png (460×928). */
const PHONE_FRAME_ASPECT = "460 / 928";

function PhoneBezel({
  src,
  alt,
  className,
  imgClassName,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[1.75rem] border-[3px] border-border bg-[#0b0f14] p-1.5 shadow-lg shadow-primary/15",
        className,
      )}
    >
      <div
        className="relative w-full overflow-hidden rounded-[1.3rem] bg-[#0b0f14]"
        style={{ aspectRatio: PHONE_FRAME_ASPECT }}
      >
        <img
          src={src}
          alt={alt}
          className={cn("absolute inset-0 h-full w-full object-cover object-top", imgClassName)}
          loading="lazy"
          decoding="async"
        />
      </div>
    </div>
  );
}

function PhoneScreenshot({ src, alt, label, onExpand }: {
  src: string;
  alt: string;
  label: string;
  onExpand: () => void;
}) {
  return (
    <figure className="mx-auto flex w-full max-w-[380px] flex-col items-center gap-3 sm:max-w-[420px]">
      <button
        type="button"
        onClick={onExpand}
        className="group relative w-full text-left transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Expand ${label}`}
      >
        <PhoneBezel src={src} alt={alt} className="w-full transition group-hover:border-primary/40" />
        <span className="pointer-events-none absolute bottom-4 right-4 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground opacity-0 shadow transition group-hover:opacity-100">
          <Expand className="h-3 w-3" /> Expand
        </span>
      </button>
      <figcaption className="text-center text-sm font-medium text-foreground">{label}</figcaption>
    </figure>
  );
}

function WideScreenshot({ src, alt, label, onExpand }: {
  src: string;
  alt: string;
  label: string;
  onExpand: () => void;
}) {
  return (
    <figure className="flex flex-col gap-3">
      <button
        type="button"
        onClick={onExpand}
        className="group relative overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-primary/10 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Expand ${label}`}
      >
        <img
          src={src}
          alt={alt}
          className="w-full object-cover object-top"
          loading="lazy"
          decoding="async"
        />
        <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground opacity-0 shadow transition group-hover:opacity-100">
          <Expand className="h-3 w-3" /> Expand
        </span>
      </button>
      <figcaption className="text-center text-sm font-medium text-foreground">{label}</figcaption>
    </figure>
  );
}

/** Sample fleet for marketing only — not live tenancy data. */
const PRESENTATION_VEHICLES = [
  { name: "Ford Figo", plate: "CF80YN GP", status: "idle" as const, gps: "GPS 2m ago", person: "Patrol Unit 1" },
  { name: "Toyota Hilux", plate: "HH12GP GP", status: "moving" as const, gps: "48 km/h", person: "Response 2" },
  { name: "Isuzu D-Max", plate: "JD45MP GP", status: "moving" as const, gps: "62 km/h", person: "Escort A" },
  { name: "VW Polo", plate: "CA99ZN GP", status: "idle" as const, gps: "GPS 8m ago", person: "Gate standby" },
  { name: "Toyota Quantum", plate: "NP33KZ GP", status: "idle" as const, gps: "GPS 14m ago", person: "Crew shuttle" },
  { name: "Nissan NP200", plate: "FS21BL GP", status: "offline" as const, gps: "Signal 3h ago", person: "Workshop" },
];

const STATUS_STYLE = {
  moving: { label: "Moving", pill: "text-emerald-300 bg-emerald-950/50 border-emerald-700/50", dot: "bg-emerald-400" },
  idle: { label: "Idle", pill: "text-amber-300 bg-amber-950/50 border-amber-700/50", dot: "bg-amber-400" },
  offline: { label: "Offline", pill: "text-slate-300 bg-slate-900/60 border-slate-600/50", dot: "bg-slate-400" },
};

function FleetBoardPresentation({ compact = false }: { compact?: boolean }) {
  const moving = PRESENTATION_VEHICLES.filter((v) => v.status === "moving").length;
  const idle = PRESENTATION_VEHICLES.filter((v) => v.status === "idle").length;
  const offline = PRESENTATION_VEHICLES.filter((v) => v.status === "offline").length;
  const stats = [
    { label: "Total vehicles", value: PRESENTATION_VEHICLES.length, icon: Car, accent: "text-foreground" },
    { label: "Moving", value: moving, icon: Radio, accent: "text-emerald-400" },
    { label: "Idle", value: idle, icon: CirclePause, accent: "text-amber-400" },
    { label: "Offline", value: offline, icon: WifiOff, accent: "text-slate-400" },
    { label: "Alerts (24h)", value: 1, icon: AlertTriangle, accent: "text-red-400" },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-[#0b0f14] text-foreground shadow-inner",
        compact ? "p-3 sm:p-4" : "p-4 sm:p-6",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-3">
          <span className="text-sm font-bold tracking-wide text-primary">FLEET</span>
          <span className="text-lg font-bold tabular-nums">{PRESENTATION_VEHICLES.length}</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">vehicles</span>
          <span className="text-xs text-emerald-400">Moving {moving}</span>
          <span className="text-xs text-amber-400">Idle {idle}</span>
          <span className="text-xs text-slate-400">Offline {offline}</span>
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Presentation sample
        </span>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {stats.map(({ label, value, icon: Icon, accent }) => (
          <div key={label} className="rounded-xl border border-border/80 bg-card/40 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
              <Icon className={cn("h-3.5 w-3.5 shrink-0", accent)} />
            </div>
            <p className={cn("text-xl font-bold tabular-nums leading-none", accent)}>{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 rounded-xl border border-border/80 bg-card/30 px-3 py-2.5">
        <p className="text-xs font-semibold">Recent alerts</p>
        <p className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
          Speed — Toyota Hilux · 12 min ago
        </p>
      </div>

      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Vehicles</p>
      <div className={cn("grid gap-2", compact ? "sm:grid-cols-1" : "sm:grid-cols-2")}>
        {PRESENTATION_VEHICLES.map((v) => {
          const st = STATUS_STYLE[v.status];
          return (
            <div
              key={v.plate}
              className="flex items-start gap-3 rounded-xl border border-border/80 bg-card/50 p-3"
            >
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40">
                <Car className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-semibold">{v.name}</span>
                  <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase", st.pill)}>
                    <span className={cn("h-1.5 w-1.5 rounded-full", st.dot)} />
                    {st.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{v.plate}</p>
                <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{v.gps}</span>
                  <span className="inline-flex items-center gap-1 truncate">
                    <User className="h-3 w-3 shrink-0" />
                    {v.person}
                  </span>
                </div>
              </div>
              <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground/40" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

const PRESENTATION_TRIPS = [
  { n: 1, time: "07:01 – 07:08", km: "0.9 km", color: "#f97316" },
  { n: 2, time: "07:22 – 07:41", km: "12.4 km", color: "#22d3ee" },
  { n: 3, time: "08:05 – 08:48", km: "28.1 km", color: "#a78bfa" },
  { n: 4, time: "09:10 – 09:33", km: "9.7 km", color: "#34d399" },
  { n: 5, time: "10:02 – 10:55", km: "31.2 km", color: "#fbbf24" },
  { n: 6, time: "11:43 – 12:19", km: "45.2 km", color: "#fb7185" },
  { n: 7, time: "13:05 – 13:28", km: "11.6 km", color: "#60a5fa" },
  { n: 8, time: "14:12 – 15:01", km: "38.4 km", color: "#c084fc" },
];

/** Sample day routes along Pretoria → Centurion → Johannesburg corridor (marketing only). */
const PRESENTATION_ROUTE_PATHS: { color: string; latlngs: [number, number][] }[] = [
  {
    color: "#f97316",
    latlngs: [
      [-25.7479, 28.2293],
      [-25.762, 28.218],
      [-25.78, 28.205],
      [-25.805, 28.195],
      [-25.83, 28.19],
    ],
  },
  {
    color: "#22d3ee",
    latlngs: [
      [-25.83, 28.19],
      [-25.86, 28.189],
      [-25.89, 28.175],
      [-25.94, 28.15],
      [-25.99, 28.12],
    ],
  },
  {
    color: "#a78bfa",
    latlngs: [
      [-25.99, 28.12],
      [-26.04, 28.1],
      [-26.09, 28.08],
      [-26.14, 28.06],
      [-26.2041, 28.0473],
    ],
  },
  {
    color: "#34d399",
    latlngs: [
      [-25.86, 28.189],
      [-25.87, 28.22],
      [-25.875, 28.255],
      [-25.86, 28.29],
      [-25.84, 28.31],
    ],
  },
  {
    color: "#fb7185",
    latlngs: [
      [-26.05, 28.1],
      [-26.08, 28.14],
      [-26.11, 28.18],
      [-26.13, 28.22],
      [-26.12, 28.26],
    ],
  },
  {
    color: "#fbbf24",
    latlngs: [
      [-25.78, 28.205],
      [-25.8, 28.24],
      [-25.82, 28.27],
      [-25.85, 28.3],
      [-25.88, 28.32],
    ],
  },
];

function PresentationRouteMap({ compact = false }: { compact?: boolean }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    const layers: L.Layer[] = [];
    for (const route of PRESENTATION_ROUTE_PATHS) {
      layers.push(
        L.polyline(route.latlngs, {
          color: route.color,
          weight: 3.5,
          opacity: 0.92,
          lineCap: "round",
          lineJoin: "round",
        }).addTo(map),
      );
    }

    const start = PRESENTATION_ROUTE_PATHS[0].latlngs[0];
    const end = PRESENTATION_ROUTE_PATHS[2].latlngs[PRESENTATION_ROUTE_PATHS[2].latlngs.length - 1];
    layers.push(
      L.circleMarker(start, {
        radius: 6,
        color: "#052e16",
        weight: 2,
        fillColor: "#22c55e",
        fillOpacity: 1,
      }).addTo(map),
    );
    layers.push(
      L.circleMarker(end, {
        radius: 6,
        color: "#450a0a",
        weight: 2,
        fillColor: "#ef4444",
        fillOpacity: 1,
      }).addTo(map),
    );

    const bounds = L.latLngBounds(PRESENTATION_ROUTE_PATHS.flatMap((r) => r.latlngs));
    map.fitBounds(bounds.pad(0.12));
    mapInstanceRef.current = map;

    const invalidate = () => map.invalidateSize();
    const t1 = window.setTimeout(invalidate, 80);
    const t2 = window.setTimeout(invalidate, 320);
    window.addEventListener("resize", invalidate);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", invalidate);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <div className={cn("relative w-full", compact ? "h-40" : "h-56 sm:h-64")}>
      <div ref={mapRef} className="absolute inset-0 z-0 bg-[#0b1220]" aria-hidden />
      <div className="pointer-events-none absolute bottom-2 left-2 z-[1] flex items-center gap-2">
        <span className="inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-[10px] font-semibold shadow">
          <Play className="h-3 w-3 text-primary" /> Play route
        </span>
        <span className="rounded-md bg-background/80 px-2 py-1 text-[10px] text-muted-foreground shadow">1x</span>
      </div>
    </div>
  );
}

function FleetRoutesPresentation({ compact = false }: { compact?: boolean }) {
  const trips = compact ? PRESENTATION_TRIPS.slice(0, 5) : PRESENTATION_TRIPS;

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-[#0b0f14] text-foreground shadow-inner",
        compact ? "p-3 sm:p-4" : "p-4 sm:p-6",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold tracking-wide text-primary">FLEET ROUTES</p>
          <p className="text-xs text-muted-foreground">Toyota Hilux · HH12GP GP</p>
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Presentation sample
        </span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: "Distance", value: "236.6 km", icon: Route },
          { label: "Max speed", value: "119 km/h", icon: Gauge },
          { label: "Driving", value: "4h 16m", icon: Timer },
          { label: "Trips", value: "13", icon: Car },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border/80 bg-card/40 px-3 py-2.5">
            <div className="mb-1 flex items-center justify-between gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {label}
              </span>
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </div>
            <p className="text-base font-bold tabular-nums leading-none sm:text-lg">{value}</p>
          </div>
        ))}
      </div>

      <div className="mb-3 overflow-hidden rounded-xl border border-border/80 bg-[#111827]">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Wed, 5 Aug 2026
            </span>
            <span className="text-[11px] text-muted-foreground">1,601 GPS points</span>
          </div>
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
            <Download className="h-3 w-3" /> Report
          </span>
        </div>

        <PresentationRouteMap compact={compact} />
      </div>

      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Trip log
      </p>
      <div className={cn("grid gap-1.5", compact ? "grid-cols-1" : "sm:grid-cols-2")}>
        {trips.map((t) => (
          <div
            key={t.n}
            className="flex items-center gap-2 rounded-lg border border-border/70 bg-card/40 px-2.5 py-2 text-xs"
          >
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: t.color }}
            />
            <span className="font-semibold tabular-nums">Trip {t.n}</span>
            <span className="text-muted-foreground tabular-nums">{t.time}</span>
            <span className="ml-auto font-medium tabular-nums text-foreground/90">{t.km}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function HBar({ label, pct, tone = "green" }: { label: string; pct: number; tone?: "green" | "red" | "slate" }) {
  const bar =
    tone === "red" ? "bg-red-500" : tone === "slate" ? "bg-slate-500" : "bg-emerald-400";
  return (
    <div className="flex items-center gap-2">
      <span className="w-24 shrink-0 truncate text-[10px] text-muted-foreground sm:w-28">{label}</span>
      <div className="h-2.5 min-w-0 flex-1 rounded-full bg-muted/50">
        <div className={cn("h-2.5 rounded-full", bar)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function VBars({ values, labels }: { values: number[]; labels: string[] }) {
  const max = Math.max(...values, 1);
  return (
    <div className="flex h-28 items-end gap-1 sm:gap-1.5">
      {values.map((v, i) => (
        <div key={labels[i] ?? i} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div
            className="w-full max-w-[28px] rounded-t-sm bg-emerald-400/90"
            style={{ height: `${Math.max(8, (v / max) * 100)}%` }}
          />
          <span className="truncate text-[9px] text-muted-foreground">{labels[i]}</span>
        </div>
      ))}
    </div>
  );
}

/** Crisp analytics charts board — marketing sample data only. */
function AnalyticsChartsPresentation({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-[#0b0f14] text-foreground shadow-inner",
        compact ? "p-3 sm:p-4" : "p-4 sm:p-6",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-bold tracking-wide text-primary">ANALYTICS</span>
          <span className="text-lg font-bold tabular-nums">14</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">incidents</span>
          <span className="text-xs text-muted-foreground">Top: Tierpoort · Panic</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="rounded-md border border-primary/40 bg-primary/15 px-2 py-1 text-[10px] font-semibold text-primary">
            Charts
          </span>
          <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] text-muted-foreground">
            Map
          </span>
          <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
            Presentation sample
          </span>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[
          { label: "Total", value: "14" },
          { label: "Top location", value: "Tierpoort" },
          { label: "Top type", value: "Panic" },
          { label: "Peak hour", value: "14:00" },
          { label: "Live", value: "0" },
        ].map((s) => (
          <div key={s.label} className="rounded-xl border border-border/80 bg-card/40 px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</p>
            <p className="mt-0.5 truncate text-sm font-bold tabular-nums sm:text-base">{s.value}</p>
          </div>
        ))}
      </div>

      <div className={cn("grid gap-2", compact ? "grid-cols-1 sm:grid-cols-2" : "sm:grid-cols-2")}>
        <div className="rounded-xl border border-border/80 bg-card/30 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Location</p>
          <div className="space-y-2">
            <HBar label="Tierpoort" pct={92} />
            <HBar label="Mooikloof" pct={48} />
            <HBar label="Moreleta" pct={36} />
            <HBar label="Centurion" pct={22} />
          </div>
        </div>
        <div className="rounded-xl border border-border/80 bg-card/30 p-3">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Type</p>
          <div className="space-y-2">
            <HBar label="Panic" pct={88} tone="red" />
            <HBar label="Alarm" pct={54} tone="slate" />
            <HBar label="Other" pct={32} tone="slate" />
            <HBar label="Medical" pct={18} tone="slate" />
          </div>
        </div>
        {!compact && (
          <>
            <div className="rounded-xl border border-border/80 bg-card/30 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Incident time
              </p>
              <VBars
                values={[1, 0, 2, 1, 3, 4, 2, 1, 2, 5, 3, 2]}
                labels={["00", "02", "04", "06", "08", "10", "12", "14", "16", "18", "20", "22"]}
              />
            </div>
            <div className="rounded-xl border border-border/80 bg-card/30 p-3">
              <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Day of week
              </p>
              <VBars values={[2, 1, 7, 2, 1, 1, 0]} labels={["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const ANALYTICS_HOTSPOTS: { lat: number; lng: number; kind: "panic" | "other" }[] = [
  { lat: -25.82, lng: 28.42, kind: "panic" },
  { lat: -25.85, lng: 28.35, kind: "panic" },
  { lat: -25.78, lng: 28.28, kind: "other" },
  { lat: -25.9, lng: 28.2, kind: "panic" },
  { lat: -25.87, lng: 28.25, kind: "panic" },
  { lat: -25.76, lng: 28.38, kind: "other" },
  { lat: -25.93, lng: 28.15, kind: "panic" },
];

function AnalyticsMapPresentation({ compact = false }: { compact?: boolean }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: false,
      attributionControl: false,
      dragging: false,
      scrollWheelZoom: false,
      doubleClickZoom: false,
      boxZoom: false,
      keyboard: false,
      touchZoom: false,
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      maxZoom: 19,
    }).addTo(map);

    for (const h of ANALYTICS_HOTSPOTS) {
      const color = h.kind === "panic" ? "#ef4444" : "#94a3b8";
      L.circleMarker([h.lat, h.lng], {
        radius: 8,
        color: "#0b0f14",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      }).addTo(map);
    }

    const bounds = L.latLngBounds(ANALYTICS_HOTSPOTS.map((h) => [h.lat, h.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.35));
    mapInstanceRef.current = map;

    const invalidate = () => map.invalidateSize();
    const t1 = window.setTimeout(invalidate, 80);
    const t2 = window.setTimeout(invalidate, 320);
    window.addEventListener("resize", invalidate);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener("resize", invalidate);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-[#0b0f14] text-foreground shadow-inner",
        compact ? "p-3" : "p-4 sm:p-5",
      )}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold tracking-wide text-primary">ANALYTICS — MAP</p>
          <p className="text-xs text-muted-foreground">14 incidents · Hotspot: Tierpoort · Lead: Panic</p>
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Presentation sample
        </span>
      </div>
      <div className={cn("relative overflow-hidden rounded-xl border border-border/80", compact ? "h-40" : "h-56 sm:h-64")}>
        <div ref={mapRef} className="absolute inset-0 bg-[#0b1220]" aria-hidden />
        <div className="pointer-events-none absolute left-2 top-2 z-[1] flex gap-1">
          <span className="rounded-md bg-primary/90 px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">
            Markers
          </span>
          <span className="rounded-md bg-background/80 px-2 py-0.5 text-[10px] text-muted-foreground">Heatmap</span>
        </div>
        <div className="pointer-events-none absolute bottom-2 right-2 z-[1] rounded-md bg-background/90 px-2 py-1 text-[10px] text-muted-foreground shadow">
          <span className="mr-2 inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500" /> Panic</span>
          <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-slate-400" /> Other</span>
        </div>
      </div>
    </div>
  );
}

const PREVIEWS = [
  {
    id: "control-room",
    label: "Control Room",
    src: "/marketing/control-room-busy.png",
    alt: "OMT Pulse Control Room with live incidents, site monitor team and fleet",
    wide: true,
  },
  {
    id: "live-monitor",
    label: "Live Monitor",
    src: "/marketing/live-monitor.png",
    alt: "OMT Pulse Live Monitor — incidents, team and fleet on one ops map",
    wide: true,
  },
  {
    id: "radio",
    label: "Group radio (PTT)",
    src: "/marketing/group-radio.png",
    alt: "Group radio push-to-talk — tap to talk, live audio never saved",
    wide: true,
  },
  {
    id: "cameras",
    label: "Cameras / CCTV",
    src: "/marketing/cameras-cctv.png",
    alt: "OMT Pulse Cameras — live CCTV feed with zone and AI controls",
    wide: true,
  },
  {
    id: "field-home",
    label: "Field app home",
    src: "/marketing/mobile-dashboard.png",
    alt: "OMT Pulse field home — Panic/SOS, patrol, live incident, access control and report",
    wide: false,
  },
] as const;

export function ProductPreviewsSection() {
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  return (
    <section id="product" className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See it in action</h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Control Room, Live Monitor, radio and CCTV on the desk — SOS and response in the field.
          </p>
        </div>
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-8">
          {PREVIEWS.filter((p) => p.wide).map(({ id, label, src, alt }) => (
            <WideScreenshot
              key={id}
              src={src}
              alt={alt}
              label={label}
              onExpand={() => setLightbox({ src, alt, caption: label, kind: "image" })}
            />
          ))}
        </div>
        <div className="mt-14 flex justify-center">
          {PREVIEWS.filter((p) => !p.wide).map(({ id, label, src, alt }) => (
            <PhoneScreenshot
              key={id}
              src={src}
              alt={alt}
              label={label}
              onExpand={() => setLightbox({ src, alt, caption: label, kind: "phone" })}
            />
          ))}
        </div>
      </div>
      <ScreenshotLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </section>
  );
}

const GALLERY: LightboxItem[] = [
  {
    alt: "Analytics charts presentation — locations, types, peak hours and day-of-week",
    caption: "Analytics — charts by location, type, hour and day",
    kind: "analytics-mock",
  },
  {
    alt: "Analytics map presentation — panic and other incident hotspots",
    caption: "Analytics map — incident hotspots and type legend",
    kind: "analytics-map-mock",
  },
  {
    src: "/marketing/live-monitor.png",
    alt: "Live Monitor map with active incident and responder tracking",
    caption: "Live Monitor — incidents, team and fleet on one map",
    kind: "image",
  },
  {
    src: "/marketing/cameras-cctv.png",
    alt: "Cameras page with live CCTV feed and zone controls",
    caption: "Cameras / CCTV — live feeds from Control Room",
    kind: "image",
  },
  {
    src: "/marketing/incident-docket.png",
    alt: "Incident docket with panic status, live timeline and evidence",
    caption: "Incident docket — timeline, GPS and evidence trail",
    kind: "image",
  },
  {
    src: "/marketing/patrol-report.png",
    alt: "Patrol report with checkpoints, route map and playback",
    caption: "Patrol — checkpoints, route map and PDF report",
    kind: "image",
  },
  {
    alt: "Fleet board with sample vehicles for presentation — moving, idle and offline",
    caption: "Fleet board — live vehicle status across your sites",
    kind: "fleet-mock",
  },
  {
    alt: "Fleet routes presentation — daily travel map, trip log and playback controls",
    caption: "Fleet routes — daily travel, trips and playback",
    kind: "routes-mock",
  },
  {
    src: "/marketing/turn-by-turn-nav.png",
    alt: "Turn-by-turn navigation during a live incident response",
    caption: "Field navigation — turn-by-turn while responding live",
    kind: "image",
  },
];

function GalleryPreview({ item }: { item: LightboxItem }) {
  if (item.kind === "fleet-mock") {
    return (
      <div className="relative max-h-[280px] overflow-hidden sm:max-h-[320px]">
        <FleetBoardPresentation compact />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
      </div>
    );
  }
  if (item.kind === "routes-mock") {
    return (
      <div className="relative max-h-[280px] overflow-hidden sm:max-h-[320px]">
        <FleetRoutesPresentation compact />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
      </div>
    );
  }
  if (item.kind === "analytics-mock") {
    return (
      <div className="relative max-h-[280px] overflow-hidden sm:max-h-[320px]">
        <AnalyticsChartsPresentation compact />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
      </div>
    );
  }
  if (item.kind === "analytics-map-mock") {
    return (
      <div className="relative max-h-[280px] overflow-hidden sm:max-h-[320px]">
        <AnalyticsMapPresentation compact />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
      </div>
    );
  }
  return (
    <img
      src={item.src}
      alt={item.alt}
      className="aspect-[16/10] w-full object-cover object-top"
      loading="lazy"
      decoding="async"
    />
  );
}

export function FieldGallerySection() {
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  return (
    <section id="gallery" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:pb-24">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for the shift</h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Analytics, Live Monitor, CCTV, incident dockets, patrol and fleet — tap any card to expand.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {GALLERY.map((item) => (
          <button
            key={item.caption}
            type="button"
            onClick={() => setLightbox(item)}
            className="group overflow-hidden rounded-2xl border border-border bg-card text-left shadow-sm transition hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label={`Expand ${item.caption}`}
          >
            <GalleryPreview item={item} />
            <p className="flex items-center justify-between gap-2 border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <span>{item.caption}</span>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium opacity-70 transition group-hover:opacity-100">
                <Expand className="h-3 w-3" /> Expand
              </span>
            </p>
          </button>
        ))}
      </div>
      <ScreenshotLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </section>
  );
}

function ScreenshotLightbox({
  item,
  onClose,
}: {
  item: LightboxItem | null;
  onClose: () => void;
}) {
  const isPhone = item?.kind === "phone";

  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className={cn(
          "flex max-h-[94vh] max-w-none flex-col gap-3 overflow-y-auto border-border bg-background p-3 sm:p-4",
          isPhone
            ? "w-[min(96vw,480px)] items-center"
            : "w-[min(96vw,1100px)]",
        )}
        hideDefaultClose
      >
        <div className={cn("flex w-full items-start justify-between gap-3", isPhone && "max-w-[420px]")}>
          <DialogTitle className="text-sm font-semibold leading-snug sm:text-base">
            {item?.caption}
          </DialogTitle>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {item?.kind === "fleet-mock" ? (
          <FleetBoardPresentation />
        ) : item?.kind === "routes-mock" ? (
          <FleetRoutesPresentation />
        ) : item?.kind === "analytics-mock" ? (
          <AnalyticsChartsPresentation />
        ) : item?.kind === "analytics-map-mock" ? (
          <AnalyticsMapPresentation />
        ) : item?.kind === "phone" && item.src ? (
          <div
            className="mx-auto overflow-hidden rounded-[1.75rem] border-[3px] border-border bg-[#0b0f14] p-1.5 shadow-lg shadow-primary/15"
            style={{
              height: "min(82vh, 860px)",
              aspectRatio: PHONE_FRAME_ASPECT,
              maxWidth: "min(92vw, 420px)",
            }}
          >
            <div className="relative h-full w-full overflow-hidden rounded-[1.3rem] bg-[#0b0f14]">
              <img
                src={item.src}
                alt={item.alt}
                className="absolute inset-0 h-full w-full object-cover object-top"
                decoding="async"
              />
            </div>
          </div>
        ) : item?.src ? (
          <div className="flex w-full justify-center">
            <img
              src={item.src}
              alt={item.alt}
              className="max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
            />
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
