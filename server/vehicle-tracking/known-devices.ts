/**
 * Phase-1 registry of devices we know about before first DB registration.
 * IMEI 866656089774212 → Command group.
 */
export const KNOWN_TRACKER_DEVICES: Record<
  string,
  { note: string; targetCommandName: string }
> = {
  "866656089774212": {
    note: "Ford Kuga OBD GPS tracker",
    targetCommandName: "Central / Head Office",
  },
};

export function knownDeviceNote(imei: string | null | undefined): string | null {
  if (!imei) return null;
  const entry = KNOWN_TRACKER_DEVICES[imei];
  if (!entry) return null;
  return `${entry.note} (target command: ${entry.targetCommandName})`;
}
