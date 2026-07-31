import { Link } from "wouter";
import omtLogo from "@/assets/omt-logo-v2.png";
import { DEFAULT_RETENTION_DAYS } from "@shared/retention";

const CONTACT_EMAIL = "support@intelafri.org";
const EFFECTIVE_DATE = "31 July 2026";

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
          <p className="not-prose font-semibold">OMT Pulse</p>
          <p className="text-muted-foreground not-prose text-sm">
            Effective date: {EFFECTIVE_DATE}
          </p>

          <p>
            IntelAfri (Pty) Ltd (“IntelAfri”, “we”, “us”, “our”) operates the OMT Pulse mobile application
            and web platform (“OMT Pulse” or “the App”). This Privacy Policy explains how we collect, use,
            disclose, and protect your information when you use OMT Pulse.
          </p>
          <p>
            We are committed to protecting your privacy and complying with the Protection of Personal
            Information Act (POPIA) of South Africa. Where your organisation is the responsible party for
            site visitors or employees, IntelAfri processes that personal information as an operator on
            their instructions.
          </p>

          <h2>1. Information We Collect</h2>
          <p>
            <strong>Account and workforce information:</strong>
          </p>
          <ul>
            <li>Account details (name, email, phone number, role, posting/home address where provided)</li>
            <li>Device sign-in and workstation session information</li>
            <li>Precise GPS location while using live incident, navigation, panic, or patrol features</li>
          </ul>
          <p>
            <strong>Security operations information:</strong>
          </p>
          <ul>
            <li>Incident reports, notes, chat messages, and evidence (photos, videos, audio)</li>
            <li>
              Access-control / visitor records (name, ID or licence details, contact number, company,
              purpose of visit, person and vehicle photos, vehicle registration details)
            </li>
            <li>Patrol routes, checkpoint check-ins (including photos and GPS), and patrol track points</li>
            <li>Fleet / vehicle tracker identifiers, assigned operators, and GPS position history</li>
            <li>CCTV camera configuration and AI detection events (labels, confidence, optional snapshots)</li>
            <li>Audit logs of administrative and security actions</li>
          </ul>
          <p>
            <strong>Automatically collected information:</strong>
          </p>
          <ul>
            <li>Device information (model, OS version, push notification identifiers)</li>
            <li>Usage data needed to operate and secure the App</li>
          </ul>

          <h2>2. How We Use Your Information</h2>
          <p>We use your information to:</p>
          <ul>
            <li>Provide OMT Pulse (incident logging, access control, patrol, fleet, CCTV, live response)</li>
            <li>Enable real-time team coordination and officer safety features</li>
            <li>Generate operational analytics for authorised organisation users</li>
            <li>Maintain audit trails for security investigations and compliance</li>
            <li>Communicate with you (notifications, support)</li>
            <li>Apply retention and deletion rules described in this policy</li>
          </ul>

          <h2>3. How We Share Your Information</h2>
          <p>
            We <strong>do not</strong> sell your personal information.
          </p>
          <p>We may share data only in these cases:</p>
          <ul>
            <li>With your organisation / Command members (as required for security operations)</li>
            <li>With authorised administrators in your organisation</li>
            <li>When legally required (court order, POPIA request, etc.)</li>
            <li>
              With trusted service providers (hosting on Xneelo in South Africa; Google Cloud for object
              storage and maps where configured) under appropriate contracts
            </li>
          </ul>
          <p>Primary application hosting remains in South Africa where possible.</p>

          <h2>4. Data Storage and Security</h2>
          <ul>
            <li>Your operational data is hosted on secure servers in South Africa (Xneelo).</li>
            <li>We use encryption in transit and appropriate access controls at rest.</li>
            <li>Access is role-based and audited.</li>
            <li>Evidence and visitor media are stored in secured object storage with access controls.</li>
          </ul>

          <h2>5. Your Rights under POPIA</h2>
          <p>You have the right to:</p>
          <ul>
            <li>Access your personal information</li>
            <li>Correct or update inaccurate information</li>
            <li>Request deletion of your data (subject to legal and security obligations)</li>
            <li>Object to processing of your data</li>
            <li>Lodge a complaint with the Information Regulator (South Africa)</li>
          </ul>
          <p>
            To exercise these rights, email:{" "}
            <a href={`mailto:${CONTACT_EMAIL}?subject=POPIA%20data%20subject%20request`}>
              {CONTACT_EMAIL}
            </a>{" "}
            with the subject “POPIA data subject request”, your full name, organisation (if applicable),
            and the right you wish to exercise. We aim to respond within a reasonable period as required
            by POPIA. Site visitors should also contact the organisation that recorded their visit.
          </p>

          <h2>6. Retention of Information</h2>
          <p>
            We keep personal information only as long as necessary for the purposes described, for our
            clients’ legitimate security interests, or as required by law. Platform default retention for
            operational telemetry is:
          </p>
          <ul>
            <li>
              Access / visitor logs (including ID or licence scan data and related photos):{" "}
              <strong>{DEFAULT_RETENTION_DAYS.accessLogs} days</strong>
            </li>
            <li>
              Patrol GPS track points: <strong>{DEFAULT_RETENTION_DAYS.patrolTrackPoints} days</strong>
            </li>
            <li>
              Patrol checkpoint check-ins (including photos):{" "}
              <strong>{DEFAULT_RETENTION_DAYS.patrolCheckpointLogs} days</strong>
            </li>
            <li>
              Fleet tracker position history:{" "}
              <strong>{DEFAULT_RETENTION_DAYS.trackerPositions} days</strong>
            </li>
            <li>
              CCTV AI detection events: <strong>{DEFAULT_RETENTION_DAYS.cctvAiEvents} days</strong>{" "}
              (snapshot image files are also pruned on a short operational window)
            </li>
          </ul>
          <p>
            A client organisation may configure different retention periods (within reasonable bounds)
            for their tenancy. Incident records, evidence attachments, chat related to incidents, and
            audit trails are retained for security investigation and compliance purposes until the
            organisation deletes them or the organisation account is closed, unless a shorter period is
            required by law or agreed in writing.
          </p>
          <p>
            Expired operational records are automatically deleted by the platform. Associated visitor and
            checkpoint media files are removed on a best-effort basis when their parent records are purged.
          </p>

          <h2>7. Children&apos;s Privacy</h2>
          <p>
            OMT Pulse is not intended for children under 18. We do not knowingly collect data from children.
          </p>

          <h2>8. Changes to this Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. The updated version will be posted here
            with a new effective date.
          </p>

          <h2>9. Contact Us</h2>
          <p>
            <strong>IntelAfri (Pty) Ltd</strong>
            <br />
            Privacy Officer: Anton Kruger
            <br />
            Email: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            <br />
            Website: <a href="https://omtpulse.com">https://omtpulse.com</a>
          </p>
        </article>
      </main>

      <footer className="border-t border-border py-6 text-center text-xs text-muted-foreground">
        © {new Date().getFullYear()} IntelAfri (Pty) Ltd · OMT Pulse
      </footer>
    </div>
  );
}
