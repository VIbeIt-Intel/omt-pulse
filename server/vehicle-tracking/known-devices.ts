export type KnownTrackerDevice = {
  note: string;
  targetCommandName: string;
  simPhone?: string;
};

/**
 * Phase-1 registry of devices we know about before first DB registration.
 */
export const KNOWN_TRACKER_DEVICES: Record<string, KnownTrackerDevice> = {
  "866656089774212": {
    note: "Ford Kuga OBD GPS tracker",
    targetCommandName: "Central / Head Office",
  },
  "7026321440": {
    note: "SinoTrack ST-915(M)",
    targetCommandName: "Central / Head Office",
    simPhone: "0657690687",
  },
};

export function knownDeviceNote(imei: string | null | undefined): string | null {
  if (!imei) return null;
  const entry = KNOWN_TRACKER_DEVICES[imei];
  if (!entry) return null;
  return `${entry.note} (target command: ${entry.targetCommandName})`;
}
