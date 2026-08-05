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
} from "lucide-react";
import omtLogo from "@/assets/omt-logo-v2.png";
import { FieldGallerySection, ProductPreviewsSection } from "@/components/marketing/product-previews";
import { INTELAFRI_URL } from "@/lib/site-links";

const WHATSAPP_NUMBER = "27675351325";
const SALES_EMAIL = "sales@intelafri.org";

const FEATURES = [
  {
    icon: ShieldAlert,
    title: "Panic / SOS",
    body: "One-tap distress with live GPS to Control Room and nearby responders.",
  },
  {
    icon: Radio,
    title: "Group radio",
    body: "Live push-to-talk for Pulse Groups — Control Room and field, audio never saved.",
  },
  {
    icon: MapPinned,
    title: "Live Incident Monitor",
    body: "Real-time map of responders, severity, and join-from-anywhere workflows.",
  },
  {
    icon: BookOpenCheck,
    title: "Occurrence Book",
    body: "Every action logged and searchable — audit-ready with Excel export.",
  },
  {
    icon: Car,
    title: "Fleet & Site Monitor",
    body: "GPS vehicles, idle/moving status, routes, and team presence on one board.",
  },
  {
    icon: ShieldCheck,
    title: "Access Control",
    body: "People and vehicles in and out — who’s on site, visit logs, gate desk.",
  },
  {
    icon: Footprints,
    title: "Patrol",
    body: "Routes and checkpoint clocking for patrol teams on the ground.",
  },
  {
    icon: Layers,
    title: "Pulse Groups",
    body: "Multi-tenant groups with isolated data and controlled cross-group visibility.",
  },
];

const AUDIENCES = [
  { icon: ShieldAlert, label: "Security companies" },
  { icon: HomeIcon, label: "Residential estates" },
  { icon: GraduationCap, label: "Campuses" },
  { icon: HardHat, label: "Mine sites" },
  { icon: Siren, label: "Response teams" },
];

const GET_STARTED = [
  {
    step: "1",
    title: "Start with a trial",
    body: "48-hour trial for your organisation. We set up your first command and users.",
  },
  {
    step: "2",
    title: "On-site rollout",
    body: "We configure locations, categories, and custom maps for your site or estate.",
  },
  {
    step: "3",
    title: "Ongoing support",
    body: "WhatsApp and email support. Pricing tailored to team size and number of sites.",
  },
];

const TRUST_POINTS = [
  {
    icon: FileCheck2,
    title: "POPIA-aligned",
    body: "Built for South African privacy law. Registered Information Officer, clear roles for your organisation as responsible party and IntelAfri as operator.",
  },
  {
    icon: Server,
    title: "Hosted in South Africa",
    body: "Primary application hosting in SA. Retention controls for visitor logs, GPS tracks and CCTV AI events — configurable per organisation.",
  },
  {
    icon: Lock,
    title: "Access & audit",
    body: "Role-based access, encrypted connections, and audit trails so Control Room actions stay accountable.",
  },
];

