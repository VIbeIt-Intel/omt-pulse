import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ShieldAlert,
  Radio,
  Layers,
  BookOpenCheck,
  Mail,
  MessageCircle,
  ArrowRight,
  CheckCircle2,
  Home as HomeIcon,
  GraduationCap,
  HardHat,
  Siren,
  Car,
  ShieldCheck,
  Footprints,
  MapPinned,
  Lock,
  Server,
  FileCheck2,
  BarChart3,
  Camera,
  ClipboardList,
  Building2,
  PhoneCall,
} from "lucide-react";
import omtLogo from "@/assets/omt-logo-v2.png";
import { FieldGallerySection, ProductPreviewsSection } from "@/components/marketing/product-previews";
import { INTELAFRI_URL } from "@/lib/site-links";

const WHATSAPP_NUMBER = "27675351325";
const SALES_EMAIL = "sales@intelafri.org";

const HERO_TRUST = [
  { icon: Server, label: "Hosted in South Africa" },
  { icon: FileCheck2, label: "POPIA-aligned" },
  { icon: Layers, label: "Multi-tenant Pulse Groups" },
  { icon: ShieldCheck, label: "Built for security ops" },
];

const HIGHLIGHTS = [
  {
    icon: ShieldAlert,
    title: "Panic / SOS",
    body: "One tap from the field. Control Room and nearby units get live GPS instantly — no radio hunt, no delay.",
    image: "/marketing/live-monitor.jpg",
    imageAlt: "Live Monitor with active incident response",
  },
  {
    icon: MapPinned,
    title: "Live Monitor",
    body: "One ops map for incidents, personnel and fleet. Join, track GPS, escalate and close from the desk.",
    image: "/marketing/live-monitor.jpg",
    imageAlt: "Live Monitor ops map",
  },
  {
    icon: BookOpenCheck,
    title: "Occurrence Book",
    body: "Every action logged with who, when and where. Searchable history and Excel export for audits and dockets.",
    image: "/marketing/control-room-busy.png",
    imageAlt: "Control Room and occurrence activity",
  },
];

const FEATURES = [
  {
    icon: ShieldAlert,
    title: "Panic / SOS",
    body: "One-tap distress with live GPS to Control Room and nearby responders — built for the moment that matters.",
  },
  {
    icon: Radio,
    title: "Group radio",
    body: "Push-to-talk across Control Room and field. Live audio only — never recorded or stored.",
  },
  {
    icon: MapPinned,
    title: "Live Monitor",
    body: "Real-time map of incidents, team and fleet with filters, satellite view and join-from-anywhere response.",
  },
  {
    icon: ClipboardList,
    title: "Incident dockets",
    body: "Full case view: timeline, GPS origin, severity, evidence and a clear digital footprint per incident.",
  },
  {
    icon: BookOpenCheck,
    title: "Occurrence Book",
    body: "Searchable ops log with audit-ready history — export to Excel when you need a paper trail.",
  },
  {
    icon: BarChart3,
    title: "Analytics",
    body: "Hotspots by location, type, hour and day. Charts and map views with Excel and PDF export.",
  },
  {
    icon: Car,
    title: "Fleet & Site Monitor",
    body: "Vehicle GPS, moving/idle status, daily routes and team presence on one Control Room board.",
  },
  {
    icon: Camera,
    title: "Cameras / CCTV",
    body: "Live feeds in Control Room with zones and AI hooks — watch the site without leaving the desk.",
  },
  {
    icon: ShieldCheck,
    title: "Access Control",
    body: "People and vehicles in and out — who is on site now, visit logs and gate-desk workflows.",
  },
  {
    icon: Footprints,
    title: "Patrol",
    body: "Routes, checkpoint clocking, missed-stop alerts, PDF reports and route replay after the shift.",
  },
  {
    icon: Layers,
    title: "Pulse Groups",
    body: "Multi-tenant isolation for estates and companies — controlled visibility when groups must share.",
  },
];

