import type { TrackerProtocolHandler } from "./types";
import { gt06ProtocolHandler } from "./protocols/gt06";

const handlers: TrackerProtocolHandler[] = [gt06ProtocolHandler];

export function listProtocolHandlers(): TrackerProtocolHandler[] {
  return [...handlers];
}

export function resolveProtocolHandler(packet: Buffer): TrackerProtocolHandler | null {
  for (const handler of handlers) {
    if (handler.matches(packet)) return handler;
  }
  return null;
}