// Apply landing-specific SEO tags. Restored when the visitor navigates away.
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
      "OMT Pulse — Control Room, group radio, SOS, fleet & access for security teams";
    const DESC =
      "OMT Pulse is the Control Room and field app for security teams: live group radio, panic SOS, live incident maps, occurrence book, fleet GPS, access control and patrol — built for South African ops.";
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
    website: "", // honeypot
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
      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5" data-testid="link-home">
            <img src={omtLogo} alt="OMT Pulse" className="h-9 w-9 rounded-md" loading="eager" />
            <span className="text-base font-semibold tracking-tight">OMT Pulse</span>
          </Link>
          <nav className="flex items-center gap-2 sm:gap-3">
            <a href="#product" className="hidden text-sm text-muted-foreground hover:text-foreground md:inline" data-testid="link-product">
              Product
            </a>
            <a href="#features" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline" data-testid="link-features">
              Features
            </a>
            <a href="#audiences" className="hidden text-sm text-muted-foreground hover:text-foreground lg:inline" data-testid="link-audiences">
              Who it's for
            </a>
            <a href="#trust" className="hidden text-sm text-muted-foreground hover:text-foreground lg:inline" data-testid="link-trust">
              Trust
            </a>
            <a href="#get-started" className="hidden text-sm text-muted-foreground hover:text-foreground lg:inline" data-testid="link-get-started">
              Get started
            </a>
            <a href="#contact" className="hidden text-sm text-muted-foreground hover:text-foreground sm:inline" data-testid="link-contact">
              Contact
            </a>
            <Link href="/login">
              <Button size="sm" data-testid="button-signin">
                Sign in
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-primary/8 via-background to-background" />
        <div className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pb-20 sm:pt-20">
          <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
            <div className="text-center lg:text-left">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Control Room + field app — one ops system
              </div>
              <h1
                className="mb-5 text-4xl font-bold leading-tight tracking-tight sm:text-5xl lg:text-[3.25rem]"
                data-testid="text-hero-title"
              >
                Radio, SOS, fleet and access — the ops stack your team will{" "}
                <span className="text-primary">actually run.</span>
              </h1>
              <p
                className="mb-9 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg lg:mx-0 mx-auto"
                data-testid="text-hero-subtitle"
              >
                OMT Pulse connects Control Room and patrol: live group radio, one-tap panic,
                live incident maps, occurrence book, GPS fleet, access control and patrol
                clocking — searchable, real-time, built for South African security sites.
              </p>
              <div className="flex flex-col items-center justify-center gap-3 sm:flex-row lg:justify-start">
                <a href="#contact">
                  <Button size="lg" className="w-full sm:w-auto" data-testid="button-cta-contact">
                    Contact us
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </a>
              <Link href="/login">
                <Button size="lg" variant="outline" className="w-full sm:w-auto" data-testid="button-cta-signin">
                  Sign in
                </Button>
              </Link>
            </div>
            <p className="mt-4 text-xs text-muted-foreground lg:text-left text-center">
              App access is by invitation only — contact us or your organisation administrator.
            </p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <div className="relative w-full max-w-xl">
                <div className="absolute -inset-4 -z-10 rounded-3xl bg-primary/15 blur-2xl" />
                <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl shadow-primary/10">
                  <img
                    src="/marketing/control-room-busy.png"
                    alt="OMT Pulse Control Room — live incidents, team, fleet and occurrence book"
                    className="w-full object-cover object-top"
                    loading="eager"
                    decoding="async"
                  />
                </div>
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  Control Room — live incidents, team &amp; fleet at a glance
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <ProductPreviewsSection />

      <FieldGallerySection />

      {/* ── Capabilities ─────────────────────────────────────────────────── */}
      <section id="features" className="mx-auto max-w-6xl px-4 pb-16 sm:px-6 sm:pb-24">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            What your team runs on shift
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            From the Control Room desk to the officer&apos;s phone — modules that stay connected.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map(({ icon: Icon, title, body }) => (
            <div
              key={title}
              className="rounded-2xl border border-border bg-card p-6 hover-elevate"
              data-testid={`feature-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
            >
              <div className="mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <h3 className="mb-1.5 text-base font-semibold text-foreground">{title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Who it's for ─────────────────────────────────────────────────── */}
      <section id="audiences" className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Who it's for
            </h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Built for the teams that have to answer the radio at 2 a.m.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {AUDIENCES.map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex flex-col items-center rounded-2xl border border-border bg-background p-5 text-center hover-elevate"
                data-testid={`audience-${label.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <div className="mb-3 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="text-sm font-semibold text-foreground">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Trust & POPIA ─────────────────────────────────────────────────── */}
      <section id="trust" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Built for South African ops — and POPIA
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">
            OMT Pulse handles workforce location, visitor access records and incident evidence.
            We take that seriously: clear privacy terms, SA-first hosting, and operator agreements
            when your organisation goes live.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
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

      {/* ── How teams get started ─────────────────────────────────────────── */}
      <section id="get-started" className="border-y border-border bg-card/30">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
          <div className="mb-10 text-center">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">How teams get started</h2>
            <p className="mt-2 text-sm text-muted-foreground sm:text-base">
              Contact us for estate, site, or company pricing — we&apos;ll scope it to your team.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {GET_STARTED.map(({ step, title, body }) => (
              <div
                key={step}
                className="rounded-2xl border border-border bg-card p-6"
                data-testid={`get-started-${step}`}
              >
                <div className="mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
                  {step}
                </div>
                <h3 className="mb-1.5 text-base font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            ))}
          </div>
          <p className="mt-8 text-center text-sm text-muted-foreground">
            Trusted by security teams across South Africa — from estates and campuses to mine sites and response units.
          </p>
        </div>
      </section>

      {/* ── Get in touch — form + email + WhatsApp side-by-side ─────────── */}
      <section id="contact" className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-24">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Get in touch
          </h2>
          <p className="mt-2 text-sm text-muted-foreground sm:text-base">
            Demo requests, pricing, on-site rollouts — we'll respond within one
            business day.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Column 1 — Contact form (spans 2 cols on lg for more breathing room) */}
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8 lg:col-span-1">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <ArrowRight className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">Send us a message</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Tell us about your team and we'll be in touch.
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
                  We'll be in touch shortly at the email you provided.
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
                    placeholder="Tell us what you're trying to solve."
                    data-testid="input-contact-message"
                  />
                </div>
                {/* Honeypot — hidden from real users via off-screen positioning */}
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
                  {contact.isPending ? "Sending…" : "Send message"}
                </Button>
              </form>
            )}
          </div>

          {/* Column 2 — Email us */}
          <div className="flex flex-col rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Mail className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">Email us</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Reach the sales team directly — replies usually within a few
              hours during business days.
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

          {/* Column 3 — WhatsApp us */}
          <div className="flex flex-col rounded-2xl border border-border bg-card p-6 sm:p-8">
            <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MessageCircle className="h-5 w-5" />
            </div>
            <h3 className="mb-1 text-lg font-semibold">WhatsApp us</h3>
            <p className="mb-5 text-sm text-muted-foreground">
              Quick questions, demo bookings, after-hours pings — message us
              on WhatsApp.
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

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <img src={omtLogo} alt="OMT Pulse" className="h-5 w-5 rounded" loading="lazy" />
            <span>© {new Date().getFullYear()} OMT Pulse · An IntelAfri product</span>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
            <a
              href={INTELAFRI_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground"
              data-testid="link-footer-intelafri"
            >
              IntelAfri
            </a>
            <Link href="/privacy" className="hover:text-foreground" data-testid="link-footer-privacy">
              Privacy Policy
            </Link>
            <a href="#trust" className="hover:text-foreground" data-testid="link-footer-popia">
              POPIA
            </a>
            <a href={`mailto:${SALES_EMAIL}`} className="hover:text-foreground" data-testid="link-footer-email">
              {SALES_EMAIL}
            </a>
            <Link href="/login" className="hover:text-foreground" data-testid="link-footer-signin">
              Sign in
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
