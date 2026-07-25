/** Real product screenshots for the omtpulse.com product sections. */

function PhoneScreenshot({ src, alt, label }: { src: string; alt: string; label: string }) {
  return (
    <figure className="flex flex-col items-center gap-3">
      <div className="w-full max-w-[280px] rounded-[1.75rem] border-[3px] border-foreground/10 bg-card p-2 shadow-lg shadow-primary/10">
        <div className="overflow-hidden rounded-[1.35rem] border border-border bg-background aspect-[9/16]">
          <img
            src={src}
            alt={alt}
            className="h-full w-full object-cover object-top"
            loading="lazy"
            decoding="async"
          />
        </div>
      </div>
      <figcaption className="text-center text-sm font-medium text-foreground">{label}</figcaption>
    </figure>
  );
}

function WideScreenshot({ src, alt, label }: { src: string; alt: string; label: string }) {
  return (
    <figure className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg shadow-primary/10">
        <img
          src={src}
          alt={alt}
          className="w-full object-cover object-top"
          loading="lazy"
          decoding="async"
        />
      </div>
      <figcaption className="text-center text-sm font-medium text-foreground">{label}</figcaption>
    </figure>
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
    id: "panic",
    label: "One-tap panic / SOS",
    src: "/marketing/panic-alert.png",
    alt: "SOS panic alert on a patrol phone with acknowledge and join actions",
    wide: false,
  },
] as const;

export function ProductPreviewsSection() {
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
            <WideScreenshot key={id} src={src} alt={alt} label={label} />
          ))}
        </div>
        <div className="mt-12 flex justify-center">
          {PREVIEWS.filter((p) => !p.wide).map(({ id, label, src, alt }) => (
            <PhoneScreenshot key={id} src={src} alt={alt} label={label} />
          ))}
        </div>
      </div>
    </section>
  );
}

const GALLERY = [
  {
    src: "/marketing/fleet-board.png",
    alt: "Fleet board showing vehicle status — moving, idle and offline",
    caption: "Fleet board — live vehicle status across your sites",
  },
  {
    src: "/marketing/fleet-route.png",
    alt: "Vehicle daily travel map with trip playback and GPS route history",
    caption: "Fleet routes — daily travel, trips and playback",
  },
  {
    src: "/marketing/access-control.png",
    alt: "Access Control overview with people on site and visit log",
    caption: "Access Control — who’s on site, check-ins and visit history",
  },
  {
    src: "/marketing/live-incident-map.png",
    alt: "Live incident map with severity and GPS tracking",
    caption: "Live incidents — GPS and severity on the operations map",
  },
] as const;

export function FieldGallerySection() {
  return (
    <section id="gallery" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:pb-24">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for the shift</h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Real screens from OMT Pulse — Control Room, fleet, access and field response.
        </p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        {GALLERY.map(({ src, alt, caption }) => (
          <div
            key={src}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <img
              src={src}
              alt={alt}
              className="w-full object-cover object-top"
              loading="lazy"
              decoding="async"
            />
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">{caption}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
