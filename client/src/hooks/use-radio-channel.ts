import {
  Room,
  RoomEvent,
  Track,
  type LocalAudioTrack,
  createLocalAudioTrack,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import {
  isNativeAudioRecorderAvailable,
  requestNativeMicPermission,
} from "@/lib/native-audio-recorder";
import { nativeMicDeniedHint } from "@/lib/native-mic-hint";

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
    lower.includes("denied") ||
    lower.includes("could not start audio") ||
    lower.includes("audio source")
  ) {
    return `Microphone blocked. ${nativeMicDeniedHint()}`;
  }
  return raw || "Could not open microphone";
}

/**
 * Request mic once (Android remembers Allow). Uses native plugin when present,
 * then WebView getUserMedia so LiveKit can capture.
 */
async function acquireMicTrack(): Promise<LocalAudioTrack> {
  if (isNativeAudioRecorderAvailable()) {
    await requestNativeMicPermission();
  }
  if (navigator.mediaDevices?.getUserMedia) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
  }
  return createLocalAudioTrack({
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  });
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

  commandIdRef.current = commandId;

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
          // Others on the channel (exclude self).
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

        // Listen-only first — mic opens only on Hold to talk (user gesture).
        await room.connect(tok.url, tok.token);
        if (cancelled) {
          await room.disconnect();
          return;
        }

        setConnected(true);
        setSpeakerReady(room.canPlaybackAudio);
        updateParticipants();
        // Best-effort unlock; browsers/WebViews often still need a tap (see unlockSpeaker).
        try {
          await room.startAudio();
          setSpeakerReady(room.canPlaybackAudio);
        } catch {
          setSpeakerReady(false);
        }
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
  }, [commandId, refreshFloor, teardown]);

  const ensureMicPublished = useCallback(async () => {
    const room = roomRef.current;
    if (!room) throw new Error("Radio is not connected");
    if (micRef.current) return micRef.current;
    const mic = await acquireMicTrack();
    await room.localParticipant.publishTrack(mic, {
      source: Track.Source.Microphone,
    });
    // Start muted; unmute only while holding PTT.
    await mic.mute();
    micRef.current = mic;
    return mic;
  }, []);

  const startTransmit = useCallback(async () => {
    const id = commandIdRef.current;
    if (id == null || !roomRef.current) return;
    if (holdingRef.current) return;
    setError(null);
    // User gesture — unlock incoming audio as well as outbound mic.
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
      try {
        await radioFetch("POST", "/api/radio/floor/release", { commandId: id });
      } catch {
        /* ignore */
      }
      await refreshFloor();
    }
  }, [ensureMicPublished, refreshFloor, stopHeartbeat, unlockSpeaker]);

  return {
    connected,
    connecting,
    transmitting,
    listenerCount,
    floor,
    remoteTalking,
    speakerReady,
    error,
    unlockSpeaker,
    startTransmit,
    stopTransmit,
  };
}
