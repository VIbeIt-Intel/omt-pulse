import net, { type Server, type Socket } from "net";
import type { TrackerConnection, TrackerListenerOptions } from "./types";
import { bufferToHex, bufferToAsciiPreview, protocolNumberHex } from "./format";
import { knownDeviceNote } from "./known-devices";
import { extractGt06Packets } from "./protocols/gt06";
import { listProtocolHandlers, resolveProtocolHandler } from "./protocol-registry";
import { persistProtocolResult } from "./persistence";
import { ensureTrackerDevice } from "./store";

const LOG = "vehicle-tracker";

let server: Server | null = null;

function logPacket(connection: TrackerConnection, packet: Buffer, handlerId: string | null, compact = false): void {
  const ts = new Date().toISOString();
  const device = connection.deviceId ?? "unknown";
  const proto = protocolNumberHex(packet);
  const known = knownDeviceNote(connection.deviceId);

  console.log(
    `[${LOG}] ${ts} | device=${device} | protocol=${handlerId ?? "unknown"}` +
      (proto ? ` | pkt=0x${proto}` : "") +
      ` | remote=${connection.remoteAddress} | bytes=${packet.length}`,
  );

  if (!compact) {
    console.log(`[${LOG}]   hex: ${bufferToHex(packet)}`);
    console.log(`[${LOG}]   ascii: ${bufferToAsciiPreview(packet)}`);
    if (known) {
      console.log(`[${LOG}]   note: ${known}`);
    }
  }
}

function processPacket(connection: TrackerConnection, packet: Buffer): void {
  const handler =
    resolveProtocolHandler(packet) ??
    listProtocolHandlers().find((h) => h.id === connection.protocolId) ??
    null;

  if (handler && !connection.protocolId) {
    connection.protocolId = handler.id;
  }

  const extractedId = handler?.tryExtractDeviceId(packet) ?? null;
  if (extractedId && !connection.deviceId) {
    connection.deviceId = extractedId;
    console.log(`[${LOG}] device identified: ${extractedId} (${handler?.label ?? "?"})`);
    const known = knownDeviceNote(extractedId);
    if (known) console.log(`[${LOG}] ${known}`);
    void ensureTrackerDevice(extractedId, handler?.id ?? "unknown").catch((err) => {
      console.warn(`[${LOG}] device registration failed:`, err instanceof Error ? err.message : err);
    });
  }

  let result = null;
  if (handler) {
    result = handler.handlePacket(packet, connection);
    if (result.deviceId) connection.deviceId = result.deviceId;
  }

  const hasGps = Boolean(result?.position);
  logPacket(connection, packet, handler?.id ?? connection.protocolId, hasGps);

  if (handler && result) {
    if (result.response && result.response.length > 0) {
      connection.socket.write(result.response);
      console.log(
        `[${LOG}] ACK sent to ${connection.deviceId ?? connection.remoteAddress} (${result.response.length} bytes)`,
      );
    }

    if (result.followUpResponses?.length) {
      for (const followUp of result.followUpResponses) {
        // Brief delay so the terminal finishes processing the login ACK first.
        setTimeout(() => {
          if (connection.socket.destroyed) return;
          connection.socket.write(followUp);
          console.log(
            `[${LOG}] follow-up sent to ${connection.deviceId ?? connection.remoteAddress} (${followUp.length} bytes)`,
          );
        }, 400);
      }
    }

    const imei = connection.deviceId;
    if (imei && (result.position || result.ignitionUpdate)) {
      void persistProtocolResult(imei, handler.id, result).catch((err) => {
        console.warn(`[${LOG}] persist failed:`, err instanceof Error ? err.message : err);
      });
    }
  }
}

function drainBuffer(connection: TrackerConnection): void {
  const { packets, remaining } = extractGt06Packets(connection.buffer);
  connection.buffer = remaining;
  for (const packet of packets) {
    connection.lastPacketAt = new Date();
    processPacket(connection, packet);
  }
}

function onConnection(socket: Socket): void {
  const remoteAddress = `${socket.remoteAddress ?? "?"}:${socket.remotePort ?? "?"}`;
  const connection: TrackerConnection = {
    socket,
    remoteAddress,
    deviceId: null,
    protocolId: null,
    buffer: Buffer.alloc(0),
    connectedAt: new Date(),
    lastPacketAt: null,
  };

  console.log(`[${LOG}] connect ${remoteAddress}`);
  socket.setKeepAlive(true, 30_000);
  socket.setTimeout(0);

  socket.on("data", (chunk: Buffer) => {
    connection.buffer = Buffer.concat([connection.buffer, chunk]);
    drainBuffer(connection);
  });

  socket.on("close", () => {
    console.log(
      `[${LOG}] disconnect ${remoteAddress} device=${connection.deviceId ?? "unknown"}`,
    );
  });

  socket.on("error", (err) => {
    console.warn(`[${LOG}] socket error ${remoteAddress}:`, err.message);
  });
}

export function startVehicleTrackerListener(options: TrackerListenerOptions): Server | null {
  if (!options.enabled) {
    console.log(`[${LOG}] TCP listener disabled (VEHICLE_TRACKER_TCP_ENABLED=false)`);
    return null;
  }

  if (server) {
    console.warn(`[${LOG}] listener already running on port ${options.port}`);
    return server;
  }

  server = net.createServer(onConnection);

  server.on("error", (err: NodeJS.ErrnoException) => {
    console.error(`[${LOG}] server error:`, err.message);
    if (err.code === "EADDRINUSE") {
      console.error(`[${LOG}] port ${options.port} is already in use`);
    }
  });

  server.listen(options.port, options.host, () => {
    console.log(
      `[${LOG}] listening on ${options.host}:${options.port} ` +
        `(protocols: ${listProtocolHandlers().map((h) => h.id).join(", ")})`,
    );
  });

  return server;
}

export function stopVehicleTrackerListener(): void {
  if (!server) return;
  server.close();
  server = null;
  console.log(`[${LOG}] listener stopped`);
}
