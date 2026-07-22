/**
 * Half-duplex floor lock per radio room.
 * In-memory only — no audio, no persistence. Survives only while this process is up.
 */

export type FloorHolder = {
  userId: string;
  displayName: string;
  expiresAt: number;
};

const floors = new Map<string, FloorHolder>();

/** Must heartbeat within this window or floor auto-releases. */
export const FLOOR_TTL_MS = 12_000;

function prune(room: string): FloorHolder | null {
  const cur = floors.get(room);
  if (!cur) return null;
  if (cur.expiresAt <= Date.now()) {
    floors.delete(room);
    return null;
  }
  return cur;
}

export function getFloor(room: string): FloorHolder | null {
  return prune(room);
}

export function tryAcquireFloor(
  room: string,
  userId: string,
  displayName: string,
): { ok: true; holder: FloorHolder } | { ok: false; holder: FloorHolder } {
  const cur = prune(room);
  if (cur && cur.userId !== userId) {
    return { ok: false, holder: cur };
  }
  const holder: FloorHolder = {
    userId,
    displayName,
    expiresAt: Date.now() + FLOOR_TTL_MS,
  };
  floors.set(room, holder);
  return { ok: true, holder };
}

export function heartbeatFloor(room: string, userId: string): FloorHolder | null {
  const cur = prune(room);
  if (!cur || cur.userId !== userId) return null;
  cur.expiresAt = Date.now() + FLOOR_TTL_MS;
  floors.set(room, cur);
  return cur;
}

export function releaseFloor(room: string, userId: string): boolean {
  const cur = prune(room);
  if (!cur) return true;
  if (cur.userId !== userId) return false;
  floors.delete(room);
  return true;
}
