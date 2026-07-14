import type { Socket } from "net";

/** Context for one TCP connection from a GPS tracker device. */
export type TrackerConnection = {
  socket: Socket;
  remoteAddress: string;
  deviceId: string | null;
  protocolId: string | null;
  buffer: Buffer;
  connectedAt: Date;
  lastPacketAt: Date | null;
};

/** Parsed GPS fix from a tracker protocol handler. */
export type ParsedTrackerPosition = {
  latitude: number;
  longitude: number;
  speedKph: number | null;
  heading: number | null;
  ignitionOn: boolean | null;
  mileageKm: number | null;
  gpsValid: boolean;
  packetType: string;
  recordedAt: Date;
};

/** Result of handling one complete device packet. */
export type ProtocolHandleResult = {
  deviceId?: string | null;
  /** Optional bytes to send back to the device (e.g. GT06 login ACK). */
  response?: Buffer;
  /** GPS fix to persist (location packets). */
  position?: ParsedTrackerPosition | null;
  /** Heartbeat / status — update ignition without a new position row. */
  ignitionUpdate?: { ignitionOn: boolean; recordedAt: Date } | null;
};

/** Pluggable handler for a family of GPS tracker protocols. */
export type TrackerProtocolHandler = {
  id: string;
  label: string;
  /** Return true if this handler should process the packet. */
  matches: (packet: Buffer) => boolean;
  /** Try to read a device identifier (IMEI, etc.) from the packet. */
  tryExtractDeviceId: (packet: Buffer) => string | null;
  /** Handle packet; may return ACK bytes for the device. */
  handlePacket: (packet: Buffer, connection: TrackerConnection) => ProtocolHandleResult;
};

export type TrackerListenerOptions = {
  port: number;
  host: string;
  enabled: boolean;
};
