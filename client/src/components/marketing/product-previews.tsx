/** Product screenshots + presentation mocks for omtpulse.com */

import { useState } from "react";
import {
  AlertTriangle,
  Car,
  ChevronRight,
  CirclePause,
  Radio,
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
  kind?: "image" | "fleet-mock";
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

const PREVIEWS = [
  {
    id: "control-room",
    label: "Control Room",
    src: "/marketing/control-room.png",
    alt: "OMT Pulse Control Room with group radio, site monitor, fleet and live incident overview",
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
        <div className="mt-12 flex flex-wrap justify-center gap-10">
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
    src: "/marketing/fleet-route.png",
    alt: "Vehicle daily travel map with trip playback and GPS route history",
    caption: "Fleet routes — daily travel, trips and playback",
    kind: "image",
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
