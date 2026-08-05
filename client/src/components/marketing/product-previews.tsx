/** Product screenshots + presentation mocks for omtpulse.com */

import { useState } from "react";
import {
  AlertTriangle,
  Car,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  Download,
  Footprints,
  Gauge,
  MapPinned,
  Mic,
  Play,
  Radio,
  Route,
  Siren,
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
  kind?: "image" | "fleet-mock" | "routes-mock" | "control-room-mock";
};

function PhoneScreenshot({ src, alt, label, onExpand }: {
  src: string;
  alt: string;
  label: string;
  onExpand: () => void;
}) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <button
        type="button"
        onClick={onExpand}
        className="group relative w-full max-w-[300px] rounded-[1.75rem] border-[3px] border-foreground/10 bg-card p-2 shadow-lg shadow-primary/10 text-left transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
        aria-label={`Expand ${label}`}
      >
        <div className="overflow-hidden rounded-[1.35rem] border border-border bg-[#0b0f14] aspect-[9/19.5] flex items-center justify-center">
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-contain object-top"
            loading="lazy"
            decoding="async"
          />
        </div>
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

        {/* Crisp SVG route map (no blurry screenshot) */}
        <div className={cn("relative w-full", compact ? "h-40" : "h-56 sm:h-64")}>
          <svg viewBox="0 0 640 280" className="h-full w-full" aria-hidden>
            <defs>
              <linearGradient id="fleetMapFade" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0f172a" />
                <stop offset="100%" stopColor="#020617" />
              </linearGradient>
            </defs>
            <rect width="640" height="280" fill="url(#fleetMapFade)" />
            {/* Grid / roads */}
            {Array.from({ length: 8 }).map((_, i) => (
              <line
                key={`h-${i}`}
                x1="0"
                y1={30 + i * 32}
                x2="640"
                y2={30 + i * 32}
                stroke="#1e293b"
                strokeWidth="1"
              />
            ))}
            {Array.from({ length: 10 }).map((_, i) => (
              <line
                key={`v-${i}`}
                x1={40 + i * 64}
                y1="0"
                x2={40 + i * 64}
                y2="280"
                stroke="#1e293b"
                strokeWidth="1"
              />
            ))}
            <text x="48" y="36" fill="#64748b" fontSize="11" fontFamily="system-ui,sans-serif">Pretoria</text>
            <text x="420" y="88" fill="#64748b" fontSize="11" fontFamily="system-ui,sans-serif">Centurion</text>
            <text x="500" y="200" fill="#64748b" fontSize="11" fontFamily="system-ui,sans-serif">Johannesburg</text>
            {/* Trip polylines */}
            <polyline fill="none" stroke="#f97316" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" points="60,220 120,180 180,160 220,140" />
            <polyline fill="none" stroke="#22d3ee" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" points="220,140 280,120 340,100 400,90" />
            <polyline fill="none" stroke="#a78bfa" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" points="400,90 460,110 520,150 560,190" />
            <polyline fill="none" stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" points="180,200 260,190 320,170 380,160 440,170" />
            <polyline fill="none" stroke="#fb7185" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" points="100,100 160,130 210,150 250,180" />
            {/* Start / stop markers */}
            <circle cx="60" cy="220" r="6" fill="#22c55e" stroke="#052e16" strokeWidth="2" />
            <circle cx="560" cy="190" r="6" fill="#ef4444" stroke="#450a0a" strokeWidth="2" />
            <circle cx="320" cy="170" r="5" fill="#fbbf24" stroke="#422006" strokeWidth="2" />
          </svg>
          <div className="absolute bottom-2 left-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-background/90 px-2 py-1 text-[10px] font-semibold shadow">
              <Play className="h-3 w-3 text-primary" /> Play route
            </span>
            <span className="rounded-md bg-background/80 px-2 py-1 text-[10px] text-muted-foreground shadow">1x</span>
          </div>
        </div>
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

const CR_TEAM = [
  { name: "Patroller 1", status: "On patrol", ago: "Live GPS", tone: "text-emerald-400" },
  { name: "Sipho Dlamini", status: "Responding", ago: "2 min ago", tone: "text-orange-400" },
  { name: "Aisha Patel", status: "Available", ago: "Just now", tone: "text-emerald-400" },
  { name: "Johan Botha", status: "Gate desk", ago: "Active", tone: "text-sky-400" },
  { name: "Thandi Mokoena", status: "On patrol", ago: "Live GPS", tone: "text-emerald-400" },
];

const CR_FLEET = [
  { name: "Toyota Hilux", status: "Moving", tone: "text-emerald-400 bg-emerald-950/40 border-emerald-700/40" },
  { name: "Ford Figo", status: "Idle", tone: "text-amber-300 bg-amber-950/40 border-amber-700/40" },
  { name: "Isuzu D-Max", status: "Moving", tone: "text-emerald-400 bg-emerald-950/40 border-emerald-700/40" },
  { name: "VW Polo", status: "Idle", tone: "text-amber-300 bg-amber-950/40 border-amber-700/40" },
];

