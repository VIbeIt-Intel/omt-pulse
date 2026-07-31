/**
 * In-memory private (1:1) radio call registry.
 * Separate from group radio rooms — group channel is never reused for private PTT.
 */

export type PrivateCallStatus = "ringing" | "active" | "ended";

export type PrivateCall = {
  id: string;
  orgId: string;
  roomName: string;
  callerId: string;
  callerName: string;
  calleeId: string;
  calleeName: string;
  incidentId: number | null;
  status: PrivateCallStatus;
  startedAt: number;
  /** Auto-end ringing if not accepted. */
  ringExpiresAt: number;
};

const RING_TTL_MS = 60_000;
const ACTIVE_TTL_MS = 60 * 60 * 1000;

const calls = new Map<string, PrivateCall>();

function prune(): void {
  const now = Date.now();
  for (const [id, call] of calls) {
    if (call.status === "ended") {
      calls.delete(id);
      continue;
    }
    if (call.status === "ringing" && call.ringExpiresAt <= now) {
      calls.delete(id);
      continue;
    }
    if (call.status === "active" && now - call.startedAt > ACTIVE_TTL_MS) {
      calls.delete(id);
    }
  }
}

export function findActivePrivateCallForUser(userId: string): PrivateCall | null {
  prune();
  for (const call of calls.values()) {
    if (call.status === "ended") continue;
    if (call.callerId === userId || call.calleeId === userId) return call;
  }
  return null;
}

export function getPrivateCall(id: string): PrivateCall | null {
  prune();
  return calls.get(id) ?? null;
}

export function startPrivateCall(input: {
  orgId: string;
  roomName: string;
  callerId: string;
  callerName: string;
  calleeId: string;
  calleeName: string;
  incidentId: number | null;
}): PrivateCall {
  prune();
  const existingCaller = findActivePrivateCallForUser(input.callerId);
  if (existingCaller) {
    throw Object.assign(new Error("You already have an active private radio call"), { code: "busy_self" });
  }
  const existingCallee = findActivePrivateCallForUser(input.calleeId);
  if (existingCallee) {
    throw Object.assign(new Error("That user is already on a private radio call"), { code: "busy_peer" });
  }

  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const call: PrivateCall = {
    id,
    orgId: input.orgId,
    roomName: input.roomName,
    callerId: input.callerId,
    callerName: input.callerName,
    calleeId: input.calleeId,
    calleeName: input.calleeName,
    incidentId: input.incidentId,
    status: "ringing",
    startedAt: Date.now(),
    ringExpiresAt: Date.now() + RING_TTL_MS,
  };
  calls.set(id, call);
  return call;
}

export function acceptPrivateCall(id: string, userId: string): PrivateCall | null {
  prune();
  const call = calls.get(id);
  if (!call || call.calleeId !== userId) return null;
  if (call.status === "ended") return null;
  call.status = "active";
  call.ringExpiresAt = Date.now() + ACTIVE_TTL_MS;
  calls.set(id, call);
  return call;
}

export function endPrivateCall(id: string, userId: string): PrivateCall | null {
  prune();
  const call = calls.get(id);
  if (!call) return null;
  if (call.callerId !== userId && call.calleeId !== userId) return null;
  calls.delete(id);
  return { ...call, status: "ended" };
}

export function serializePrivateCall(call: PrivateCall, meId: string) {
  const peerId = call.callerId === meId ? call.calleeId : call.callerId;
  const peerName = call.callerId === meId ? call.calleeName : call.callerName;
  return {
    id: call.id,
    roomName: call.roomName,
    status: call.status,
    role: call.callerId === meId ? ("caller" as const) : ("callee" as const),
    peerUserId: peerId,
    peerName,
    incidentId: call.incidentId,
    startedAt: call.startedAt,
    ringExpiresAt: call.ringExpiresAt,
  };
}
