import {
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { apiRequest } from "@/lib/queryClient";
import {
  isNativeAudioRecorderAvailable,
  requestNativeMicPermission,
} from "@/lib/native-audio-recorder";
import { nativeMicDeniedHint } from "@/lib/native-mic-hint";
import {
  checkOmtMicrophonePermission,
  requestOmtMicrophonePermission,
  setOmtRadioAudioSession,
  type OmtMicPermission,
} from "@/lib/omt-app-settings";

export type RadioChannel = {
  id: number;
  name: string;
  isCentral: boolean;
  roomName: string;
};

export type FloorHolderInfo = {
  userId: string;
  displayName: string;
  expiresAt: number;
  isMe: boolean;
} | null;

type TokenResponse = {
  token: string;
  url: string;
  roomName: string;
  commandId: number;
  identity: string;
};

async function radioFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    const res = await apiRequest(method, path, body);
    const text = await res.text();
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const match = raw.match(/^\d+:\s*([\s\S]*)$/);
    if (match) {
      try {
        const data = JSON.parse(match[1]) as { message?: string; holder?: FloorHolderInfo };
        const e = new Error(data.message || raw) as Error & { holder?: FloorHolderInfo };
        if (data.holder) e.holder = data.holder;
        throw e;
      } catch (parsed) {
        if (parsed instanceof Error && "holder" in parsed) throw parsed;
      }
    }
    throw err instanceof Error ? err : new Error(raw);
  }
}

function friendlyRadioError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes("pc connection") ||
    lower.includes("peerconnection") ||
    lower.includes("ice") ||
    lower.includes("dtls")
  ) {
    return "Could not establish radio audio link. Close other OMT Pulse tabs on this PC, then tap Retry.";
  }
  if (lower.includes("websocket") || lower.includes("connection refused")) {
    return "Radio server unreachable. Check internet, then tap Retry.";
  }
  return raw || "Could not connect to radio";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function micErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const lower = raw.toLowerCase();
  if (
    lower.includes("permission") ||
    lower.includes("notallowed") ||
    lower.includes("denied")
  ) {
    return `Microphone blocked. ${nativeMicDeniedHint()}`;
  }
  if (lower.includes("could not start audio") || lower.includes("audio source")) {
    return "Microphone busy or blocked by Android. Close other apps using the mic, then hold to talk again.";
  }
  return raw || "Could not open microphone";
}


/** Ensure OS mic is allowed (no-op if voice notes already granted it). */
async function ensureOsMicPermission(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const current = await checkOmtMicrophonePermission();
  if (current === "granted") return;
  const requested = await requestOmtMicrophonePermission();
  if (requested === "granted") return;
  if (requested === "unavailable" && isNativeAudioRecorderAvailable()) {
    const ok = await requestNativeMicPermission();
    if (ok) return;
  }
  if (requested === "denied" || current === "denied") {
    throw new DOMException("Microphone permission denied", "NotAllowedError");
  }
}

/**
 * Open mic for LiveKit. Reuses the MediaStreamTrack (no stop/restart) and keeps
 * stopOnMute=false so PTT mute does not kill Android capture.
 */
async function acquireMicTrack(): Promise<LocalAudioTrack> {
  await ensureOsMicPermission();
  // Put Android into communication + speaker mode before opening the mic —
  // without this, WebView often throws "Could not start audio source".
  await setOmtRadioAudioSession(true);
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This device cannot open the microphone for live radio");
  }
  const attempts: Array<boolean | MediaTrackConstraints> = [
    true,
    { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  ];
  if (Capacitor.getPlatform() !== "android") {
    attempts.unshift({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  }
  let lastErr: unknown;
  for (const audio of attempts) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio });
      const mediaTrack = stream.getAudioTracks()[0];
      if (!mediaTrack) throw new Error("No microphone track available");
      const mic = new LocalAudioTrack(mediaTrack, mediaTrack.getConstraints(), true);
      mic.stopOnMute = false;
      return mic;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Could not open microphone");
}

