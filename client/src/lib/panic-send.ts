import { apiRequest } from "@/lib/queryClient";
import {
  acquirePanicLocationForSend,
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
  incidentId?: number | null;
  deduped?: boolean;
};

let panicSendInFlight: Promise<PanicSendOutcome> | null = null;

export async function postPanicAlert(loc: PanicLocationResult): Promise<PanicSendOutcome> {
  if (panicSendInFlight) return panicSendInFlight;

  const lat = hasPanicCoordinates(loc) ? loc.lat : undefined;
  const lng = hasPanicCoordinates(loc) ? loc.lng : undefined;

  panicSendInFlight = (async () => {
    try {
      const res = await apiRequest("POST", "/api/panic", { lat, lng });
      const body = (await res.json()) as {
        sent: number;
        found: number;
        incidentId?: number | null;
        deduped?: boolean;
      };
      return { sent: body.sent, found: body.found, loc, incidentId: body.incidentId, deduped: body.deduped };
    } finally {
      panicSendInFlight = null;
    }
  })();

  return panicSendInFlight;
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
  const { sent, found, loc, deduped } = outcome;

  if (deduped) {
    return {
      title: "🆘 Panic already active",
      description: appendPanicLocationNote(
        "Your team was already alerted. Only one panic is sent until you close it.",
        loc,
      ),
    };
  }

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
      `Push notification delivered to ${sent} device${sent === 1 ? "" : "s"}. Do not press again.`,
      loc,
    ),
  };
}

export async function probePanicLocation(): Promise<PanicLocationResult> {
  return quickPanicLocationCheck();
}

export async function probePanicLocationForSend(): Promise<PanicLocationResult> {
  return acquirePanicLocationForSend();
}
