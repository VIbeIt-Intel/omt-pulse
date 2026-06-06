import { PLAY_STORE_URL, PLAY_TESTING_JOIN_URL } from "@/lib/site-links";

export type OnboardingUserInfo = {
  firstName: string;
  email: string;
  password?: string;
  orgName?: string | null;
};

export function appLoginUrl(): string {
  const base = import.meta.env.VITE_APP_BASE_URL?.trim() || (typeof window !== "undefined" ? window.location.origin : "");
  return `${base.replace(/\/$/, "")}/login`;
}

/** IntelAfri-only message — includes Android install link when configured. */
export function buildArchonOnboardingMessage(info: OnboardingUserInfo): string {
  const installLine = PLAY_TESTING_JOIN_URL
    ? `1) Install OMT Pulse (Android phone): ${PLAY_TESTING_JOIN_URL}`
    : PLAY_STORE_URL
      ? `1) Install OMT Pulse (Android phone): ${PLAY_STORE_URL}`
      : "1) Install OMT Pulse — use the Android link IntelAfri sent you separately.";
  const passwordLine = info.password ? `   Password: ${info.password}` : "";
  return [
    `Hi ${info.firstName},`,
    "",
    `You're set up on OMT Pulse (${info.orgName ?? "your organisation"}). On your Android phone:`,
    "",
    installLine,
    "2) Open the app and sign in:",
    `   Email: ${info.email}`,
    passwordLine,
    "",
    `Or sign in on the web: ${appLoginUrl()}`,
    "",
    "Use the same Gmail on your phone as that email. Allow notifications when asked.",
    "Questions: support@intelafri.org",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Org-admin message — login only; no install links (IntelAfri controls distribution). */
export function buildOrgAdminAccessMessage(info: OnboardingUserInfo): string {
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