const CR_OCCURRENCES = [
  { type: "Panic", detail: "Estate North · Acknowledged", time: "14:12", bad: true },
  { type: "Intrusion", detail: "Gate 2 · Patrol en route", time: "13:48", bad: true },
  { type: "Access", detail: "Contractor check-in · Unit 4", time: "13:05", bad: false },
  { type: "Patrol", detail: "Route B complete · 12 checkpoints", time: "12:40", bad: false },
  { type: "Fleet", detail: "Speed alert · Hilux cleared", time: "11:55", bad: false },
];

/** Filled Control Room mock for marketing / ads — not a live tenancy. */
export function ControlRoomPresentation({ compact = false }: { compact?: boolean }) {
  const stats = [
    { label: "Active incidents", value: "2", accent: "text-orange-400" },
    { label: "Panics today", value: "1", accent: "text-red-400" },
    { label: "Logged today", value: "18", accent: "text-foreground" },
    { label: "Closed today", value: "16", accent: "text-emerald-400" },
  ];

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-[#0b0f14] text-foreground shadow-inner",
        compact ? "p-3 sm:p-4" : "p-4 sm:p-5",
      )}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold tracking-wide text-primary">CONTROL ROOM</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Online
          </span>
        </div>
        <span className="rounded-md border border-border bg-muted/40 px-2 py-1 text-[10px] font-medium text-muted-foreground">
          Presentation sample
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2">
        <div className="flex items-center gap-2 text-sm font-semibold text-orange-200">
          <MapPinned className="h-4 w-4 text-orange-400" />
          2 live incidents · Estate North & Gate 2
        </div>
        <span className="rounded-md bg-sky-500/20 px-2 py-1 text-[10px] font-semibold text-sky-300">
          Live Monitor
        </span>
      </div>

      <div className={cn("mb-3 grid gap-3", compact ? "grid-cols-1" : "lg:grid-cols-[1.1fr_1fr]")}>
        <div className="rounded-xl border border-border/80 bg-card/40 p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Radio className="h-3.5 w-3.5" />
              Group radio
            </span>
            <span className="text-[10px] text-muted-foreground">3 listening</span>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">Central / Head Office</p>
          <div className="flex items-center justify-center rounded-xl border border-border bg-[#12181f] py-5">
            <div className="inline-flex items-center gap-2 text-sm font-semibold text-foreground/90">
              <Mic className="h-4 w-4 text-primary" />
              Tap to talk
            </div>
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-foreground">
            Live audio · never saved
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {stats.map((s) => (
            <div key={s.label} className="rounded-xl border border-border/80 bg-card/40 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {s.label}
              </p>
              <p className={cn("mt-1 text-2xl font-bold tabular-nums leading-none", s.accent)}>
                {s.value}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className={cn("mb-3 grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
        <div className="rounded-xl border border-border/80 bg-card/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">Site monitor · Team</p>
            <span className="text-[10px] text-muted-foreground">{CR_TEAM.length} online</span>
          </div>
          <div className="space-y-1.5">
            {(compact ? CR_TEAM.slice(0, 3) : CR_TEAM).map((m) => (
              <div
                key={m.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-[#12181f] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">{m.name}</p>
                  <p className={cn("text-[10px]", m.tone)}>{m.status}</p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{m.ago}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border/80 bg-card/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">Site monitor · Fleet</p>
            <span className="text-[10px] text-muted-foreground">{CR_FLEET.length} vehicles</span>
          </div>
          <div className="space-y-1.5">
            {CR_FLEET.map((v) => (
              <div
                key={v.name}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-[#12181f] px-2.5 py-1.5"
              >
                <div className="inline-flex min-w-0 items-center gap-2">
                  <Car className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate text-xs font-semibold">{v.name}</span>
                </div>
                <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase", v.tone)}>
                  {v.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={cn("grid gap-3", compact ? "grid-cols-1" : "md:grid-cols-2")}>
        <div className="rounded-xl border border-orange-500/25 bg-orange-500/5 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-orange-200">
            <Siren className="h-3.5 w-3.5" />
            Live incidents
          </div>
          <div className="space-y-1.5">
            <div className="rounded-lg border border-orange-500/30 bg-[#12181f] px-2.5 py-2">
              <p className="text-xs font-semibold">Panic · Estate North</p>
              <p className="text-[10px] text-muted-foreground">2 responders · ETA 4 min</p>
            </div>
            <div className="rounded-lg border border-border/60 bg-[#12181f] px-2.5 py-2">
              <p className="text-xs font-semibold">Intrusion · Gate 2</p>
              <p className="text-[10px] text-muted-foreground">Patrol Unit 1 joined</p>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border/80 bg-card/30 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold">Today&apos;s occurrences</p>
            <span className="inline-flex items-center gap-1 text-[10px] text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              18 logged
            </span>
          </div>
          <div className="space-y-1.5">
            {(compact ? CR_OCCURRENCES.slice(0, 3) : CR_OCCURRENCES).map((o) => (
              <div
                key={`${o.type}-${o.time}`}
                className="flex items-center justify-between gap-2 rounded-lg border border-border/60 bg-[#12181f] px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span
                      className={cn(
                        "rounded px-1.5 py-0.5 text-[9px] font-bold uppercase",
                        o.bad ? "bg-red-500/20 text-red-300" : "bg-sky-500/15 text-sky-300",
                      )}
                    >
                      {o.type}
                    </span>
                    <span className="truncate text-[11px] text-muted-foreground">{o.detail}</span>
                  </div>
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{o.time}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {!compact && (
        <div className="mt-3 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
            <Footprints className="h-3 w-3" /> Patrol live
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
            <Radio className="h-3 w-3" /> Radio channel open
          </span>
          <span className="inline-flex items-center gap-1 rounded-full border border-border px-2 py-1">
            <Siren className="h-3 w-3" /> Panic / SOS ready
          </span>
        </div>
      )}
    </div>
  );
}

const PREVIEWS = [
  {
    id: "radio",
    label: "Group radio (PTT)",
    src: "/marketing/group-radio.png",
    alt: "Group radio push-to-talk — tap to talk, live audio never saved",
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
            Control Room on the desk. Radio, SOS, and live response in the field — one connected
            system.
          </p>
        </div>

        <figure className="mb-10 flex flex-col gap-3">
          <button
            type="button"
            onClick={() =>
              setLightbox({
                alt: "OMT Pulse Control Room presentation — live incidents, radio, team and fleet",
                caption: "Control Room",
                kind: "control-room-mock",
              })
            }
            className="group relative overflow-hidden rounded-2xl border border-border bg-card text-left shadow-lg shadow-primary/10 transition hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
            aria-label="Expand Control Room"
          >
            <div className="relative max-h-[360px] overflow-hidden sm:max-h-[420px]">
              <ControlRoomPresentation />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
            </div>
            <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium text-muted-foreground opacity-0 shadow transition group-hover:opacity-100">
              <Expand className="h-3 w-3" /> Expand
            </span>
          </button>
          <figcaption className="text-center text-sm font-medium text-foreground">Control Room</figcaption>
        </figure>

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
          <div className="flex flex-wrap justify-center gap-10 lg:col-span-1">
            {PREVIEWS.filter((p) => !p.wide).map(({ id, label, src, alt }) => (
              <PhoneScreenshot
                key={id}
                src={src}
                alt={alt}
                label={label}
                onExpand={() => setLightbox({ src, alt, caption: label, kind: "image" })}
              />
            ))}
          </div>
        </div>
      </div>
      <ScreenshotLightbox item={lightbox} onClose={() => setLightbox(null)} />
    </section>
  );
}

const GALLERY: LightboxItem[] = [
  {
    src: "/marketing/live-monitor.png",
    alt: "Live Monitor map with active incident and responder tracking",
    caption: "Live Monitor — incidents, GPS and responders on one map",
    kind: "image",
  },
  {
    src: "/marketing/turn-by-turn-nav.png",
    alt: "Turn-by-turn navigation during a live incident response",
    caption: "Field navigation — turn-by-turn while responding live",
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

export function FieldGallerySection() {
  const [lightbox, setLightbox] = useState<LightboxItem | null>(null);

  return (
    <section id="gallery" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:pb-24">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for the shift</h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Product screens from OMT Pulse — tap any card to expand.
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
            {item.kind === "fleet-mock" ? (
              <div className="relative max-h-[280px] overflow-hidden sm:max-h-[320px]">
                <FleetBoardPresentation compact />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
              </div>
            ) : item.kind === "routes-mock" ? (
              <div className="relative max-h-[280px] overflow-hidden sm:max-h-[320px]">
                <FleetRoutesPresentation compact />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-card to-transparent" />
              </div>
            ) : (
              <img
                src={item.src}
                alt={item.alt}
                className="w-full object-cover object-top"
                loading="lazy"
                decoding="async"
              />
            )}
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
  return (
    <Dialog open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        className="max-h-[92vh] w-[min(96vw,1100px)] max-w-none overflow-y-auto border-border bg-background p-3 sm:p-4"
        hideDefaultClose
      >
        <div className="mb-2 flex items-start justify-between gap-3">
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
        ) : item?.kind === "control-room-mock" ? (
          <ControlRoomPresentation />
        ) : item?.src ? (
          <img
            src={item.src}
            alt={item.alt}
            className="mx-auto max-h-[80vh] w-auto max-w-full rounded-lg object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
