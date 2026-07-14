/** Canonical production origin for OMT Pulse web app. */
export const OMT_APP_ORIGIN = "https://omtpulse.com";

export function appLoginUrl(): string {
  return `${OMT_APP_ORIGIN}/login`;
}

export function appInviteUrl(token: string): string {
  return `${OMT_APP_ORIGIN}/invite?token=${encodeURIComponent(token)}`;
}
