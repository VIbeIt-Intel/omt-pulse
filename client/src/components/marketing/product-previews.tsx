/** Real product screenshots for the omtpulse.com "See it in action" section. */

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

const PREVIEWS = [
  {
    id: "live-monitor",
    label: "Live response map",
    src: "/marketing/live-monitor.png",
    alt: "Live Monitor showing responders on a map during an escalated incident",
  },
  {
    id: "panic",
    label: "One-tap panic / SOS",
    src: "/marketing/panic-alert.png",
    alt: "SOS panic alert on a patrol phone with acknowledge and join actions",
  },
  {
    id: "navigation",
    label: "Turn-by-turn in the field",
    src: "/marketing/turn-by-turn-nav.png",
    alt: "In-app navigation with live GPS while responding to an incident",
  },
] as const;

export function ProductPreviewsSection() {
  return (
    <section id="product" className="border-y border-border bg-card/30">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">See it in action</h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            From the control room to the patrol officer&apos;s pocket — one connected workflow.
          </p>
        </div>
        <div className="grid gap-10 sm:grid-cols-3 sm:gap-6">
          {PREVIEWS.map(({ id, label, src, alt }) => (
            <PhoneScreenshot key={id} src={src} alt={alt} label={label} />
          ))}
        </div>
      </div>
    </section>
  );
}

const GALLERY = [
  {
    src: "/marketing/mobile-dashboard.png",
    alt: "OMT Pulse mobile dashboard with report incident and SOS buttons",
    caption: "Patrol dashboard — report, live incident, and SOS on one screen",
  },
  {
    src: "/marketing/live-incident-map.png",
    alt: "Live incident map with severity and GPS tracking",
    caption: "Live GPS and severity on the operations map",
  },
] as const;

export function FieldGallerySection() {
  return (
    <section id="gallery" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:pb-24">
      <div className="mb-10 text-center">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">Built for the field</h2>
        <p className="mt-2 text-sm text-muted-foreground sm:text-base">
          Real screens from security teams using OMT Pulse in South Africa.
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
