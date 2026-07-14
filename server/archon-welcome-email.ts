import type { Organization } from "@shared/schema";
import { appInviteUrl } from "@shared/app-url";
import { resolveAndroidInstallUrl } from "./user-invite";
import { sendAppEmail, type SendMailResult } from "./mail";

export type WelcomeEmailParams = {
  org: Pick<Organization, "name">;
  adminFirstName: string;
  adminEmail: string;
  inviteToken: string;
};

function buildWelcomeText(params: WelcomeEmailParams): string {
  const { org, adminFirstName, adminEmail, inviteToken } = params;
  const inviteUrl = appInviteUrl(inviteToken);
  const installUrl = resolveAndroidInstallUrl();
  const installBlock = installUrl
    ? [
        "2. Install OMT Pulse on your Android phone:",
        `   ${installUrl}`,
        "",
        "3. Activate your account (set your password):",
      ]
    : [
        "2. Install OMT Pulse on your Android phone:",
        "   Contact support@intelafri.org for the Android install link.",
        "",
        "3. Activate your account (set your password):",
      ];

  return [
    `Hi ${adminFirstName},`,
    "",
    `Welcome to OMT Pulse. Your organisation (${org.name}) is ready.`,
    "",
    "GET STARTED",
    "───────────",
    "1. On your computer or phone browser, open your personal invite link:",
    `   ${inviteUrl}`,
    `   (This link is for ${adminEmail} only, expires in 72 hours, and works once.)`,
    "",
    ...installBlock,
    `   Open the invite link above, choose a password, then sign in.`,
    "",
    "4. In User Admin, add your team (control room, patrol, access controllers, etc.).",
    "5. Configure incident categories and premises under Admin settings.",
    "6. Allow push notifications when prompted.",
    "",
    `Web login (after activation): https://omtpulse.com/login`,
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
  const { org, adminFirstName, adminEmail, inviteToken } = params;
  const inviteUrl = appInviteUrl(inviteToken);
  const installUrl = resolveAndroidInstallUrl();
  const installStep = installUrl
    ? `<li><strong>Install OMT Pulse</strong> on your Android phone:<br/><a href="${esc(installUrl)}">${esc(installUrl)}</a></li>`
    : `<li><strong>Install OMT Pulse</strong> on your Android phone — contact <a href="mailto:support@intelafri.org">support@intelafri.org</a> for the install link.</li>`;

  return `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p>Hi ${esc(adminFirstName)},</p>
      <p>Welcome to <strong>OMT Pulse</strong>. Your organisation (<strong>${esc(org.name)}</strong>) is ready.</p>
      <h3 style="margin-bottom:0.25em">Get started</h3>
      <ol>
        <li><strong>Your personal invite link</strong> (for ${esc(adminEmail)} only — expires in 72 hours, single use):<br/>
          <a href="${esc(inviteUrl)}">${esc(inviteUrl)}</a>
        </li>
        ${installStep}
        <li><strong>Activate your account</strong> — open the invite link, choose a password, then you&apos;re signed in.</li>
        <li>In <strong>User Admin</strong>, add your team.</li>
        <li>Configure incident categories and premises.</li>
        <li>Allow push notifications when prompted.</li>
      </ol>
      <p>After activation, sign in at <a href="https://omtpulse.com/login">https://omtpulse.com/login</a></p>
      <p>Questions: <a href="mailto:support@intelafri.org">support@intelafri.org</a></p>
      <p style="color:#666;font-size:0.9em">— IntelAfri / OMT Pulse</p>
    </div>
  `;
}

export type WelcomeEmailResult = SendMailResult;

/** Best-effort welcome email via Resend. */
export async function sendArchonWelcomeEmail(params: WelcomeEmailParams): Promise<WelcomeEmailResult> {
  return sendAppEmail({
    to: params.adminEmail,
    subject: `Welcome to OMT Pulse — ${params.org.name}`,
    text: buildWelcomeText(params),
    html: buildWelcomeHtml(params),
  });
}

export { buildWelcomeText };
