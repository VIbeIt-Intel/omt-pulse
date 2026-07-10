import type { Organization } from "@shared/schema";

type WelcomeEmailParams = {
  org: Pick<Organization, "name">;
  adminFirstName: string;
  adminEmail: string;
  adminPassword: string;
};

function appLoginUrl(): string {
  const base = process.env.APP_BASE_URL?.trim() || process.env.VITE_APP_BASE_URL?.trim() || "https://pulse.intelafri.org";
  return `${base.replace(/\/$/, "")}/login`;
}

function buildWelcomeText(params: WelcomeEmailParams): string {
  const { org, adminFirstName, adminEmail, adminPassword } = params;
  const loginUrl = appLoginUrl();
  return [
    `Hi ${adminFirstName},`,
    "",
    `Welcome to OMT Pulse. Your organisation (${org.name}) is ready.`,
    "",
    "QUICK START",
    "───────────",
    "1. Sign in",
    `   Web: ${loginUrl}`,
    `   Email: ${adminEmail}`,
    `   Password: ${adminPassword}`,
    "",
    "2. Review User Admin — add supervisors, control room, patrol, and access controllers.",
    "3. Configure incident categories and premises under Admin settings.",
    "4. Enable push notifications when prompted on mobile.",
    "",
    "The Android app is available from IntelAfri — contact support@intelafri.org if you need the install link.",
    "",
    "Questions: support@intelafri.org",
    "",
    "— IntelAfri / OMT Pulse",
  ].join("\n");
}

function esc(s: string): string {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
}

function buildWelcomeHtml(params: WelcomeEmailParams): string {
  const { org, adminFirstName, adminEmail, adminPassword } = params;
  const loginUrl = appLoginUrl();
  return `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">
      <p>Hi ${esc(adminFirstName)},</p>
      <p>Welcome to <strong>OMT Pulse</strong>. Your organisation (<strong>${esc(org.name)}</strong>) is ready.</p>
      <h3 style="margin-bottom:0.25em">Quick start</h3>
      <ol>
        <li><strong>Sign in</strong><br/>
          Web: <a href="${esc(loginUrl)}">${esc(loginUrl)}</a><br/>
          Email: ${esc(adminEmail)}<br/>
          Password: ${esc(adminPassword)}
        </li>
        <li>Review <strong>User Admin</strong> — add supervisors, control room, patrol, and access controllers.</li>
        <li>Configure incident categories and premises under Admin settings.</li>
        <li>Enable push notifications when prompted on mobile.</li>
      </ol>
      <p>The Android app is available from IntelAfri — contact <a href="mailto:support@intelafri.org">support@intelafri.org</a> if you need the install link.</p>
      <p style="color:#666;font-size:0.9em">— IntelAfri / OMT Pulse</p>
    </div>
  `;
}

/** Best-effort welcome email. Returns true when SendGrid accepted the message. */
export async function sendArchonWelcomeEmail(params: WelcomeEmailParams): Promise<boolean> {
  if (!process.env.SENDGRID_API_KEY) {
    console.log("[archon] SENDGRID_API_KEY not set — skipping welcome email");
    return false;
  }
  try {
    const sgMail = (await import("@sendgrid/mail")).default;
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: params.adminEmail,
      from: process.env.SENDGRID_FROM_EMAIL || "sales@intelafri.org",
      subject: `Welcome to OMT Pulse — ${params.org.name}`,
      text: buildWelcomeText(params),
      html: buildWelcomeHtml(params),
    });
    console.log(`[archon] welcome email sent to ${params.adminEmail}`);
    return true;
  } catch (err: unknown) {
    console.error("[archon] welcome email failed:", err instanceof Error ? err.message : err);
    return false;
  }
}
