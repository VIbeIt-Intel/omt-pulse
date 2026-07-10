import { PLAY_STORE_URL, PLAY_TESTING_JOIN_URL } from "@/lib/site-links";
import { OMT_APP_ORIGIN, appInviteUrl, appLoginUrl as sharedLoginUrl } from "@shared/app-url";

export type OnboardingUserInfo = {
  firstName: string;
  email: string;
  /** @deprecated Legacy password share — invite flow uses inviteUrl instead */
  password?: string;
  inviteUrl?: string;
  orgName?: string | null;
};

export function appLoginUrl(): string {
  const base = import.meta.env.VITE_APP_BASE_URL?.trim();
  return base ? `${base.replace(/\/$/, "")}/login` : sharedLoginUrl();
}

/** IntelAfri-only message — invite link + Android install link when configured. */
export function buildArchonOnboardingMessage(info: OnboardingUserInfo): string {
  const installLine = PLAY_TESTING_JOIN_URL
    ? `1) Install OMT Pulse (Android phone): ${PLAY_TESTING_JOIN_URL}`
    : PLAY_STORE_URL
      ? `1) Install OMT Pulse (Android phone): ${PLAY_STORE_URL}`
      : "1) Install OMT Pulse — contact support@intelafri.org for the Android install link.";

  const activateLines = info.inviteUrl
    ? [
        "2) Activate your account (set your password):",
        `   ${info.inviteUrl}`,
        `   (For ${info.email} — expires in 72 hours, single use.)`,
        "",
        `3) Or sign in on the web after activation: ${appLoginUrl()}`,
      ]
    : info.password
      ? [
          "2) Open the app and sign in:",
          `   Email: ${info.email}`,
          `   Password: ${info.password}`,
          "",
          `Or sign in on the web: ${appLoginUrl()}`,
        ]
      : [
          "2) Ask IntelAfri for your invite link to activate your account.",
          `   Web login (after activation): ${appLoginUrl()}`,
        ];

  return [
    `Hi ${info.firstName},`,
    "",
    `You're set up on OMT Pulse (${info.orgName ?? "your organisation"}).`,
    "",
    installLine,
    ...activateLines,
    "",
    "Allow notifications when asked.",
    "Questions: support@intelafri.org",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Org-admin message — login only; no install links (IntelAfri controls distribution). */
export function buildOrgAdminAccessMessage(info: OnboardingUserInfo): string {
  if (info.inviteUrl) {
    return [
      `Hi ${info.firstName},`,
      "",
      `You're set up on OMT Pulse (${info.orgName ?? "your organisation"}).`,
      "",
      "1) Activate your account:",
      `   ${info.inviteUrl}`,
      "",
      `2) After activation, sign in at ${appLoginUrl()}`,
      "",
      "Mobile app installation is arranged by IntelAfri — contact support@intelafri.org if you need the Android app.",
    ].join("\n");
  }
  const passwordLine = info.password ? `   Password: ${info.password}` : "";
  return [
    `Hi ${info.firstName},`,
    "",
    `You're set up on OMT Pulse (${info.orgName ?? "your organisation"}).`,
    "",
    "1) Sign in:",
    `   ${appLoginUrl()}`,
    `   Email: ${info.email}`,
    passwordLine,
    "",
    "2) Allow notifications when prompted. Use the bell icon in User Admin to send an alert-setup link if needed.",
    "",
    "Mobile app installation is arranged by IntelAfri — contact support@intelafri.org if you need the Android app.",
    "Questions: your organisation administrator or support@intelafri.org",
  ]
    .filter(Boolean)
    .join("\n");
}

export function archonInstallUrl(): string {
  return PLAY_TESTING_JOIN_URL || PLAY_STORE_URL || "";
}

export { OMT_APP_ORIGIN, appInviteUrl };
