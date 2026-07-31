import {
  ConnectionState,
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
} from "livekit-client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { apiRequest } from "@/lib/queryClient";
import {
  checkOmtMicrophonePermission,
  requestOmtMicrophonePermission,
  setOmtRadioAudioSession,
  type OmtMicPermission,
} from "@/lib/omt-app-settings";
import {
  isNativeAudioRecorderAvailable,
  requestNativeMicPermission,
} from "@/lib/native-audio-recorder";
import { nativeMicDeniedHint } from "@/lib/native-mic-hint";

export type PrivateCallInfo = {
  id: string;
  roomName: string;
  status: "ringing" | "active";
  role: "caller" | "callee";
  peerUserId: string;
  peerName: string;
  incidentId: number | null;
  startedAt: number;
  ringExpiresAt: number;
};

type FloorHolderInfo = {
  userId: string;
  displayName: string;
  expiresAt: number;
  isMe: boolean;
} | null;

type TokenBundle = {
  call: PrivateCallInfo;
  token: string;
  url: string;
  roomName: string;
  identity: string;
};

function radioTabDeviceId(): string {
  try {
    const key = "omt_radio_device_id";
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = `tab-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "web";
  }
}

async function radioFetch<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await apiRequest(method, path, body);
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

function playRemoteAudioTracks(room: Room): void {
  for (const participant of room.remoteParticipants.values()) {
    for (const pub of participant.audioTrackPublications.values()) {
      const track = pub.track;
      if (!track || track.kind !== Track.Kind.Audio) continue;
      if ("setVolume" in track && typeof track.setVolume === "function") {
        try {
          track.setVolume(1);
        } catch {
          /* ignore */
        }
      }
      const el = track.attach();
      el.setAttribute("data-omt-private-radio", "1");
      el.autoplay = true;
      el.playsInline = true;
      void el.play().catch(() => {});
      if (!el.isConnected) document.body.appendChild(el);
    }
  }
}

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

async function acquireMicTrack(): Promise<LocalAudioTrack> {
  await ensureOsMicPermission();
  await setOmtRadioAudioSession(true);
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("This device cannot open the microphone for private radio");
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  const mediaTrack = stream.getAudioTracks()[0];
  if (!mediaTrack) throw new Error("No microphone track available");
  const mic = new LocalAudioTrack(mediaTrack, mediaTrack.getConstraints(), true);
  mic.stopOnMute = false;
  return mic;
}

/** Module flag so group radio dock can pause while a private call is up. */
let privateRadioBusy = false;
const busyListeners = new Set<(busy: boolean) => void>();

export function isPrivateRadioBusy(): boolean {
  return privateRadioBusy;
}

export function subscribePrivateRadioBusy(fn: (busy: boolean) => void): () => void {
  busyListeners.add(fn);
  return () => busyListeners.delete(fn);
}

function setPrivateRadioBusy(busy: boolean) {
  privateRadioBusy = busy;
  for (const fn of busyListeners) fn(busy);
}

export function usePrivateRadio() {
  const roomRef = useRef<Room | null>(null);
  const micRef = useRef<LocalAudioTrack | null>(null);
  const callIdRef = useRef<string | null>(null);
  const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pttWantedRef = useRef(false);

  const [call, setCall] = useState<PrivateCallInfo | null>(null);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [transmitting, setTransmitting] = useState(false);
  const [floor, setFloor] = useState<FloorHolderInfo>(null);
  const [remoteTalking, setRemoteTalking] = useState<string | null>(null);
  const [speakerReady, setSpeakerReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [micPermission, setMicPermission] = useState<OmtMicPermission>(
    Capacitor.isNativePlatform() ? "prompt" : "granted",
  );

  const teardownRoom = useCallback(async () => {
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    pttWantedRef.current = false;
    setTransmitting(false);
    setRemoteTalking(null);
    setSpeakerReady(false);
    setFloor(null);
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
    document.querySelectorAll("[data-omt-private-radio]").forEach((el) => el.remove());
    await setOmtRadioAudioSession(false);
    setConnected(false);
    setConnecting(false);
  }, []);

  const joinWithToken = useCallback(async (bundle: TokenBundle) => {
    setConnecting(true);
    setError(null);
    callIdRef.current = bundle.call.id;
    setCall(bundle.call);
    setPrivateRadioBusy(true);

    await teardownRoom();

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      disconnectOnPageLeave: false,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    roomRef.current = room;

    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      const other = speakers.find((s) => !s.isLocal);
      setRemoteTalking(other?.name || other?.identity || null);
      if (other) {
        void (async () => {
          await setOmtRadioAudioSession(true);
          try {
            await room.startAudio();
          } catch {
            /* ignore */
          }
          playRemoteAudioTracks(room);
          setSpeakerReady(room.canPlaybackAudio);
        })();
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== Track.Kind.Audio) return;
      void (async () => {
        await setOmtRadioAudioSession(true);
        try {
          await room.startAudio();
        } catch {
          /* ignore */
        }
        playRemoteAudioTracks(room);
        setSpeakerReady(room.canPlaybackAudio);
      })();
    });
    room.on(RoomEvent.Disconnected, () => {
      setConnected(false);
    });

    await setOmtRadioAudioSession(true);
    await room.connect(bundle.url, bundle.token);
    if (room.state !== ConnectionState.Connected) {
      throw new Error("Private radio failed to connect");
    }

    try {
      const mic = await acquireMicTrack();
      await mic.mute();
      await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone });
      micRef.current = mic;
      setMicPermission("granted");
    } catch (err) {
      setMicPermission("denied");
      setError(
        err instanceof Error && /permission|notallowed|denied/i.test(err.message)
          ? `Microphone blocked. ${nativeMicDeniedHint()}`
          : err instanceof Error
            ? err.message
            : "Could not open microphone",
      );
    }

    try {
      await room.startAudio();
      playRemoteAudioTracks(room);
      setSpeakerReady(room.canPlaybackAudio);
    } catch {
      setSpeakerReady(false);
    }

    setConnected(true);
    setConnecting(false);
    setCall((c) => (c ? { ...c, status: bundle.call.status === "ringing" ? c.status : "active" } : bundle.call));
  }, [teardownRoom]);

  const unlockSpeaker = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return false;
    try {
      await setOmtRadioAudioSession(true);
      await room.startAudio();
      playRemoteAudioTracks(room);
      setSpeakerReady(room.canPlaybackAudio);
      return room.canPlaybackAudio;
    } catch {
      setSpeakerReady(false);
      return false;
    }
  }, []);

  const refreshFloor = useCallback(async () => {
    const id = callIdRef.current;
    if (!id) return;
    try {
      const data = await radioFetch<{ holder: FloorHolderInfo }>(
        "GET",
        `/api/radio/private/floor?callId=${encodeURIComponent(id)}`,
      );
      setFloor(data.holder);
    } catch {
      /* ignore */
    }
  }, []);

  const stopTransmit = useCallback(async () => {
    pttWantedRef.current = false;
    if (heartbeatRef.current) {
      clearInterval(heartbeatRef.current);
      heartbeatRef.current = null;
    }
    try {
      if (micRef.current) await micRef.current.mute();
    } catch {
      /* ignore */
    }
    setTransmitting(false);
    const id = callIdRef.current;
    if (id) {
      try {
        await radioFetch("POST", "/api/radio/private/floor/release", { callId: id });
      } catch {
        /* ignore */
      }
    }
    await refreshFloor();
    await setOmtRadioAudioSession(true);
    const room = roomRef.current;
    if (room) {
      try {
        await room.startAudio();
      } catch {
        /* ignore */
      }
      playRemoteAudioTracks(room);
      setSpeakerReady(room.canPlaybackAudio);
    }
  }, [refreshFloor]);

  const startTransmit = useCallback(async () => {
    pttWantedRef.current = true;
    const id = callIdRef.current;
    const room = roomRef.current;
    if (!id || !room) return;
    try {
      await radioFetch("POST", "/api/radio/private/floor", { callId: id });
      if (!pttWantedRef.current) {
        await radioFetch("POST", "/api/radio/private/floor/release", { callId: id });
        return;
      }
      if (!micRef.current) {
        const mic = await acquireMicTrack();
        await room.localParticipant.publishTrack(mic, { source: Track.Source.Microphone });
        micRef.current = mic;
      }
      await micRef.current.unmute();
      setTransmitting(true);
      if (heartbeatRef.current) clearInterval(heartbeatRef.current);
      heartbeatRef.current = setInterval(() => {
        void radioFetch("POST", "/api/radio/private/floor/heartbeat", { callId: id }).catch(() => {
          void stopTransmit();
        });
      }, 4000);
      await refreshFloor();
    } catch (err) {
      pttWantedRef.current = false;
      setTransmitting(false);
      setError(err instanceof Error ? err.message : "Could not transmit");
      await refreshFloor();
    }
  }, [refreshFloor, stopTransmit]);

  const endCall = useCallback(async () => {
    const id = callIdRef.current;
    if (id) {
      try {
        await radioFetch("POST", "/api/radio/private/end", { callId: id });
      } catch {
        /* ignore */
      }
    }
    callIdRef.current = null;
    setCall(null);
    setError(null);
    await teardownRoom();
    setPrivateRadioBusy(false);
  }, [teardownRoom]);

  const startCall = useCallback(
    async (peerUserId: string, incidentId?: number | null) => {
      setError(null);
      setConnecting(true);
      setPrivateRadioBusy(true);
      try {
        const bundle = await radioFetch<TokenBundle>("POST", "/api/radio/private/start", {
          peerUserId,
          incidentId: incidentId ?? null,
          deviceId: radioTabDeviceId(),
        });
        await joinWithToken(bundle);
      } catch (err) {
        setConnecting(false);
        setPrivateRadioBusy(false);
        setError(err instanceof Error ? err.message : "Failed to start private radio");
        throw err;
      }
    },
    [joinWithToken],
  );

  const acceptCall = useCallback(
    async (callId: string) => {
      setError(null);
      setConnecting(true);
      setPrivateRadioBusy(true);
      try {
        const bundle = await radioFetch<TokenBundle>("POST", "/api/radio/private/accept", {
          callId,
          deviceId: radioTabDeviceId(),
        });
        await joinWithToken({ ...bundle, call: { ...bundle.call, status: "active" } });
      } catch (err) {
        setConnecting(false);
        setPrivateRadioBusy(false);
        setError(err instanceof Error ? err.message : "Failed to accept private radio");
        throw err;
      }
    },
    [joinWithToken],
  );

  const declineCall = useCallback(async (callId: string) => {
    try {
      await radioFetch("POST", "/api/radio/private/end", { callId });
    } catch {
      /* ignore */
    }
    if (callIdRef.current === callId) {
      callIdRef.current = null;
      setCall(null);
      await teardownRoom();
      setPrivateRadioBusy(false);
    } else {
      setCall((c) => (c?.id === callId ? null : c));
    }
  }, [teardownRoom]);

  // Poll for incoming / peer-ended calls.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await radioFetch<{ call: PrivateCallInfo | null }>(
          "GET",
          "/api/radio/private/active",
        );
        if (cancelled) return;
        const remote = data.call;
        if (!remote) {
          if (callIdRef.current && !connecting) {
            // Peer ended.
            callIdRef.current = null;
            setCall(null);
            await teardownRoom();
            setPrivateRadioBusy(false);
          }
          return;
        }
        // Incoming ring for callee who hasn't joined yet.
        if (remote.role === "callee" && remote.status === "ringing" && !callIdRef.current) {
          setCall(remote);
          setPrivateRadioBusy(true);
          return;
        }
        // Keep status in sync while connected.
        if (callIdRef.current === remote.id) {
          setCall(remote);
        }
      } catch {
        /* ignore poll errors */
      }
    };
    void tick();
    const t = window.setInterval(tick, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [connecting, teardownRoom]);

  useEffect(() => {
    if (!callIdRef.current || !connected) return;
    void refreshFloor();
    const t = window.setInterval(() => void refreshFloor(), 3000);
    return () => window.clearInterval(t);
  }, [connected, refreshFloor]);

  useEffect(() => {
    return () => {
      void teardownRoom();
      setPrivateRadioBusy(false);
    };
  }, [teardownRoom]);

  const busy = !!(floor && !floor.isMe);

  return {
    call,
    connected,
    connecting,
    transmitting,
    floor,
    remoteTalking,
    speakerReady,
    error,
    micPermission,
    busy,
    startCall,
    acceptCall,
    declineCall,
    endCall,
    startTransmit,
    stopTransmit,
    unlockSpeaker,
  };
}
