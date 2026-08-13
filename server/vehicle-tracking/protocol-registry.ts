import type { TrackerProtocolHandler } from "./types";
import { gt06ProtocolHandler } from "./protocols/gt06";
import { h02ProtocolHandler } from "./protocols/h02";

const handlers: TrackerProtocolHandler[] = [gt06ProtocolHandler, h02ProtocolHandler];

export function listProtocolHandlers(): TrackerProtocolHandler[] {
  return [...handlers];
}

export function resolveProtocolHandler(packet: Buffer): TrackerProtocolHandler | null {
  for (const handler of handlers) {
    if (handler.matches(packet)) return handler;
  }
  return null;
}
