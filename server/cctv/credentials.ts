import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const SALT = "omt-pulse-cctv-v1";

function deriveKey(): Buffer {
  const secret = process.env.SESSION_SECRET || "fallback-secret-change-in-production";
  return scryptSync(secret, SALT, 32);
}

/** Encrypt a camera password for storage (reversible — needed for RTSP). */
export function encryptCameraPassword(plain: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${enc.toString("base64url")}`;
}

export function decryptCameraPassword(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid encrypted password");
  const key = deriveKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB64, "base64url"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64url"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64url")),
    decipher.final(),
  ]);
  return plain.toString("utf8");
}
