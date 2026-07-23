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
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This device cannot open the microphone for live radio");
  }
  // Keep constraints minimal on Android WebView — heavy AGC/NS often throws
  // "Could not start audio source" even when RECORD_AUDIO is already granted.
  const audio: boolean | MediaTrackConstraints =
    Capacitor.getPlatform() === "android"
      ? true
      : { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
  const stream = await navigator.mediaDevices.getUserMedia({ audio });
  const mediaTrack = stream.getAudioTracks()[0];
  if (!mediaTrack) throw new Error("No microphone track available");
  const mic = new LocalAudioTrack(mediaTrack, mediaTrack.getConstraints(), true);
  mic.stopOnMute = false;
  return mic;
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
  const [micPermission, setMicPermission] = useState<OmtMicPermission>(
    Capacitor.isNativePlatform() ? "prompt" : "granted",
  );

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
      await room.startAudio();
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
    setConnected(false);
    setConnecting(false);
    setListenerCount(0);
    setFloor(null);
  }, [stopHeartbeat]);

  useEffect(() => {
    void refreshMicPermission();
  }, [refreshMicPermission]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      await teardown();
      if (cancelled || commandId == null) return;

      setConnecting(true);
      setError(null);
      try {
        const tok = await radioFetch<TokenResponse>("POST", "/api/radio/token", {
          commandId,
        });
        if (cancelled) return;

        const room = new Room({
          adaptiveStream: true,
          dynacast: true,
          audioCaptureDefaults: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        roomRef.current = room;

        const updateParticipants = () => {
          setListenerCount(room.remoteParticipants.size);
        };
        room.on(RoomEvent.ParticipantConnected, updateParticipants);
        room.on(RoomEvent.ParticipantDisconnected, updateParticipants);
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
          const other = speakers.find((s) => !s.isLocal);
          setRemoteTalking(other?.name || other?.identity || null);
        });
        room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          setSpeakerReady(room.canPlaybackAudio);
        });
        room.on(RoomEvent.Disconnected, () => {
          setConnected(false);
          setTransmitting(false);
          setSpeakerReady(false);
        });

        await room.connect(tok.url, tok.token);
        if (cancelled) {
          await room.disconnect();
          return;
        }

        setConnected(true);
        setSpeakerReady(room.canPlaybackAudio);
        updateParticipants();
        try {
          await room.startAudio();
          setSpeakerReady(room.canPlaybackAudio);
        } catch {
          setSpeakerReady(false);
        }
        await refreshMicPermission();
        await refreshFloor();
        pollRef.current = setInterval(() => {
          void refreshFloor();
        }, 2000);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not connect to radio");
          setConnected(false);
        }
      } finally {
        if (!cancelled) setConnecting(false);
      }
    }

    void run();
    return () => {
      cancelled = true;
      void teardown();
    };
  }, [commandId, refreshFloor, refreshMicPermission, teardown]);

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
    startTransmit,
    stopTransmit,
  };
}
