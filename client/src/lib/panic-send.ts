import { apiRequest } from "@/lib/queryClient";
import {
  acquirePanicLocation,
  appendPanicLocationNote,
  hasPanicCoordinates,
  panicLocationWarning,
  quickPanicLocationCheck,
  type PanicLocationIssue,
  type PanicLocationResult,
} from "@/lib/panic-location";

export type PanicSendOutcome = {
  sent: number;
  found: number;
  loc: PanicLocationResult;
};

export async function postPanicAlert(loc: PanicLocationResult): Promise<PanicSendOutcome> {
  const lat = hasPanicCoordinates(loc) ? loc.lat : undefined;
  const lng = hasPanicCoordinates(loc) ? loc.lng : undefined;
  const res = await apiRequest("POST", "/api/panic", { lat, lng });
  const { sent, found } = (await res.json()) as { sent: number; found: number };
  return { sent, found, loc };
}

export function panicLocationOffTitle(issue?: PanicLocationIssue): string {
  if (issue === "denied") return "Location is turned off";
  return "Location not available";
}

export function panicLocationOffBody(issue?: PanicLocationIssue): string {
  return panicLocationWarning(issue);
}

export function buildPanicSentToast(outcome: PanicSendOutcome): {
  title: string;
  description: string;
  variant?: "destructive";
} {
  const { sent, found, loc } = outcome;
  if (found === 0) {
    return {
      title: "🆘 Panic alert stored",
      description: appendPanicLocationNote(
        "No team members have push notifications enabled.",
        loc,
      ),
      variant: "destructive",
    };
  }
  if (sent === 0) {
    return {
      title: "🆘 Panic alert sent",
      description: appendPanicLocationNote(
        "Alert dispatched — delivery may be delayed on some devices.",
        loc,
      ),
    };
  }
  return {
    title: "🆘 Panic alert sent",
    description: appendPanicLocationNote(
      `Push notification delivered to ${sent} device${sent === 1 ? "" : "s"}.`,
      loc,
    ),
  };
}

/** Fast UI probe when opening SOS or returning from Settings (~3s max). */
export async function probePanicLocation(): Promise<PanicLocationResult> {
  return quickPanicLocationCheck();
}

/** Full-accuracy GPS when actually sending SOS (may take longer). */
export async function probePanicLocationForSend(): Promise<PanicLocationResult> {
  return acquirePanicLocation();
}
