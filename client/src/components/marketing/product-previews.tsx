/** Product screenshots + presentation mocks for omtpulse.com */

import { useEffect, useRef, useState, type ReactNode } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertTriangle,
  Car,
  ChevronRight,
  CirclePause,
  Download,
  Gauge,
  Mic,
  Play,
  Radio,
  Route,
  Timer,
  User,
  Users,
  WifiOff,
  X,
  Expand,
  Footprints,
  Camera,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type LightboxKind =
  | "image"
  | "phone"
  | "fleet-mock"
  | "routes-mock"
  | "analytics-mock"
  | "analytics-map-mock"
  | "control-room-mock"
  | "live-monitor-mock"
  | "radio-mock"
  | "cameras-mock"
  | "patrol-mock";

type LightboxItem = {
  src?: string;
  alt: string;
  caption: string;
  kind?: LightboxKind;
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
    <figure className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={onExpand}
        className="group relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-primary/10 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Expand ${label}`}
      >
        <img
          src={src}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover object-top"
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

function WideMockCard({
  label,
  onExpand,
  children,
}: {
  label: string;
  onExpand: () => void;
  children: ReactNode;
}) {
  return (
    <figure className="flex h-full flex-col gap-3">
      <button
        type="button"
        onClick={onExpand}
        className="group relative aspect-[16/10] w-full overflow-hidden rounded-2xl border border-border bg-card text-left shadow-lg shadow-primary/10 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Expand ${label}`}
      >
        <div className="absolute inset-0 overflow-hidden">{children}</div>
        <span className="pointer-events-none absolute bottom-3 right-3 z-[2] inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground opacity-0 shadow transition group-hover:opacity-100">
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

const CR_TEAM = [
  { name: "Jaco Cronje", role: "Control Room", status: "Available", tone: "bg-emerald-400", ago: "Live now" },
  { name: "Patroller 1", role: "Armed response", status: "On patrol", tone: "bg-emerald-400", ago: "Live GPS" },
  { name: "Anton Kruger", role: "Supervisor", status: "Available", tone: "bg-emerald-400", ago: "2m ago" },
  { name: "Sipho Dlamini", role: "Response", status: "Responding", tone: "bg-orange-400", ago: "Live now" },
  { name: "Aisha Patel", role: "Patrol", status: "On patrol", tone: "bg-emerald-400", ago: "Live GPS" },
  { name: "Thandi Mokoena", role: "Gate desk", status: "Available", tone: "bg-emerald-400", ago: "1m ago" },
  { name: "Johan Botha", role: "Escort", status: "Moving", tone: "bg-sky-400", ago: "Live GPS" },
  { name: "Lucas Steyn", role: "Patrol", status: "Off duty", tone: "bg-slate-500", ago: "Off shift" },
];

const CR_FLEET = [
  { name: "Toyota Hilux", plate: "HH12GP GP", status: "MOVING", speed: "54 km/h", moving: true },
  { name: "Isuzu D-Max", plate: "JD45MP GP", status: "MOVING", speed: "38 km/h", moving: true },
  { name: "Ford Figo", plate: "CF80YN GP", status: "IDLE", speed: "0 km/h", moving: false },
  { name: "VW Polo", plate: "CA99ZN GP", status: "IDLE", speed: "0 km/h", moving: false },
  { name: "Toyota Quantum", plate: "NP33KZ GP", status: "MOVING", speed: "41 km/h", moving: true },
  { name: "Nissan NP200", plate: "FS21BL GP", status: "OFFLINE", speed: "—", moving: false },
];

/** Busy Control Room board — marketing sample units only. */
function ControlRoomOpsPresentation({ compact = false }: { compact?: boolean }) {
  const team = compact ? CR_TEAM.slice(0, 5) : CR_TEAM;
  const fleet = compact ? CR_FLEET.slice(0, 4) : CR_FLEET;

  return (
    <div className={cn("h-full overflow-hidden bg-[#0b0f14] text-foreground", compact ? "p-2.5" : "p-3 sm:p-4")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-primary sm:text-sm">CONTROL ROOM</p>
          <p className="text-[10px] text-muted-foreground">8 on duty · 3 vehicles moving · sample data</p>
        </div>
        <span className="rounded-md border border-emerald-700/50 bg-emerald-950/50 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
          All clear
        </span>
      </div>
      <div className="mb-2 grid grid-cols-4 gap-1.5">
        {[
          { label: "Active", value: "1" },
          { label: "Panics", value: "1" },
          { label: "Logged", value: "14" },
          { label: "Closed", value: "11" },
        ].map((k) => (
          <div key={k.label} className="rounded-lg border border-border/70 bg-card/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums sm:text-base">{k.value}</p>
            <p className="text-[9px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
          </div>
        ))}
      </div>
      <div className="grid h-[calc(100%-4.5rem)] min-h-0 grid-cols-2 gap-2">
        <div className="min-h-0 overflow-hidden rounded-lg border border-border/70 bg-card/30">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
            <Users className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Team · {team.length}</span>
          </div>
          <div className="max-h-full space-y-0.5 overflow-hidden p-1.5">
            {team.map((m) => (
              <div key={m.name} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px]">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m.tone)} />
                <span className="min-w-0 flex-1 truncate font-medium">{m.name}</span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline">{m.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="min-h-0 overflow-hidden rounded-lg border border-border/70 bg-card/30">
          <div className="flex items-center gap-1.5 border-b border-border/60 px-2 py-1.5">
            <Car className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fleet · {fleet.length}</span>
          </div>
          <div className="space-y-0.5 p-1.5">
            {fleet.map((v) => (
              <div key={v.plate} className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px]">
                <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", v.moving ? "bg-emerald-400" : v.status === "OFFLINE" ? "bg-slate-500" : "bg-amber-400")} />
                <span className="min-w-0 flex-1 truncate font-medium">{v.name}</span>
                <span className={cn("shrink-0 rounded px-1 py-px text-[9px] font-bold", v.moving ? "text-emerald-300" : "text-muted-foreground")}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const LM_UNITS: { lat: number; lng: number; kind: "person" | "vehicle" | "incident"; label: string }[] = [
  { lat: -25.7479, lng: 28.2293, kind: "person", label: "Jaco" },
  { lat: -25.82, lng: 28.42, kind: "incident", label: "Panic" },
  { lat: -25.86, lng: 28.19, kind: "vehicle", label: "Hilux" },
  { lat: -25.9, lng: 28.15, kind: "person", label: "Sipho" },
  { lat: -25.78, lng: 28.28, kind: "vehicle", label: "D-Max" },
  { lat: -26.05, lng: 28.1, kind: "person", label: "Aisha" },
  { lat: -25.93, lng: 28.25, kind: "vehicle", label: "Quantum" },
  { lat: -25.85, lng: 28.35, kind: "person", label: "Thandi" },
  { lat: -26.12, lng: 28.05, kind: "person", label: "Johan" },
  { lat: -25.76, lng: 28.38, kind: "vehicle", label: "Figo" },
];

function LiveMonitorOpsPresentation({ compact = false }: { compact?: boolean }) {
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

    for (const u of LM_UNITS) {
      const fill =
        u.kind === "incident" ? "#ef4444" : u.kind === "vehicle" ? "#22d3ee" : "#34d399";
      L.circleMarker([u.lat, u.lng], {
        radius: u.kind === "incident" ? 9 : 7,
        color: "#0b0f14",
        weight: 2,
        fillColor: fill,
        fillOpacity: 0.95,
      }).addTo(map);
    }

    const bounds = L.latLngBounds(LM_UNITS.map((u) => [u.lat, u.lng] as [number, number]));
    map.fitBounds(bounds.pad(0.28));
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

  const people = LM_UNITS.filter((u) => u.kind === "person").length;
  const vehicles = LM_UNITS.filter((u) => u.kind === "vehicle").length;

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-[#0b0f14] text-foreground", compact ? "p-2" : "p-3")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-primary sm:text-sm">LIVE MONITOR</p>
          <p className="text-[10px] text-muted-foreground">
            1 active · {people} personnel · {vehicles} vehicles
          </p>
        </div>
        <div className="flex gap-1">
          <span className="rounded-md bg-primary/90 px-2 py-0.5 text-[9px] font-semibold text-primary-foreground">ALL</span>
          <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">INCIDENTS</span>
          <span className="rounded-md bg-muted/50 px-2 py-0.5 text-[9px] text-muted-foreground">TEAM &amp; FLEET</span>
        </div>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70">
        <div ref={mapRef} className="absolute inset-0 bg-[#0b1220]" aria-hidden />
        {!compact && (
          <div className="pointer-events-none absolute bottom-2 left-2 z-[1] flex flex-wrap gap-1.5">
            <span className="inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[9px] shadow">
              <span className="h-2 w-2 rounded-full bg-emerald-400" /> Personnel
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[9px] shadow">
              <span className="h-2 w-2 rounded-full bg-cyan-400" /> Vehicles
            </span>
            <span className="inline-flex items-center gap-1 rounded-md bg-background/90 px-1.5 py-0.5 text-[9px] shadow">
              <span className="h-2 w-2 rounded-full bg-red-500" /> Incident
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

const RADIO_LISTENERS = [
  { name: "Jaco Cronje", role: "Control" },
  { name: "Patroller 1", role: "Field" },
  { name: "Sipho Dlamini", role: "Response" },
  { name: "Aisha Patel", role: "Patrol" },
  { name: "Thandi Mokoena", role: "Gate" },
  { name: "Johan Botha", role: "Escort" },
];

function RadioOpsPresentation({ compact = false }: { compact?: boolean }) {
  const listeners = compact ? RADIO_LISTENERS.slice(0, 4) : RADIO_LISTENERS;
  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-[#0b0f14] text-foreground", compact ? "p-2.5" : "p-3 sm:p-4")}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-primary sm:text-sm">GROUP RADIO</p>
          <p className="text-[10px] text-muted-foreground">Central / Head Office · live PTT</p>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-700/50 bg-emerald-950/40 px-2 py-0.5 text-[10px] font-semibold text-emerald-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> ONLINE · {listeners.length}
        </span>
      </div>
      <div className="mb-2 min-h-0 flex-1 space-y-1 overflow-hidden rounded-lg border border-border/70 bg-card/30 p-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">On channel</p>
        {listeners.map((l) => (
          <div key={l.name} className="flex items-center gap-2 rounded-md px-1.5 py-1 text-[11px]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-[9px] font-bold text-primary">
              {l.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
            <span className="shrink-0 text-[10px] text-muted-foreground">{l.role}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-emerald-700/40 bg-emerald-950/30 px-3 py-2.5">
        <Mic className="h-4 w-4 text-emerald-300" />
        <span className="text-xs font-semibold text-emerald-200">Hold to talk</span>
        <span className="ml-auto text-[10px] text-muted-foreground">Audio never saved</span>
      </div>
    </div>
  );
}

const CCTV_CAMERAS = [
  {
    name: "Merweville Unit 2 Field",
    status: "Live",
    zone: true,
    ai: true,
    feed: "/marketing/cctv-merweville-field.jpg",
  },
  {
    name: "Gate 1 Entrance",
    status: "Live",
    zone: true,
    ai: true,
    feed: "/marketing/cctv-gate-entrance.jpg",
  },
  {
    name: "Clubhouse North",
    status: "Live",
    zone: false,
    ai: true,
    feed: "/marketing/cctv-clubhouse.jpg",
  },
  {
    name: "Perimeter East",
    status: "Live",
    zone: true,
    ai: false,
    feed: "/marketing/cctv-perimeter.jpg",
  },
  {
    name: "Parking Bay B",
    status: "Idle",
    zone: false,
    ai: false,
    feed: "/marketing/cctv-clubhouse.jpg",
  },
  {
    name: "Warehouse Dock",
    status: "Live",
    zone: true,
    ai: true,
    feed: "/marketing/cctv-gate-entrance.jpg",
  },
];

/** Multi-camera CCTV board — marketing sample. */
function CamerasOpsPresentation({ compact = false }: { compact?: boolean }) {
  const cams = compact ? CCTV_CAMERAS.slice(0, 4) : CCTV_CAMERAS;
  const tiles = cams.slice(0, 4);

  return (
    <div className={cn("flex h-full flex-col overflow-hidden bg-[#0b0f14] text-foreground", compact ? "p-2" : "p-3")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold tracking-wide text-primary sm:text-sm">CAMERAS</p>
          <p className="text-[10px] text-muted-foreground">{CCTV_CAMERAS.length} cameras · 5 live · sample board</p>
        </div>
        <span className="rounded-md border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
          + Add camera
        </span>
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)] gap-2">
        <div className="min-h-0 space-y-1 overflow-hidden rounded-lg border border-border/70 bg-card/30 p-1.5">
          <p className="px-1 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
            Cameras ({cams.length})
          </p>
          {cams.map((c, i) => (
            <div
              key={c.name}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-1.5 py-1.5 text-[10px]",
                i === 0 ? "border border-primary/50 bg-primary/10" : "bg-muted/20",
              )}
            >
              <Camera className="h-3 w-3 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
              <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", c.status === "Live" ? "bg-emerald-400" : "bg-slate-500")} />
            </div>
          ))}
        </div>
        <div className="grid min-h-0 grid-cols-2 grid-rows-2 gap-1.5">
          {tiles.map((c) => (
            <div
              key={c.name}
              className="relative overflow-hidden rounded-lg border border-border/70 bg-[#0a0a0a]"
            >
              <img
                src={c.feed}
                alt=""
                className="absolute inset-0 h-full w-full object-cover object-center contrast-110 saturate-0"
                loading="lazy"
                decoding="async"
              />
              <div
                className="pointer-events-none absolute inset-0 opacity-25 mix-blend-overlay"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.35) 2px, rgba(0,0,0,0.35) 3px)",
                }}
              />
              <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/35" />
              <div className="absolute left-1.5 top-1.5 flex gap-1">
                {c.zone && (
                  <span className="rounded bg-sky-600/90 px-1 py-px text-[8px] font-bold text-white">ZONE</span>
                )}
                {c.ai && (
                  <span className="rounded bg-emerald-600/90 px-1 py-px text-[8px] font-bold text-white">AI</span>
                )}
              </div>
              <div className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded bg-black/65 px-1 py-px text-[8px] font-semibold text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                REC
              </div>
              <div className="absolute bottom-1.5 left-1.5 right-1.5">
                <p className="truncate text-[9px] font-semibold text-white drop-shadow">{c.name}</p>
                <p className="text-[8px] text-emerald-300">{c.status}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const PATROL_CHECKS = [
  { n: 1, name: "Gate house", time: "18:02", ok: true },
  { n: 2, name: "Clubhouse", time: "18:19", ok: true },
  { n: 3, name: "Perimeter East", time: "18:34", ok: true },
  { n: 4, name: "Warehouse", time: "18:51", ok: true },
  { n: 5, name: "Parking B", time: "19:08", ok: true },
  { n: 6, name: "Unit 12 loop", time: "19:22", ok: true },
  { n: 7, name: "Sports field", time: "19:37", ok: true },
  { n: 8, name: "Gate house", time: "19:44", ok: true },
];

const PATROL_PLANNED: [number, number][] = [
  [-25.858, 28.188],
  [-25.861, 28.195],
  [-25.866, 28.201],
  [-25.872, 28.198],
  [-25.875, 28.19],
  [-25.87, 28.182],
  [-25.864, 28.18],
  [-25.858, 28.188],
];

const PATROL_TRACK: [number, number][] = [
  [-25.8582, 28.1881],
  [-25.8595, 28.191],
  [-25.8612, 28.1948],
  [-25.864, 28.1985],
  [-25.8675, 28.2005],
  [-25.871, 28.198],
  [-25.8735, 28.193],
  [-25.8748, 28.189],
  [-25.872, 28.1835],
  [-25.867, 28.1805],
  [-25.862, 28.1815],
  [-25.8585, 28.1875],
];

/** Completed patrol report with realistic map track — marketing sample. */
function PatrolOpsPresentation({ compact = false }: { compact?: boolean }) {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const checks = compact ? PATROL_CHECKS.slice(0, 5) : PATROL_CHECKS;

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

    L.polyline(PATROL_PLANNED, {
      color: "#60a5fa",
      weight: 3,
      opacity: 0.75,
      dashArray: "6 6",
    }).addTo(map);

    L.polyline(PATROL_TRACK, {
      color: "#34d399",
      weight: 4,
      opacity: 0.95,
      lineCap: "round",
      lineJoin: "round",
    }).addTo(map);

    PATROL_PLANNED.forEach((ll, i) => {
      L.circleMarker(ll, {
        radius: 6,
        color: "#0b0f14",
        weight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 1,
      }).addTo(map);
      L.marker(ll, {
        interactive: false,
        icon: L.divIcon({
          className: "",
          html: `<div style="color:#fff;font:700 9px system-ui;text-shadow:0 1px 2px #000;margin-top:-5px;text-align:center;width:14px">${i + 1}</div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        }),
      }).addTo(map);
    });

    const bounds = L.latLngBounds([...PATROL_PLANNED, ...PATROL_TRACK]);
    map.fitBounds(bounds.pad(0.2));
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
    <div className={cn("flex h-full flex-col overflow-hidden bg-[#0b0f14] text-foreground", compact ? "p-2" : "p-3")}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-start gap-2">
          <Footprints className="mt-0.5 h-4 w-4 text-primary" />
          <div>
            <p className="text-xs font-bold tracking-wide text-primary sm:text-sm">MERWEVILLE PATROL</p>
            <p className="text-[10px] text-muted-foreground">Patroller 1 · Completed · Toyota Hilux HH12GP GP</p>
          </div>
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          PDF
        </span>
      </div>
      <div className="mb-2 grid grid-cols-4 gap-1.5">
        {[
          { label: "Duration", value: "1h 42m" },
          { label: "Distance", value: "4.8 km" },
          { label: "Checkpoints", value: "8/8" },
          { label: "Track pts", value: "412" },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-border/70 bg-card/40 px-2 py-1.5 text-center">
            <p className="text-xs font-bold tabular-nums sm:text-sm">{s.value}</p>
            <p className="text-[8px] uppercase tracking-wide text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>
      <div className={cn("grid min-h-0 flex-1 gap-2", compact ? "grid-cols-1" : "grid-cols-[1.4fr_1fr]")}>
        <div className="relative min-h-[7rem] overflow-hidden rounded-lg border border-border/70">
          <div ref={mapRef} className="absolute inset-0 bg-[#0b1220]" aria-hidden />
          <div className="pointer-events-none absolute bottom-1.5 left-1.5 z-[1] flex gap-1">
            <span className="rounded bg-background/90 px-1.5 py-0.5 text-[8px] font-semibold shadow">
              <Play className="mr-0.5 inline h-2.5 w-2.5 text-primary" /> Play route
            </span>
            <span className="rounded bg-background/80 px-1.5 py-0.5 text-[8px] text-muted-foreground shadow">
              Green = actual · Blue = planned
            </span>
          </div>
        </div>
        {!compact && (
          <div className="min-h-0 space-y-1 overflow-hidden rounded-lg border border-border/70 bg-card/30 p-2">
            <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Checkpoint log</p>
            {checks.map((c) => (
              <div key={c.n} className="flex items-center gap-2 text-[10px]">
                <span className="flex h-4 w-4 items-center justify-center rounded-full bg-blue-500/90 text-[8px] font-bold text-white">
                  {c.n}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                <span className="tabular-nums text-muted-foreground">{c.time}</span>
                <span className="text-emerald-400">✓</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ProductPreviewsSection() {
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  return (
    <section id="product" className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-12 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Product
          </p>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See it in action</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm text-muted-foreground sm:text-base">
            Desk and field views from the live product — tap any card to expand.
          </p>
        </div>
        <div className="grid items-stretch gap-6 sm:gap-8 lg:grid-cols-2">
          <WideMockCard
            label="Control Room"
            onExpand={() =>
              setLightbox({
                alt: "Control Room with team and fleet units",
                caption: "Control Room — team, fleet and live ops board",
                kind: "control-room-mock",
              })
            }
          >
            <ControlRoomOpsPresentation compact />
          </WideMockCard>
          <WideScreenshot
            src="/marketing/live-monitor.jpg"
            alt="OMT Pulse Live Monitor — active theft response with GPS tracking on Pretoria map"
            label="Live Monitor"
            onExpand={() =>
              setLightbox({
                src: "/marketing/live-monitor.jpg",
                alt: "OMT Pulse Live Monitor — active theft response with GPS tracking on Pretoria map",
                caption: "Live Monitor — live response, GPS track and units on the map",
                kind: "image",
              })
            }
          />
          <WideMockCard
            label="Group radio (PTT)"
            onExpand={() =>
              setLightbox({
                alt: "Group radio with listeners on channel",
                caption: "Group radio — live PTT with units on channel",
                kind: "radio-mock",
              })
            }
          >
            <RadioOpsPresentation compact />
          </WideMockCard>
          <WideMockCard
            label="Cameras / CCTV"
            onExpand={() =>
              setLightbox({
                alt: "Multi-camera CCTV board with live feeds",
                caption: "Cameras / CCTV — multi-camera Control Room board",
                kind: "cameras-mock",
              })
            }
          >
            <CamerasOpsPresentation compact />
          </WideMockCard>
        </div>
        <div className="mt-14 flex justify-center">
          <PhoneScreenshot
            src="/marketing/mobile-dashboard.png"
            alt="OMT Pulse field home — Panic/SOS, patrol, live incident, access control and report"
            label="Field app home"
            onExpand={() =>
              setLightbox({
                src: "/marketing/mobile-dashboard.png",
                alt: "OMT Pulse field home — Panic/SOS, patrol, live incident, access control and report",
                caption: "Field app home",
                kind: "phone",
              })
            }
          />
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
    src: "/marketing/live-monitor.jpg",
    alt: "Live Monitor with active theft response and GPS tracking on Pretoria map",
    caption: "Live Monitor — live response, GPS track and units on the map",
    kind: "image",
  },
  {
    alt: "Control Room with team and fleet units for presentation",
    caption: "Control Room — team and fleet units on one board",
    kind: "control-room-mock",
  },
  {
    alt: "Multi-camera CCTV board with live feeds and AI/zone badges",
    caption: "Cameras / CCTV — multi-camera Control Room board",
    kind: "cameras-mock",
  },
  {
    alt: "Completed Merweville patrol with GPS track and checkpoint log",
    caption: "Patrol — completed route, checkpoints and GPS track",
    kind: "patrol-mock",
  },
  {
    src: "/marketing/incident-docket.png",
    alt: "Incident docket with panic status, live timeline and evidence",
    caption: "Incident docket — timeline, GPS and evidence trail",
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
];

function GalleryPreview({ item }: { item: LightboxItem }) {
  const wrap = (node: ReactNode) => (
    <div className="relative aspect-[16/10] overflow-hidden">
      <div className="absolute inset-0">{node}</div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card to-transparent" />
    </div>
  );

  if (item.kind === "fleet-mock") return wrap(<FleetBoardPresentation compact />);
  if (item.kind === "routes-mock") return wrap(<FleetRoutesPresentation compact />);
  if (item.kind === "analytics-mock") return wrap(<AnalyticsChartsPresentation compact />);
  if (item.kind === "analytics-map-mock") return wrap(<AnalyticsMapPresentation compact />);
  if (item.kind === "control-room-mock") return wrap(<ControlRoomOpsPresentation compact />);
  if (item.kind === "live-monitor-mock") return wrap(<LiveMonitorOpsPresentation compact />);
  if (item.kind === "radio-mock") return wrap(<RadioOpsPresentation compact />);
  if (item.kind === "cameras-mock") return wrap(<CamerasOpsPresentation compact />);
  if (item.kind === "patrol-mock") return wrap(<PatrolOpsPresentation compact />);

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
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
          Gallery
        </p>
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for the shift</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
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
        ) : item?.kind === "control-room-mock" ? (
          <ControlRoomOpsPresentation />
        ) : item?.kind === "live-monitor-mock" ? (
          <LiveMonitorOpsPresentation />
        ) : item?.kind === "radio-mock" ? (
          <RadioOpsPresentation />
        ) : item?.kind === "cameras-mock" ? (
          <CamerasOpsPresentation />
        ) : item?.kind === "patrol-mock" ? (
          <PatrolOpsPresentation />
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