const AUDIENCES = [
  {
    icon: ShieldAlert,
    label: "Security companies",
    body: "Run multiple sites from one Control Room — radio, SOS and dockets in one stack.",
  },
  {
    icon: HomeIcon,
    label: "Residential estates",
    body: "Gate access, patrol clocking and panic response for HOA and estate ops teams.",
  },
  {
    icon: GraduationCap,
    label: "Campuses",
    body: "Coordinate campus security with live maps, radio and occurrence logging.",
  },
  {
    icon: HardHat,
    label: "Mine & industrial sites",
    body: "Fleet GPS, site presence and incident control for high-risk environments.",
  },
  {
    icon: Siren,
    label: "Response teams",
    body: "Join live incidents, navigate in and close with a full GPS and evidence trail.",
  },
];

const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Book a walkthrough",
    body: "Tell us your sites, team size and what you run today. We show the Control Room and field app on your use cases.",
  },
  {
    step: "02",
    title: "Configure your ops",
    body: "Locations, categories, Pulse Groups, maps and users — set up for how your shifts actually work.",
  },
  {
    step: "03",
    title: "Trial on your ground",
    body: "A short trial so Control Room and field units can prove radio, SOS and logging before you commit.",
  },
  {
    step: "04",
    title: "Go live with support",
    body: "WhatsApp and email support from IntelAfri. Pricing scoped to your sites and headcount.",
  },
];

const TRUST_POINTS = [
  {
    icon: FileCheck2,
    title: "POPIA-aligned",
    body: "Built for South African privacy law. Clear roles: your organisation as responsible party, IntelAfri as operator when you go live.",
  },
  {
    icon: Server,
    title: "Hosted in South Africa",
    body: "Primary application hosting in SA. Retention controls for visitor logs, GPS tracks and CCTV AI events — configurable per organisation.",
  },
  {
    icon: Lock,
    title: "Access & audit",
    body: "Role-based access, encrypted connections and audit trails so Control Room actions stay accountable.",
  },
  {
    icon: Layers,
    title: "Multi-tenant by design",
    body: "Pulse Groups keep estates and companies isolated — with controlled cross-group visibility only when you need it.",
  },
];

function useLandingSEO() {
  useEffect(() => {
    const prevTitle = document.title;
    const meta = (name: string, attr: "name" | "property" = "name") => {
      let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      return el;
    };
    const desc = meta("description");
    const ogTitle = meta("og:title", "property");
    const ogDesc = meta("og:description", "property");
    const ogType = meta("og:type", "property");
    const ogUrl = meta("og:url", "property");
    const ogImage = meta("og:image", "property");
    const twCard = meta("twitter:card");
    const twTitle = meta("twitter:title");
    const twDesc = meta("twitter:description");

    const prev = {
      desc: desc.content,
      ogTitle: ogTitle.content,
      ogDesc: ogDesc.content,
      ogType: ogType.content,
      ogUrl: ogUrl.content,
      ogImage: ogImage.content,
      twCard: twCard.content,
      twTitle: twTitle.content,
      twDesc: twDesc.content,
    };

    const TITLE =
      "OMT Pulse — Control Room ops for South African security teams";
    const DESC =
      "OMT Pulse unifies Control Room and field: live group radio, panic SOS, Live Monitor, occurrence book, fleet GPS, access control, patrol and CCTV — SA-hosted and POPIA-aligned.";
    const URL = typeof window !== "undefined" ? window.location.origin : "https://omtpulse.com";

    document.title = TITLE;
    desc.content = DESC;
    ogTitle.content = TITLE;
    ogDesc.content = DESC;
    ogType.content = "website";
    ogUrl.content = URL;
    ogImage.content = `${URL}/og-image.png`;
    twCard.content = "summary_large_image";
    twTitle.content = TITLE;
    twDesc.content = DESC;

    return () => {
      document.title = prevTitle;
      desc.content = prev.desc;
      ogTitle.content = prev.ogTitle;
      ogDesc.content = prev.ogDesc;
      ogType.content = prev.ogType;
      ogUrl.content = prev.ogUrl;
      ogImage.content = prev.ogImage;
      twCard.content = prev.twCard;
      twTitle.content = prev.twTitle;
      twDesc.content = prev.twDesc;
    };
  }, []);
}

