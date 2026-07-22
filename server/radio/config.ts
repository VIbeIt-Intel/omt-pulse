/** LiveKit media plane — audio is never stored by OMT Pulse. */

export type LiveKitConfig = {
  url: string;
  apiKey: string;
  apiSecret: string;
};

export function getLiveKitConfig(): LiveKitConfig | null {
  const url = (process.env.LIVEKIT_URL || "").trim();
  const apiKey = (process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = (process.env.LIVEKIT_API_SECRET || "").trim();
  if (!url || !apiKey || !apiSecret) return null;
  return { url, apiKey, apiSecret };
}

export function isRadioConfigured(): boolean {
  return getLiveKitConfig() != null;
}

/** Stable LiveKit room id for a Pulse Group (command). */
export function radioRoomName(orgId: string, commandId: number): string {
  const safeOrg = orgId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48) || "org";
  return `omt-${safeOrg}-g-${commandId}`;
}
