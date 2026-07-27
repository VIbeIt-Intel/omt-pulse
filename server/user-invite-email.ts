import { appInviteUrl } from "@shared/app-url";
import { resolveAndroidInstallUrl } from "./user-invite";
import { sendAppEmail, type SendMailResult } from "./mail";

export type TeamInviteEmailParams = {
  orgName: string;
  firstName: string;
  email: string;
  inviteToken: string;
  invitedByName?: string;
};

function esc(s: string): string {
  return String(s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c));
}

function buildText(params: TeamInviteEmailParams): string {
  const inviteUrl = appInviteUrl(params.inviteToken);
  const installUrl = resolveAndroidInstallUrl();
  const by = params.invitedByName?.trim();
  const installLines = installUrl
    ? [`2. Install OMT Pulse on Android (optional):`, `   ${installUrl}`, ``]
    : [];

  return [
    `Hi ${params.firstName},`,
    "",
    by
      ? `${by} has invited you to join ${params.orgName} on OMT Pulse.`
      : `You have been invited to join ${params.orgName} on OMT Pulse.`,
    "",
    "GET STARTED",
    "───────────",
    "1. Open your personal invite link (expires in 72 hours, single use):",
    `   ${inviteUrl}`,
    "",
    ...installLines,
    "Then choose a password and sign in.",
    "",
    "Web login after activation: https://omtpulse.com/login",
    "",
    "Questions: support@intelafri.org",
    "",
    "— IntelAfri / OMT Pulse",
  ].join("\n");
}

function buildHtml(params: TeamInviteEmailParams): string {
  const inviteUrl = appInviteUrl(params.inviteToken);
  const installUrl = resolveAndroidInstallUrl();
  const by = params.invitedByName?.trim();
  const intro = by
    ? `<strong>${esc(by)}</strong> has invited you to join <strong>${esc(params.orgName)}</strong> on OMT Pulse.`
    : `You have been invited to join <strong>${esc(params.orgName)}</strong> on OMT Pulse.`;
  const installLi = installUrl
    ? `<li><strong>Install OMT Pulse</strong> on Android (optional):<br/><a href="${esc(installUrl)}">${esc(installUrl)}</a></li>`
    : "";

  return `
    <div style="font-family:system-ui,sans-serif;line-height:1.5;color:#111;max-width:560px">
      <p>Hi ${esc(params.firstName)},</p>
      <p>${intro}</p>
      <h3 style="margin-bottom:0.25em">Get started</h3>
      <ol>
        <li><strong>Your personal invite link</strong> (expires in 72 hours, single use):<br/>
          <a href="${esc(inviteUrl)}">${esc(inviteUrl)}</a>
        </li>
        ${installLi}
        <li><strong>Activate</strong> — open the link, choose a password, then sign in.</li>
      </ol>
      <p>After activation: <a href="https://omtpulse.com/login">https://omtpulse.com/login</a></p>
      <p>Questions: <a href="mailto:support@intelafri.org">support@intelafri.org</a></p>
      <p style="color:#666;font-size:0.9em">— IntelAfri / OMT Pulse</p>
    </div>
  `;
}

/** Invite a team member created in User Admin. */
export async function sendTeamInviteEmail(params: TeamInviteEmailParams): Promise<SendMailResult> {
  return sendAppEmail({
    to: params.email,
    subject: `You're invited to OMT Pulse — ${params.orgName}`,
    text: buildText(params),
    html: buildHtml(params),
  });
}