export function useRadioStatus() {
  const [available, setAvailable] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    radioFetch<{ available: boolean }>("GET", "/api/radio/status")
      .then((s) => {
        if (!cancelled) setAvailable(!!s.available);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return available;
}

export function useRadioChannels(enabled: boolean) {
  const [channels, setChannels] = useState<RadioChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    radioFetch<RadioChannel[]>("GET", "/api/radio/channels")
      .then((list) => {
        if (!cancelled) {
          setChannels(Array.isArray(list) ? list : []);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load channels");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { channels, loading, error };
}

export function useRadioChannel(commandId: number | null) {
  const roomRef = useRef<Room | null>(null);
  const micRef = useRef<LocalAudioTrack | null>(null);
  const holdingRef = useRef(false);
  const commandIdRef = useRef(commandId);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTransmitRef = useRef<() => Promise<void>>(async () => {});

  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const [listenerCount, setListenerCount] = useState(0);
  const [floor, setFloor] = useState<FloorHolderInfo>(null);
  const [error, setError] = useState<string | null>(null);
  const [remoteTalking, setRemoteTalking] = useState<string | null>(null);
  const [speakerReady, setSpeakerReady] = useState(false);
  const [reconnectTick, setReconnectTick] = useState(0);
  const [micPermission, setMicPermission] = useState<OmtMicPermission>(
    Capacitor.isNativePlatform() ? "prompt" : "granted",
  );
  const autoReconnectCountRef = useRef(0);

  commandIdRef.current = commandId;

  const refreshMicPermission = useCallback(async () => {
    if (!Capacitor.isNativePlatform()) {
      setMicPermission("granted");
      return "granted" as OmtMicPermission;
    }
    const status = await checkOmtMicrophonePermission();
    if (status === "unavailable" && isNativeAudioRecorderAvailable()) {
      try {
        const { CapacitorAudioRecorder } = await import("@capgo/capacitor-audio-recorder");
        const checked = await CapacitorAudioRecorder.checkPermissions();
        const mapped: OmtMicPermission =
          checked.recordAudio === "granted"
            ? "granted"
            : checked.recordAudio === "denied"
              ? "denied"
              : "prompt";
        setMicPermission(mapped);
        return mapped;
      } catch {
        setMicPermission("prompt");
        return "prompt";
      }
    }
    setMicPermission(status);
    return status;
  }, []);

  const requestMicAccess = useCallback(async () => {
    setError(null);
    try {
      await ensureOsMicPermission();
      setMicPermission("granted");
      // Warm WebView capture once so later PTT is fast.
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
      }
      setError(null);
      return true;
    } catch (err) {
      setMicPermission("denied");
      setError(micErrorMessage(err));
      return false;
    }
  }, []);

  const stopHeartbeat = useCallback(() => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
  }, []);

  const refreshFloor = useCallback(async () => {
    const id = commandIdRef.current;
    if (id == null) return;
    try {
      const data = await radioFetch<{ holder: FloorHolderInfo }>(
        "GET",
        `/api/radio/floor?commandId=${id}`,
      );
      setFloor(data.holder);
    } catch {
      /* ignore */
    }
  }, []);

  const unlockSpeaker = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    try {
      await setOmtRadioAudioSession(true);
      await room.startAudio();
      for (const participant of room.remoteParticipants.values()) {
        for (const pub of participant.audioTrackPublications.values()) {
          const track = pub.track;
          if (!track || track.kind !== Track.Kind.Audio) continue;
          if ("setVolume" in track && typeof track.setVolume === "function") {
            track.setVolume(1);
          }
          const els =
            track.attachedElements.length > 0
              ? track.attachedElements
              : [track.attach()];
          for (const el of els) {
            el.autoplay = true;
            el.muted = false;
            el.volume = 1;
            void el.play().catch(() => undefined);
          }
        }
      }
      setSpeakerReady(room.canPlaybackAudio);
      return room.canPlaybackAudio;
    } catch {
      setSpeakerReady(false);
      return false;
    }
  }, []);

  const stopTransmit = useCallback(async () => {
    holdingRef.current = false;
    stopHeartbeat();
    try {
      if (micRef.current) await micRef.current.mute();
    } catch {
      /* ignore */
    }
    setTransmitting(false);
    const id = commandIdRef.current;
    if (id != null) {
      try {
        await radioFetch("POST", "/api/radio/floor/release", { commandId: id });
      } catch {
        /* ignore */
      }
    }
    await refreshFloor();
  }, [refreshFloor, stopHeartbeat]);

  stopTransmitRef.current = stopTransmit;

  const teardown = useCallback(async () => {
    stopHeartbeat();
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    await stopTransmitRef.current();
    setRemoteTalking(null);
    setSpeakerReady(false);
    const mic = micRef.current;
    micRef.current = null;
    if (mic) {
      try {
        await roomRef.current?.localParticipant.unpublishTrack(mic);
      } catch {
        /* ignore */
      }
      try {
        mic.stop();
      } catch {
        /* ignore */
      }
    }
    const room = roomRef.current;
    roomRef.current = null;
    if (room) {
      try {
        await room.disconnect();
      } catch {
        /* ignore */
      }
    }
    await setOmtRadioAudioSession(false);
    setConnected(false);
    setConnecting(false);
    setListenerCount(0);
    setFloor(null);
  }, [stopHeartbeat]);

  const reconnect = useCallback(() => {
    autoReconnectCountRef.current = 0;
    setError(null);
    setReconnectTick((n) => n + 1);
  }, []);

  useEffect(() => {
    void refreshMicPermission();
  }, [refreshMicPermission]);

  useEffect(() => {
    let cancelled = false;
    let activeRoom: Room | null = null;
    let intentionalLeave = false;

    async function connectOnce(commandIdToJoin: number): Promise<Room> {
      const tok = await radioFetch<TokenResponse>("POST", "/api/radio/token", {
        commandId: commandIdToJoin,
      });
      if (cancelled) throw new Error("cancelled");

      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      activeRoom = room;
      roomRef.current = room;

      const isActiveRoom = () => roomRef.current === room && !cancelled;

      const updateParticipants = () => {
        if (!isActiveRoom()) return;
        setListenerCount(room.remoteParticipants.size);
      };
      room.on(RoomEvent.ParticipantConnected, updateParticipants);
      room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
      room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        if (!isActiveRoom()) return;
        const other = speakers.find((s) => !s.isLocal);
        setRemoteTalking(other?.name || other?.identity || null);
        if (other) {
          void setOmtRadioAudioSession(true);
          void room.startAudio().catch(() => undefined);
        }
      });
      room.on(RoomEvent.TrackSubscribed, (track) => {
        if (!isActiveRoom()) return;
        if (track.kind !== Track.Kind.Audio) return;
        void setOmtRadioAudioSession(true);
        if ("setVolume" in track && typeof track.setVolume === "function") {
          track.setVolume(1);
        }
        const els =
          track.attachedElements.length > 0
            ? track.attachedElements
            : [track.attach()];
        for (const el of els) {
          el.autoplay = true;
          el.muted = false;
          el.volume = 1;
          void el.play().catch(() => undefined);
        }
        void room.startAudio().catch(() => undefined);
      });
      room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
        if (!isActiveRoom()) return;
        setSpeakerReady(room.canPlaybackAudio);
      });
      room.on(RoomEvent.Disconnected, () => {
        if (roomRef.current !== room) return;
        setConnected(false);
        setTransmitting(false);
        setSpeakerReady(false);
        if (!intentionalLeave && !cancelled) {
          if (autoReconnectCountRef.current >= 3) return;
          autoReconnectCountRef.current += 1;
          // Brief delay then rejoin — covers DUPLICATE_IDENTITY / brief ICE drops.
          window.setTimeout(() => {
            if (!cancelled && commandIdRef.current === commandIdToJoin) {
              setReconnectTick((n) => n + 1);
            }
          }, 1200);
        }
      });

      await setOmtRadioAudioSession(true);
      await room.connect(tok.url, tok.token, {
        peerConnectionTimeout: 25_000,
        maxRetries: 2,
      });
      if (cancelled || roomRef.current !== room) {
        try {
          await room.disconnect();
        } catch {
          /* ignore */
        }
        throw new Error("cancelled");
      }
      return room;
    }

    async function run() {
      intentionalLeave = true;
      await teardown();
      intentionalLeave = false;
      if (cancelled || commandId == null) return;

      setConnecting(true);
      setError(null);

      const maxAttempts = 3;
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (cancelled) return;
        try {
          // Give LiveKit time to drop a duplicate identity from a prior tab/effect.
          if (attempt > 1) await sleep(700 * attempt);
          else await sleep(250);

          const room = await connectOnce(commandId);
          if (cancelled) return;

          setConnected(true);
          setSpeakerReady(room.canPlaybackAudio);
          setListenerCount(room.remoteParticipants.size);
          autoReconnectCountRef.current = 0;
          try {
            await room.startAudio();
            if (roomRef.current === room && !cancelled) {
              setSpeakerReady(room.canPlaybackAudio);
            }
          } catch {
            if (roomRef.current === room && !cancelled) setSpeakerReady(false);
          }
          await refreshMicPermission();
          await refreshFloor();
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
          pollRef.current = setInterval(() => {
            if (roomRef.current !== room || cancelled) return;
            void refreshFloor();
          }, 2000);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (cancelled) return;
          const msg = err instanceof Error ? err.message : String(err);
          if (msg === "cancelled") return;
          try {
            if (activeRoom) await activeRoom.disconnect();
          } catch {
            /* ignore */
          }
          activeRoom = null;
          if (roomRef.current) roomRef.current = null;
        }
      }

      if (lastErr && !cancelled) {
        setError(friendlyRadioError(lastErr));
        setConnected(false);
      }
      if (!cancelled) setConnecting(false);
    }

    void run();
    return () => {
      cancelled = true;
      intentionalLeave = true;
      void (async () => {
        if (activeRoom && roomRef.current === activeRoom) {
          await teardown();
          return;
        }
        if (activeRoom) {
          try {
            await activeRoom.disconnect();
          } catch {
            /* ignore */
          }
          return;
        }
        await teardown();
      })();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reconnectTick forces manual/auto retry
  }, [commandId, reconnectTick]);

  const ensureMicPublished = useCallback(async () => {
    const room = roomRef.current;
    if (!room) throw new Error("Radio is not connected");
    if (micRef.current) return micRef.current;
    const mic = await acquireMicTrack();
    await room.localParticipant.publishTrack(mic, {
      source: Track.Source.Microphone,
    });
    await mic.mute();
    micRef.current = mic;
    setMicPermission("granted");
    return mic;
  }, []);

  const startTransmit = useCallback(async () => {
    const id = commandIdRef.current;
    if (id == null || !roomRef.current) return;
    if (holdingRef.current) return;
    setError(null);
    await unlockSpeaker();

    try {
      const data = await radioFetch<{ holder: FloorHolderInfo }>("POST", "/api/radio/floor", {
        commandId: id,
      });
      setFloor(data.holder);
      const mic = await ensureMicPublished();
      holdingRef.current = true;
      await mic.unmute();
      setTransmitting(true);
      stopHeartbeat();
      heartbeatRef.current = setInterval(() => {
        void radioFetch("POST", "/api/radio/floor/heartbeat", { commandId: id }).catch(() => {
          void stopTransmitRef.current();
        });
      }, 4000);
    } catch (err) {
      holdingRef.current = false;
      setTransmitting(false);
      const withHolder = err as Error & { holder?: FloorHolderInfo };
      if (withHolder.holder) setFloor(withHolder.holder);
      setError(micErrorMessage(err));
      void refreshMicPermission();
      try {
        await radioFetch("POST", "/api/radio/floor/release", { commandId: id });
      } catch {
        /* ignore */
      }
      await refreshFloor();
    }
  }, [ensureMicPublished, refreshFloor, refreshMicPermission, stopHeartbeat, unlockSpeaker]);

  return {
    connected,
    connecting,
    transmitting,
    listenerCount,
    floor,
    remoteTalking,
    speakerReady,
    micPermission,
    error,
    unlockSpeaker,
    requestMicAccess,
    refreshMicPermission,
    reconnect,
    startTransmit,
    stopTransmit,
  };
}
