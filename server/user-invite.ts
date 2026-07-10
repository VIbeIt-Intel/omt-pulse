import crypto from "crypto";
import bcrypt from "bcrypt";

/** Invite links expire after 72 hours. */
export const INVITE_EXPIRY_MS = 72 * 60 * 60 * 1000;

const SALT_ROUNDS = 10;

export function createInviteToken(): { token: string; expiresAt: Date } {
  return {
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
  };
}

/** Unusable random password until the user sets their own via onboarding. */
export async function hashPlaceholderPassword(): Promise<string> {
  return bcrypt.hash(crypto.randomBytes(32).toString("hex"), SALT_ROUNDS);
}

/** Android install link — same env vars as the client Onboarding Share dialog. */
export function resolveAndroidInstallUrl(): string {
  return (
    process.env.VITE_PLAY_TESTING_JOIN_URL?.trim() ||
    process.env.PLAY_TESTING_JOIN_URL?.trim() ||
    process.env.VITE_PLAY_STORE_URL?.trim() ||
    process.env.PLAY_STORE_URL?.trim() ||
    ""
  );
}