export default function LandingPage() {
  useLandingSEO();
  const { toast } = useToast();
  const [form, setForm] = useState({
    name: "",
    organisation: "",
    email: "",
    phone: "",
    message: "",
    website: "",
  });
  const [sent, setSent] = useState(false);

  const contact = useMutation({
    mutationFn: async (payload: typeof form) => {
      const res = await apiRequest("POST", "/api/contact", payload);
      return res.json();
    },
    onSuccess: () => {
      setSent(true);
      toast({
        title: "Message sent",
        description: "Thanks — we'll be in touch shortly.",
      });
      setForm({ name: "", organisation: "", email: "", phone: "", message: "", website: "" });
    },
    onError: (err: any) => {
      toast({
        title: "Could not send",
        description: err?.message || `Please email ${SALES_EMAIL} directly.`,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-home">
            <img src={omtLogo} alt="OMT Pulse" className="h-9 w-9 rounded-md" loading="eager" />
            <span className="text-base font-semibold tracking-tight">OMT Pulse</span>
          </Link>
          <nav className="flex items-center gap-1 sm:gap-2">
            <a href="#product" className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground md:inline" data-testid="link-product">
              Product
            </a>
            <a href="#features" className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground sm:inline" data-testid="link-features">
              Features
            </a>
            <a href="#how-it-works" className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground lg:inline" data-testid="link-how-it-works">
              How it works
            </a>
            <a href="#pricing" className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground lg:inline" data-testid="link-pricing">
              Pricing
            </a>
            <a href="#trust" className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground lg:inline" data-testid="link-trust">
              Trust
            </a>
            <a href="#contact" className="hidden rounded-md px-2 py-1.5 text-sm text-muted-foreground transition hover:text-foreground sm:inline" data-testid="link-contact">
              Contact
            </a>
            <a href="#contact" className="ml-1 hidden sm:inline">
              <Button size="sm" data-testid="button-nav-demo">
                Book a demo
              </Button>
            </a>
            <Link href="/login">
              <Button size="sm" variant="outline" data-testid="button-signin">
                Sign in
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_hsl(var(--primary)/0.14),_transparent_55%)]" />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-card/40" />
        </div>
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-14">
            <div className="text-center lg:text-left">
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/70 px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Control Room + field app — one connected ops system
              </p>
              <h1
                className="mb-5 text-4xl font-bold leading-[1.1] tracking-tight sm:text-5xl lg:text-[3.35rem]"
                data-testid="text-hero-title"
              >
                The ops stack that keeps Control Room and field{" "}
                <span className="text-primary">on the same map.</span>
              </h1>
              <p
                className="mb-8 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0 mx-auto"
                data-testid="text-hero-subtitle"
              >
                Live radio, one-tap panic, Live Monitor, occurrence book, fleet GPS, access,
                patrol and CCTV — built for South African security sites that need clarity under pressure.
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <a href="#contact">
                  <Button size="lg" className="w-full sm:w-auto" data-testid="button-cta-contact">
                    Book a demo
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </a>
                <a href="#product">
                  <Button size="lg" variant="outline" className="w-full sm:w-auto" data-testid="button-cta-product">
                    See the product
                  </Button>
                </a>
              </div>
              <p className="mt-4 text-xs text-muted-foreground lg:text-left text-center">
                Access is by invitation. Request a demo and we&apos;ll set up your trial.
              </p>
              <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:gap-3">
                {HERO_TRUST.map(({ icon: Icon, label }) => (
                  <div
                    key={label}
                    className="flex items-center gap-2 rounded-xl border border-border/80 bg-card/50 px-2.5 py-2 text-left"
                  >
                    <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                    <span className="text-[11px] font-medium leading-tight text-muted-foreground sm:text-xs">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="flex justify-center lg:justify-end">
              <div className="relative w-full max-w-xl">
                <div className="absolute -inset-3 -z-10 rounded-3xl bg-primary/12 blur-2xl" />
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-2xl shadow-primary/10">
                  <img
                    src="/marketing/control-room-busy.png"
                    alt="OMT Pulse Control Room — live incidents, team, fleet and occurrence book"
                    className="w-full object-cover object-top"
                    loading="eager"
                    decoding="async"
                  />
                </div>
                <p className="mt-3 text-center text-xs text-muted-foreground">
                  Control Room — team, fleet and live ops at a glance
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ProductPreviewsSection />

      {/* Ops pillars */}
      <section className="border-y border-border bg-card/25">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Core response
            </p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Panic, Live Monitor and the Occurrence Book — connected
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              The three surfaces every shift depends on: raise the alarm, see the response, keep the record.
            </p>
          </div>
          <div className="grid gap-5 lg:grid-cols-3">
            {HIGHLIGHTS.map(({ icon: Icon, title, body, image, imageAlt }) => (
              <div
                key={title}
                className="group overflow-hidden rounded-2xl border border-border bg-background shadow-sm transition hover:border-primary/35"
              >
                <div className="aspect-[16/10] overflow-hidden border-b border-border bg-[#0b0f14]">
                  <img
                    src={image}
                    alt={imageAlt}
                    className="h-full w-full object-cover object-top transition duration-500 group-hover:scale-[1.02]"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <div className="p-5 sm:p-6">
                  <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </div>
                  <h3 className="mb-1.5 text-lg font-semibold">{title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-8 text-center">
            <a href="#contact">
              <Button data-testid="button-cta-highlights">
                Book a demo
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
          </div>
        </div>
      </section>

      <FieldGallerySection />

      {/* Features */}
      <section id="features" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-12 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Platform
            </p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Everything on shift — one system
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              From the Control Room desk to the officer&apos;s phone. Modules stay linked so radio,
              SOS, maps and logs never drift apart.
            </p>
          </div>
          <a href="#contact" className="shrink-0">
            <Button variant="outline" data-testid="button-cta-features">
              Request access
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </a>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card/60 p-6 transition hover:border-primary/30 hover:bg-card"
              data-testid={`feature-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-primary/15 bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-2 text-base font-semibold tracking-tight text-foreground">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Who it's for */}
      <section id="audiences" className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 max-w-2xl">
            <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              Built for operators
            </p>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Who it&apos;s for
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Designed for teams that answer the radio at 02:00 — not for consumer apps dressed up as security software.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {AUDIENCES.map(({ icon: Icon, label, body }) => (
              <div
                key={label}
                className="flex h-full flex-col rounded-2xl border border-border bg-background p-5 transition hover:border-primary/30"
                data-testid={`audience-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mb-1.5 text-sm font-semibold text-foreground">{label}</h3>
                <p className="text-xs leading-relaxed text-muted-foreground sm:text-sm">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Onboarding
          </p>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How it works</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            A clear path from first conversation to live ops — without a six-month IT project.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {HOW_IT_WORKS.map(({ step, title, body }) => (
            <div
              key={step}
              className="relative rounded-2xl border border-border bg-card p-6"
              data-testid={`how-${step}`}
            >
              <div className="mb-4 text-2xl font-bold tabular-nums text-primary/80">{step}</div>
              <h3 className="mb-1.5 text-base font-semibold">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing teaser */}
      <section id="pricing" className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="overflow-hidden rounded-3xl border border-border bg-background">
            <div className="grid lg:grid-cols-2">
              <div className="p-8 sm:p-10 lg:p-12">
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  Pricing
                </p>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Scoped to your sites and team
                </h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  No public price list yet — we size Pulse to your Control Room seats, field users,
                  sites and modules. Contact us for a clear quote and trial options.
                </p>
                <ul className="mt-6 space-y-2.5 text-sm text-muted-foreground">
                  {[
                    "Control Room + field app included",
                    "Multi-tenant Pulse Groups for estates and companies",
                    "Trial available after a short walkthrough",
                    "WhatsApp and email support from IntelAfri",
                  ].map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <a href="#contact">
                    <Button size="lg" className="w-full sm:w-auto" data-testid="button-cta-pricing">
                      Contact us for pricing
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </a>
                  <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer">
                    <Button size="lg" variant="outline" className="w-full sm:w-auto" data-testid="button-cta-pricing-wa">
                      <MessageCircle className="mr-2 h-4 w-4" />
                      WhatsApp
                    </Button>
                  </a>
                </div>
              </div>
              <div className="flex flex-col justify-center border-t border-border bg-card/40 p-8 sm:p-10 lg:border-l lg:border-t-0 lg:p-12">
                <Building2 className="mb-4 h-8 w-8 text-primary" />
                <h3 className="mb-2 text-lg font-semibold">Starting with early operators</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  We&apos;re onboarding South African security and estate teams. Book a demo to see
                  the live product — we won&apos;t show fake reviews or invented case studies.
                </p>
                <div className="mt-6 rounded-xl border border-border bg-background/80 px-4 py-3 text-sm text-muted-foreground">
                  Prefer email?{" "}
                  <a href={`mailto:${SALES_EMAIL}`} className="font-medium text-foreground underline-offset-4 hover:underline">
                    {SALES_EMAIL}
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Trust
          </p>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Built for South African ops — and POPIA
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            Pulse handles workforce location, visitor access and incident evidence. We keep the
            privacy story clear from day one.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TRUST_POINTS.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-6"
              data-testid={`trust-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-1.5 text-base font-semibold text-foreground">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-8 text-center text-sm text-muted-foreground">
          Read how we process personal information in our{" "}
          <Link href="/privacy" className="font-medium text-foreground underline-offset-4 hover:underline" data-testid="link-trust-privacy">
            Privacy Policy
          </Link>
          .
        </p>
      </section>

      {/* Final CTA band */}
      <section className="border-y border-border bg-primary/10">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center sm:px-6 sm:py-14">
          <div className="max-w-xl">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Ready to see Pulse on your sites?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Book a demo or send a message — we respond within one business day.
            </p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <a href="#contact" className="w-full sm:w-auto">
              <Button size="lg" className="w-full" data-testid="button-cta-final">
                Book a demo
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </a>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full sm:w-auto"
            >
              <Button size="lg" variant="outline" className="w-full" data-testid="button-cta-final-wa">
                <PhoneCall className="mr-2 h-4 w-4" />
                WhatsApp sales
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Contact */}
      <section id="contact" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 text-center">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
            Contact
          </p>
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Request a demo or access
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Demo requests, pricing and on-site rollouts — we&apos;ll respond within one business day.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 lg:col-span-1">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ArrowRight className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">Send us a message</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Tell us about your sites and team — we&apos;ll be in touch.
            </p>
            {sent ? (
              <div
                className="rounded-lg border border-primary/30 bg-primary/5 p-5 text-center"
                data-testid="text-contact-success"
              >
                <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-primary" />
                <div className="text-base font-semibold">
                  Thanks — your message is on its way.
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  We&apos;ll be in touch shortly at the email you provided.
                </div>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  contact.mutate(form);
                }}
                className="space-y-3"
              >
                <div>
                  <Label htmlFor="contact-name">Name *</Label>
                  <Input
                    id="contact-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    data-testid="input-contact-name"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-org">Organisation</Label>
                  <Input
                    id="contact-org"
                    value={form.organisation}
                    onChange={(e) => setForm({ ...form, organisation: e.target.value })}
                    data-testid="input-contact-organisation"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-email">Email *</Label>
                  <Input
                    id="contact-email"
                    type="email"
                    required
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    data-testid="input-contact-email"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-phone">Phone</Label>
                  <Input
                    id="contact-phone"
                    value={form.phone}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                    data-testid="input-contact-phone"
                  />
                </div>
                <div>
                  <Label htmlFor="contact-message">Message *</Label>
                  <Textarea
                    id="contact-message"
                    required
                    rows={4}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                    placeholder="Sites, team size, and what you need to solve."
                    data-testid="input-contact-message"
                  />
                </div>
                <div
                  aria-hidden="true"
                  style={{ position: "absolute", left: "-9999px", height: 0, width: 0, overflow: "hidden" }}
                >
                  <label htmlFor="contact-website">Website</label>
                  <input
                    id="contact-website"
                    tabIndex={-1}
                    autoComplete="off"
                    value={form.website}
                    onChange={(e) => setForm({ ...form, website: e.target.value })}
                  />
                </div>
                <Button
                  type="submit"
                  size="lg"
                  className="w-full"
                  disabled={contact.isPending}
                  data-testid="button-contact-submit"
                >
                  {contact.isPending ? "Sending…" : "Request a demo"}
                </Button>
              </form>
            )}
          </div>

          <div className="flex flex-col rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">Email us</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Reach sales directly — replies usually within a few hours on business days.
            </p>
            <div className="mb-6 break-all text-sm font-medium text-foreground" data-testid="text-email-address">
              {SALES_EMAIL}
            </div>
            <a
              href={`mailto:${SALES_EMAIL}?subject=${encodeURIComponent("OMT Pulse — enquiry")}`}
              className="mt-auto"
              data-testid="link-email"
            >
              <Button size="lg" variant="outline" className="w-full">
                <Mail className="mr-2 h-4 w-4" />
                Open email
              </Button>
            </a>
          </div>

          <div className="flex flex-col rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageCircle className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">WhatsApp us</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Quick questions and demo bookings — message us on WhatsApp.
            </p>
            <div className="mb-6 text-sm font-medium text-foreground" data-testid="text-whatsapp-number">
              +27 67 535 1325
            </div>
            <a
              href={`https://wa.me/${WHATSAPP_NUMBER}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-auto"
              data-testid="link-whatsapp"
            >
              <Button size="lg" variant="outline" className="w-full">
                <MessageCircle className="mr-2 h-4 w-4" />
                Open WhatsApp
              </Button>
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="mb-3 flex items-center gap-2.5">
                <img src={omtLogo} alt="OMT Pulse" className="h-8 w-8 rounded-md" loading="lazy" />
                <span className="text-base font-semibold">OMT Pulse</span>
              </div>
              <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
                Control Room and field ops for South African security teams. An IntelAfri product.
              </p>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground">Product</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#product" className="hover:text-foreground">See it in action</a></li>
                <li><a href="#features" className="hover:text-foreground">Features</a></li>
                <li><a href="#how-it-works" className="hover:text-foreground">How it works</a></li>
                <li><a href="#pricing" className="hover:text-foreground">Pricing</a></li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground">Trust</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li><a href="#trust" className="hover:text-foreground" data-testid="link-footer-popia">POPIA</a></li>
                <li>
                  <Link href="/privacy" className="hover:text-foreground" data-testid="link-footer-privacy">
                    Privacy Policy
                  </Link>
                </li>
                <li>
                  <a href={INTELAFRI_URL} target="_blank" rel="noopener noreferrer" className="hover:text-foreground" data-testid="link-footer-intelafri">
                    IntelAfri
                  </a>
                </li>
              </ul>
            </div>
            <div>
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-foreground">Contact</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>
                  <a href={`mailto:${SALES_EMAIL}`} className="hover:text-foreground" data-testid="link-footer-email">
                    {SALES_EMAIL}
                  </a>
                </li>
                <li>
                  <a href={`https://wa.me/${WHATSAPP_NUMBER}`} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
                    +27 67 535 1325
                  </a>
                </li>
                <li>
                  <Link href="/login" className="hover:text-foreground" data-testid="link-footer-signin">
                    Sign in
                  </Link>
                </li>
              </ul>
            </div>
          </div>
          <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-border pt-6 text-xs text-muted-foreground sm:flex-row sm:items-center">
            <span>© {new Date().getFullYear()} OMT Pulse · An IntelAfri product</span>
            <span>Hosted in South Africa · POPIA-aligned · Invitation-only access</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
