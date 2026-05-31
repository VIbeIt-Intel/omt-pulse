import { Link } from "wouter";
import omtLogo from "@/assets/omt-logo-v2.png";

const CONTACT_EMAIL = "sales@intelafri.org";
const EFFECTIVE_DATE = "31 May 2026";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <img src={omtLogo} alt="OMT Pulse" className="h-9 w-9 object-contain" />
            <div>
              <p className="font-semibold leading-tight">OMT Pulse</p>
              <p className="text-xs text-muted-foreground">Privacy Policy</p>
            </div>
          </div>
          <Link href="/login" className="text-sm text-primary hover:underline" data-testid="link-privacy-back-login">
            Back to sign in
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <article className="prose prose-neutral dark:prose-invert max-w-none prose-headings:scroll-mt-20">
          <h1>Privacy Policy</h1>
          <p className="text-muted-foreground not-prose text-sm">
            Effective date: {EFFECTIVE_DATE}
          </p>

          <p>
            This Privacy Policy describes how <strong>IntelAfri (Pty) Ltd</strong> (“IntelAfri”, “we”, “us”)
            collects, uses, and protects personal information when you use <strong>OMT Pulse</strong> — our
            occurrence management application — via the website at{" "}
            <a href="https://omtpulse.com">omtpulse.com</a>, the Android app, or an installed web app (PWA).
          </p>

          <h2>1. Who we are</h2>
          <p>
            OMT Pulse is operated by IntelAfri (Pty) Ltd, Johannesburg, South Africa. For privacy enquiries,
            contact us at{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>

          <h2>2. Information we collect</h2>
          <p>Depending on how you use OMT Pulse, we may process:</p>
          <ul>
            <li>
              <strong>Account data</strong> — name, email address, organisation, role, and password (stored
              securely hashed).
            </li>
            <li>
              <strong>Incident &amp; operational data</strong> — incident reports, descriptions, categories,
              locations, timestamps, assignments, audit logs, and related attachments you upload.
            </li>
            <li>
              <strong>Location data</strong> — GPS coordinates and location names when you report incidents,
              use live incident navigation, or share your position while the app is in use. We do{" "}
              <strong>not</strong> collect location in the background when the app is closed.
            </li>
            <li>
              <strong>Media</strong> — photos, audio recordings, and files you attach to incidents (with your
              permission).
            </li>
            <li>
              <strong>Device &amp; usage data</strong> — push notification tokens, browser or app type, and
              technical logs needed to operate and secure the service.
            </li>
            <li>
              <strong>Communications</strong> — in-app chat messages and support or contact form submissions.
            </li>
          </ul>

          <h2>3. How we use your information</h2>
          <p>We use personal information to:</p>
          <ul>
            <li>Provide, authenticate, and secure the OMT Pulse service for your organisation.</li>
            <li>Record, assign, and manage security incidents and live responses.</li>
            <li>Display maps and navigation during active incidents (via Google Maps).</li>
            <li>Send push notifications for alerts such as panic, live incidents, and severity updates.</li>
            <li>Maintain audit trails and analytics for authorised supervisors and administrators.</li>
            <li>Improve reliability, prevent abuse, and comply with legal obligations.</li>
          </ul>

          <h2>4. Permissions (mobile app)</h2>
          <p>The Android app may request:</p>
          <ul>
            <li><strong>Internet</strong> — required; OMT Pulse loads and syncs data with our servers.</li>
            <li><strong>Location (while using the app)</strong> — incident reporting and live navigation.</li>
            <li><strong>Camera &amp; microphone</strong> — optional; for photo and audio attachments.</li>
            <li><strong>Notifications</strong> — optional; for operational alerts.</li>
          </ul>
          <p>
            You can deny optional permissions in device settings; some features may not work without them.
            We do not request background location access in the current app version.
          </p>

          <h2>5. Online service</h2>
          <p>
            OMT Pulse requires an internet connection to sign in and sync data. Cached content in the browser
            may allow limited offline viewing of previously loaded pages, but creating or updating incidents
            requires connectivity.
          </p>

          <h2>6. How we share information</h2>
          <p>We do not sell your personal information. We may share data with:</p>
          <ul>
            <li>
              <strong>Your organisation</strong> — other authorised users in the same organisation and
              command structure, according to role permissions.
            </li>
            <li>
              <strong>Service providers</strong> — hosting, database, file storage, email, maps (Google),
              and push delivery (Firebase / Google) where needed to run the service.
            </li>
            <li>
              <strong>Legal requirements</strong> — when required by law or to protect rights, safety, and
              security.
            </li>
          </ul>

          <h2>7. Storage &amp; security</h2>
          <p>
            Data is stored on secure servers. We use encryption in transit (HTTPS), access controls, and
            organisational measures appropriate to the sensitivity of incident data. No method of transmission
            over the internet is 100% secure; we work to protect your information and review our practices
            regularly.
          </p>

          <h2>8. Retention</h2>
          <p>
            We retain personal information for as long as your organisation uses OMT Pulse and as needed for
            operational, audit, and legal purposes. Your organisation’s administrators may export or manage
            records according to internal policy. Contact us to discuss deletion requests where applicable.
          </p>

          <h2>9. Your rights</h2>
          <p>
            Under the Protection of Personal Information Act (POPIA) and applicable law, you may have rights
            to access, correct, or delete personal information we hold about you, object to certain processing,
            or lodge a complaint with the Information Regulator (South Africa). Contact{" "}
            <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a> to exercise these rights.
          </p>

          <h2>10. Children</h2>
          <p>
            OMT Pulse is intended for professional security and operational use by organisations. It is not
            directed at children under 18.
          </p>

          <h2>11. Changes</h2>
          <p>
            We may update this policy from time to time. The effective date at the top will change when we do.
            Continued use of OMT Pulse after updates means you accept the revised policy.
          </p>

          <h2>12. Contact</h2>
          <p>
            <strong>IntelAfri (Pty) Ltd</strong>
            <br />
            Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <br />
            Web: <a href="https://omtpulse.com">https://omtpulse.com</a>
          </p>
        </article>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} IntelAfri (Pty) Ltd · OMT Pulse
      </footer>
    </div>
  );
}
