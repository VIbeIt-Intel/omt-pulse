import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { MessageSquare, Send, Plus, Search, Users, ArrowLeft, ImageIcon, Camera, Mic, Trash2, Square } from "lucide-react";
import { cn } from "@/lib/utils";
import { PageHero } from "@/components/page-hero";
import { MAX_VOICE_SECONDS, prepareAndUploadFile, uploadFile, UploadValidationError } from "@/lib/upload-media";
import { apiUrl } from "@/lib/api-base";
import { nativeMicDeniedHint, nativeVoiceApkUpdateHint } from "@/lib/native-mic-hint";
import {
  createAudioMediaRecorder,
  openMicStream,
  recorderMimeType,
  recordingErrorMessage,
} from "@/lib/voice-recorder";
import {
  cancelNativeRecording,
  getNativeRecordingMode,
  startNativeRecording,
  stopNativeRecording,
} from "@/lib/native-audio-recorder";
import { Capacitor } from "@capacitor/core";

type ChatMessage = {
  id: number;
  organizationId: string;
  senderId: string;
  recipientId: string | null;
  content: string;
  createdAt: string;
  senderFirstName: string;
  senderLastName: string;
  senderAvatarUrl: string | null;
};

type Conversation = {
  recipientId: string | null;
  recipientFirstName: string | null;
  recipientLastName: string | null;
  recipientAvatarUrl: string | null;
  lastMessage: string | null;
  lastMessageAt: string | null;
  unreadCount: number;
};

type OrgUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  isActive: boolean;
  avatarUrl?: string | null;
};

type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  organizationId: string;
  role: string;
  isSuperadmin?: boolean;
  avatarUrl?: string | null;
};

/** Pathname for /objects/… so fetch rewrite + session cookies work on Capacitor APK. */
function mediaSrc(url: string): string {
  if (url.startsWith("data:") || url.startsWith("blob:")) return url;
  try {
    if (/^https?:\/\//i.test(url)) return new URL(url).pathname;
  } catch {
    /* fall through */
  }
  return url.startsWith("/") ? url : `/${url}`;
}

/**
 * Chat media lives behind session-auth /objects/. Bare &lt;img&gt;/&lt;audio&gt; src
 * breaks on the local Capacitor shell — fetch with credentials, then blob URL.
 */
function useAuthedMediaUrl(rawUrl: string): { src: string | null; loading: boolean; error: boolean } {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      const path = mediaSrc(rawUrl);
      if (path.startsWith("data:") || path.startsWith("blob:")) {
        setSrc(path);
        setError(false);
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(false);
      try {
        const res = await fetch(apiUrl(path), { credentials: "include" });
        if (!res.ok) throw new Error(`media ${res.status}`);
        const blob = await res.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setSrc(objectUrl);
      } catch {
        if (!cancelled) {
          setError(true);
          setSrc(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rawUrl]);

  return { src, loading, error };
}

function ChatImageMessage({ url }: { url: string }) {
  const { src, loading, error } = useAuthedMediaUrl(url);

  if (loading) {
    return (
      <div className="max-w-[220px] h-[140px] rounded-xl border border-white/10 bg-muted/40 flex items-center justify-center text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (error || !src) {
    return (
      <div className="max-w-[220px] rounded-xl border border-white/10 bg-muted/40 px-3 py-6 text-xs text-muted-foreground text-center">
        Image unavailable
      </div>
    );
  }

  return (
    <a href={src} target="_blank" rel="noopener noreferrer" data-testid="msg-image-link">
      <img
        src={src}
        alt="Shared image"
        className="max-w-[220px] rounded-xl border border-white/10 object-cover cursor-pointer"
      />
    </a>
  );
}

function ChatAudioMessage({ url, isMe }: { url: string; isMe: boolean }) {
  const { src, loading, error } = useAuthedMediaUrl(url);

  return (
    <div
      className={cn(
        "px-2 py-1.5 rounded-2xl min-w-[200px] max-w-[260px]",
        isMe ? "bg-primary/90" : "bg-muted",
      )}
      data-testid="msg-audio"
    >
      {loading ? (
        <p className="text-xs text-muted-foreground px-1 py-2">Loading voice note…</p>
      ) : error || !src ? (
        <p className="text-xs text-muted-foreground px-1 py-2">Voice note unavailable</p>
      ) : (
        <audio controls src={src} className="w-full h-8" preload="metadata" />
      )}
    </div>
  );
}

function previewMessage(content: string | null): string | null {
  if (!content) return null;
  if (content.startsWith("[img]")) return "Photo";
  if (content.startsWith("[audio]")) return "Voice note";
  return content;
}

function formatRecordingTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return d.toLocaleDateString("en-ZA", { weekday: "short" });
  return d.toLocaleDateString("en-ZA", { day: "numeric", month: "short" });
}

function formatMessageTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function Initials({ firstName, lastName, avatarUrl, size = "md" }: { firstName: string; lastName: string; avatarUrl?: string | null; size?: "sm" | "md" }) {
  const sizeClass = size === "sm" ? "h-7 w-7 text-xs" : "h-9 w-9 text-sm";
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl.startsWith("data:") ? avatarUrl : (() => { try { return new URL(avatarUrl).pathname; } catch { return avatarUrl; } })()}
        alt={firstName}
        className={cn("rounded-full object-cover shrink-0", sizeClass)}
        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
      />
    );
  }
  return (
    <div className={cn("rounded-full bg-primary/10 flex items-center justify-center shrink-0 font-semibold text-primary border border-border", sizeClass)}>
      {`${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase()}
    </div>
  );
}

function NewDmDialog({
  open,
  onOpenChange,
  onSelect,
  currentUserId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSelect: (user: OrgUser) => void;
  currentUserId: string;
}) {
  const [search, setSearch] = useState("");
  const { data: users = [] } = useQuery<OrgUser[]>({ queryKey: ["/api/chat/users"] });

  const filtered = users.filter(
    (u) =>
      u.id !== currentUserId &&
      u.isActive &&
      `${u.firstName} ${u.lastName} ${u.email}`.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-new-dm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" />
            Start a Direct Message
          </DialogTitle>
        </DialogHeader>
        <div className="relative mb-2">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or email…"
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-dm-search"
            autoFocus
          />
        </div>
        <ScrollArea className="max-h-72">
          {filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-6">No users found</p>
          ) : (
            <div className="space-y-0.5">
              {filtered.map((u) => (
                <button
                  key={u.id}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/60 transition-colors text-left"
                  onClick={() => { onSelect(u); onOpenChange(false); }}
                  data-testid={`button-dm-user-${u.id}`}
                >
                  <Initials firstName={u.firstName} lastName={u.lastName} avatarUrl={u.avatarUrl} size="sm" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-tight">{u.firstName} {u.lastName}</p>
                    <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                  </div>
                  <Badge variant="secondary" className="ml-auto shrink-0 text-xs capitalize">{u.role}</Badge>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

export default function ChatPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastSeenMsgIdRef = useRef<number | null>(null);
  const hasInitialScrolledRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const voiceInputRef = useRef<HTMLInputElement>(null);
  const voiceCaptureInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [text, setText] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [uploadingVoice, setUploadingVoice] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [activeConvo, setActiveConvo] = useState<{ type: "group" } | { type: "dm"; recipientId: string; recipientName: string; recipientAvatarUrl: string | null }>({ type: "group" });

  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });
  const isAdmin = me?.role === "administrator" || !!me?.isSuperadmin;
  const [nativeRecordingMode, setNativeRecordingMode] = useState(getNativeRecordingMode);
  const useNativeRecorder = nativeRecordingMode === "plugin";

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    const sync = () => setNativeRecordingMode(getNativeRecordingMode());
    sync();
    const timers = [150, 600, 1500].map((ms) => setTimeout(sync, ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const { data: conversations = [] } = useQuery<Conversation[]>({
    queryKey: ["/api/chat/conversations"],
    refetchInterval: 5000,
  });

  const messagesQueryKey = activeConvo.type === "group"
    ? ["/api/chat/messages", "group"]
    : ["/api/chat/messages", "dm", activeConvo.recipientId];

  const messagesUrl = activeConvo.type === "group"
    ? "/api/chat/messages?type=group&limit=50"
    : `/api/chat/messages?type=dm&with=${activeConvo.recipientId}&limit=50`;

  const { data: messages = [] } = useQuery<ChatMessage[]>({
    queryKey: messagesQueryKey,
    queryFn: async () => {
      const res = await fetch(messagesUrl, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load messages");
      return res.json();
    },
    refetchInterval: 3000,
  });

  // Reset scroll-tracking state when switching conversations so the first paint
  // of a new thread snaps instantly to the latest message (no smooth animation)
  // and the new-message detector doesn't treat the entire thread as "new".
  const activeConvoKey = activeConvo.type === "group" ? "group" : `dm:${activeConvo.recipientId}`;
  useEffect(() => {
    lastSeenMsgIdRef.current = null;
    hasInitialScrolledRef.current = false;
  }, [activeConvoKey]);

  // Smart auto-scroll:
  //   1. On first paint of a thread → instant-jump to bottom (no animation).
  //   2. On a genuinely-new message (last-message id changed) → smooth-scroll
  //      ONLY if the user is already near the bottom. If they've scrolled up
  //      to read history, leave them alone.
  // Dependency is the last message id, not the messages array reference, so
  // the 3 s refetch interval no longer fires the effect when nothing changed.
  const lastMsgId = messages.length > 0 ? messages[messages.length - 1].id : null;
  useEffect(() => {
    const endEl = messagesEndRef.current;
    if (!endEl) return;
    // The Radix ScrollArea viewport is the nearest ancestor with this attribute.
    const viewport = endEl.closest("[data-radix-scroll-area-viewport]") as HTMLElement | null;

    if (!hasInitialScrolledRef.current && lastMsgId !== null) {
      endEl.scrollIntoView({ behavior: "auto" });
      hasInitialScrolledRef.current = true;
      lastSeenMsgIdRef.current = lastMsgId;
      return;
    }

    if (lastMsgId === null || lastMsgId === lastSeenMsgIdRef.current) return;
    lastSeenMsgIdRef.current = lastMsgId;

    // Only auto-stick if the user is within 80 px of the bottom.
    let nearBottom = true;
    if (viewport) {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      nearBottom = distanceFromBottom < 80;
    }
    if (nearBottom) {
      endEl.scrollIntoView({ behavior: "smooth" });
    }
  }, [lastMsgId]);

  const markRead = useCallback(async (recipientId: string | null) => {
    try {
      await fetch("/api/chat/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ recipientId }),
      });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    } catch { /* ignore */ }
  }, [qc]);

  // Use the stable string key (not the activeConvo object literal) so this
  // effect only fires when the conversation actually changes, not on every
  // render where the object is recreated.
  useEffect(() => {
    const rid = activeConvo.type === "group" ? null : activeConvo.recipientId;
    markRead(rid);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvoKey, markRead]);

  const sendMutation = useMutation({
    mutationFn: async (content: string) => {
      const recipientId = activeConvo.type === "dm" ? activeConvo.recipientId : null;
      return apiRequest("POST", "/api/chat/messages", { recipientId, content });
    },
    onSuccess: () => {
      setText("");
      qc.invalidateQueries({ queryKey: messagesQueryKey });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
    onError: () => {
      toast({ title: "Failed to send message", variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (messageId: number) => apiRequest("DELETE", `/api/chat/messages/${messageId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagesQueryKey });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    },
    onError: () => {
      toast({ title: "Failed to delete message", variant: "destructive" });
    },
  });

  const clearGroupMutation = useMutation({
    mutationFn: async () => apiRequest("DELETE", "/api/chat/group"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: messagesQueryKey });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
      toast({ title: "General chat cleared" });
    },
    onError: () => {
      toast({ title: "Failed to clear General chat", variant: "destructive" });
    },
  });

  const stopRecordingTracks = useCallback(() => {
    recordingStreamRef.current?.getTracks().forEach((t) => t.stop());
    recordingStreamRef.current = null;
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state !== "inactive") {
        mediaRecorderRef.current?.stop();
      }
      stopRecordingTracks();
    };
  }, [stopRecordingTracks]);

  useEffect(() => {
    if (isRecording && mediaRecorderRef.current?.state !== "inactive") {
      mediaRecorderRef.current?.stop();
    }
    if (isRecording && useNativeRecorder) {
      void cancelNativeRecording();
    }
    stopRecordingTracks();
    setIsRecording(false);
    setRecordingSeconds(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvoKey]);

  async function sendMediaMessage(content: string) {
    const recipientId = activeConvo.type === "dm" ? activeConvo.recipientId : null;
    await apiRequest("POST", "/api/chat/messages", { recipientId, content });
    qc.invalidateQueries({ queryKey: messagesQueryKey });
    qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
  }

  async function handleImageFile(file: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setUploadingImage(true);
    setShowAttachMenu(false);
    try {
      const { objectUrl } = await prepareAndUploadFile(file, { preset: "chat" });
      await sendMediaMessage(`[img]${objectUrl}`);
    } catch (err) {
      toast({
        title: err instanceof UploadValidationError ? err.message : "Image upload failed",
        variant: "destructive",
      });
    } finally {
      setUploadingImage(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
    }
  }

  async function uploadAndSendVoice(blob: Blob, mimeType: string) {
    setUploadingVoice(true);
    try {
      const { objectUrl } = await uploadFile(blob, mimeType);
      await sendMediaMessage(`[audio]${objectUrl}`);
    } catch (err) {
      const message = err instanceof UploadValidationError
        ? err.message
        : "Voice note upload failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setUploadingVoice(false);
    }
  }

  async function handleVoiceFile(file: File) {
    const isAudio =
      file.type.startsWith("audio/") ||
      /\.(m4a|mp3|webm|ogg|aac|3gp|amr|wav)$/i.test(file.name);
    if (!isAudio) {
      toast({ title: "Please select an audio recording", variant: "destructive" });
      return;
    }
    setUploadingVoice(true);
    setShowAttachMenu(false);
    try {
      const contentType = file.type || "audio/mp4";
      const { objectUrl } = await uploadFile(file, contentType);
      await sendMediaMessage(`[audio]${objectUrl}`);
    } catch (err) {
      const message = err instanceof UploadValidationError
        ? err.message
        : "Voice note upload failed";
      toast({ title: message, variant: "destructive" });
    } finally {
      setUploadingVoice(false);
      if (voiceInputRef.current) voiceInputRef.current.value = "";
    }
  }

  function voiceErrorDescription(description: string): string {
    if (description === "mic-denied") return nativeMicDeniedHint();
    if (description === "needs-apk-update") return nativeVoiceApkUpdateHint();
    return description;
  }

  function handleMicPress() {
    if (isRecording) {
      stopVoiceRecording();
      return;
    }
    if (Capacitor.isNativePlatform()) {
      if (useNativeRecorder) {
        void startNativeVoiceRecording();
      } else {
        // Old APK shells cannot use WebView MediaRecorder on Samsung — open system capture instead.
        setShowAttachMenu(false);
        voiceCaptureInputRef.current?.click();
      }
      return;
    }
    startVoiceRecording();
  }

  async function startNativeVoiceRecording() {
    if (isRecording || uploadingVoice || uploadingImage) return;
    setShowAttachMenu(false);
    try {
      await startNativeRecording();
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopVoiceRecording();
            return MAX_VOICE_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: unknown) {
      setIsRecording(false);
      setRecordingSeconds(0);
      const { title, description } = recordingErrorMessage(err);
      toast({
        title,
        description: voiceErrorDescription(description),
        variant: "destructive",
      });
    }
  }

  async function startVoiceRecording() {
    if (isRecording || uploadingVoice || uploadingImage) return;
    setShowAttachMenu(false);
    let stream: MediaStream | null = null;
    try {
      stream = await openMicStream();
      recordingStreamRef.current = stream;
      audioChunksRef.current = [];
      const recorder = createAudioMediaRecorder(stream);
      const mimeType = recorderMimeType(recorder);
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.onstop = () => {
        stopRecordingTracks();
        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size > 0) {
          uploadAndSendVoice(blob, mimeType);
        }
        mediaRecorderRef.current = null;
        setIsRecording(false);
        setRecordingSeconds(0);
      };
      mediaRecorderRef.current = recorder;
      recorder.start();
      setRecordingSeconds(0);
      setIsRecording(true);
      recordingTimerRef.current = setInterval(() => {
        setRecordingSeconds((s) => {
          if (s + 1 >= MAX_VOICE_SECONDS) {
            stopVoiceRecording();
            return MAX_VOICE_SECONDS;
          }
          return s + 1;
        });
      }, 1000);
    } catch (err: unknown) {
      stopRecordingTracks();
      setIsRecording(false);
      setRecordingSeconds(0);
      const { title, description } = recordingErrorMessage(err);
      toast({
        title,
        description: voiceErrorDescription(description),
        variant: "destructive",
      });
    }
  }

  function stopVoiceRecording() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (useNativeRecorder && isRecording) {
      setIsRecording(false);
      setRecordingSeconds(0);
      setUploadingVoice(true);
      void stopNativeRecording()
        .then(({ blob, mimeType }) => uploadAndSendVoice(blob, mimeType))
        .catch(() => {
          toast({ title: "Recording failed", description: "Could not save voice note.", variant: "destructive" });
          setUploadingVoice(false);
        });
      return;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    } else {
      stopRecordingTracks();
      setIsRecording(false);
      setRecordingSeconds(0);
    }
  }

  function handleSend() {
    const trimmed = text.trim();
    if (!trimmed || sendMutation.isPending) return;
    sendMutation.mutate(trimmed);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleSelectDmUser(user: OrgUser) {
    setActiveConvo({ type: "dm", recipientId: user.id, recipientName: `${user.firstName} ${user.lastName}`, recipientAvatarUrl: user.avatarUrl ?? null });
    setShowThread(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function selectGroup() {
    setActiveConvo({ type: "group" });
    setShowThread(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function selectDm(convo: Conversation) {
    if (!convo.recipientId) return;
    setActiveConvo({
      type: "dm",
      recipientId: convo.recipientId,
      recipientName: `${convo.recipientFirstName ?? ""} ${convo.recipientLastName ?? ""}`.trim(),
      recipientAvatarUrl: convo.recipientAvatarUrl,
    });
    setShowThread(true);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  const totalUnread = conversations.reduce((sum, c) => sum + c.unreadCount, 0);

  const isActiveGroup = activeConvo.type === "group";
  const isActiveDm = (rid: string) => activeConvo.type === "dm" && activeConvo.recipientId === rid;

  const groupConvo = conversations[0];
  const dmConvos = conversations.slice(1);

  type MsgGroup = { date: string; messages: ChatMessage[] };
  const grouped: MsgGroup[] = [];
  let currentDate = "";
  for (const msg of messages) {
    const date = new Date(msg.createdAt).toLocaleDateString("en-ZA", { weekday: "long", day: "numeric", month: "long" });
    if (date !== currentDate) {
      grouped.push({ date, messages: [] });
      currentDate = date;
    }
    grouped[grouped.length - 1].messages.push(msg);
  }

  function renderMessageContent(content: string, isMe: boolean) {
    if (content.startsWith("[img]")) {
      return <ChatImageMessage url={content.slice(5)} />;
    }
    if (content.startsWith("[audio]")) {
      return <ChatAudioMessage url={content.slice(7)} isMe={isMe} />;
    }
    return (
      <div
        className={cn(
          "px-3 py-2 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words",
          isMe
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "bg-muted rounded-bl-sm"
        )}
      >
        {content}
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden" data-testid="page-chat">
      {/* Hidden file inputs */}
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
        data-testid="input-gallery-upload"
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImageFile(f); }}
        data-testid="input-camera-capture"
      />
      <input
        ref={voiceInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleVoiceFile(f); }}
        data-testid="input-voice-file"
      />
      <input
        ref={voiceCaptureInputRef}
        type="file"
        accept="audio/*"
        capture="user"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handleVoiceFile(f);
          e.target.value = "";
        }}
        data-testid="input-voice-capture"
      />

      {/* Left panel — conversation list */}
      <div className={cn(
        "shrink-0 border-r flex flex-col bg-sidebar",
        "w-full md:w-72",
        showThread ? "hidden md:flex" : "flex"
      )}>
        <div className="p-3 border-b">
          <PageHero
            compact
            eyebrow="Chat"
            badge={conversations.length === 1 ? "1 thread" : `${conversations.length} threads`}
            total={totalUnread}
            totalLabel="Unread"
            totalTestId="badge-total-unread"
            leading={
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => window.history.back()}
                data-testid="button-chat-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            }
            actions={
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1"
                onClick={() => setNewDmOpen(true)}
                data-testid="button-new-dm"
              >
                <Plus className="h-3.5 w-3.5" />
                New
              </Button>
            }
            insights={[{ label: "Channels", value: "Group + DMs" }]}
          />
        </div>

        <ScrollArea className="flex-1">
          <div className="px-2 py-1 space-y-0.5">
            <button
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                isActiveGroup ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
              )}
              onClick={selectGroup}
              data-testid="button-convo-general"
            >
              <div className="h-9 w-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0 border border-primary/20">
                <Users className="h-4 w-4 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-sm font-medium truncate">General</span>
                  {groupConvo?.lastMessageAt && (
                    <span className="text-xs text-muted-foreground shrink-0">{formatTime(groupConvo.lastMessageAt)}</span>
                  )}
                </div>
                {groupConvo?.lastMessage && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{previewMessage(groupConvo.lastMessage)}</p>
                )}
              </div>
              {(groupConvo?.unreadCount ?? 0) > 0 && (
                <Badge className="h-5 min-w-5 px-1.5 text-xs shrink-0" data-testid="badge-unread-general">
                  {groupConvo.unreadCount}
                </Badge>
              )}
            </button>

            {dmConvos.length > 0 && (
              <div className="px-2 pt-3 pb-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Direct Messages</p>
              </div>
            )}

            {dmConvos.map((convo) => (
              <button
                key={convo.recipientId}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-left",
                  isActiveDm(convo.recipientId!) ? "bg-primary/10 text-primary" : "hover:bg-muted/60"
                )}
                onClick={() => selectDm(convo)}
                data-testid={`button-convo-dm-${convo.recipientId}`}
              >
                <Initials firstName={convo.recipientFirstName ?? ""} lastName={convo.recipientLastName ?? ""} avatarUrl={convo.recipientAvatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-medium truncate">{convo.recipientFirstName} {convo.recipientLastName}</span>
                    {convo.lastMessageAt && (
                      <span className="text-xs text-muted-foreground shrink-0">{formatTime(convo.lastMessageAt)}</span>
                    )}
                  </div>
                  {convo.lastMessage && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{previewMessage(convo.lastMessage)}</p>
                  )}
                </div>
                {convo.unreadCount > 0 && (
                  <Badge className="h-5 min-w-5 px-1.5 text-xs shrink-0" data-testid={`badge-unread-dm-${convo.recipientId}`}>
                    {convo.unreadCount}
                  </Badge>
                )}
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Right panel — message thread */}
      <div className={cn(
        "flex flex-col flex-1 min-w-0",
        !showThread ? "hidden md:flex" : "flex"
      )}>
        {/* Thread header — title + admin clear (General only) */}
        <div className="hidden md:flex items-center justify-between px-4 py-2 border-b shrink-0 bg-background">
          <div className="flex items-center gap-2 min-w-0">
            {activeConvo.type === "group" ? (
              <>
                <Users className="h-4 w-4 text-primary shrink-0" />
                <span className="font-medium text-sm truncate">General</span>
              </>
            ) : (
              <>
                <Initials
                  firstName={activeConvo.recipientName.split(" ")[0] ?? ""}
                  lastName={activeConvo.recipientName.split(" ").slice(1).join(" ") ?? ""}
                  avatarUrl={activeConvo.recipientAvatarUrl}
                  size="sm"
                />
                <span className="font-medium text-sm truncate">{activeConvo.recipientName}</span>
              </>
            )}
          </div>
          {activeConvo.type === "group" && isAdmin && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                  disabled={clearGroupMutation.isPending || messages.length === 0}
                  data-testid="button-clear-general-chat"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1" />
                  Clear chat
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear General chat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes all messages in the General channel for your organization. Direct messages are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => clearGroupMutation.mutate()}
                  >
                    Clear all messages
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {/* Minimal back row — mobile only */}
        <div className="flex md:hidden items-center justify-between px-2 py-1.5 border-b shrink-0 bg-background">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowThread(false)}
            data-testid="button-back-to-conversations"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm font-medium truncate flex-1 text-center px-2">
            {activeConvo.type === "group" ? "General" : activeConvo.recipientName}
          </span>
          {activeConvo.type === "group" && isAdmin ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  disabled={clearGroupMutation.isPending || messages.length === 0}
                  data-testid="button-clear-general-chat-mobile"
                  aria-label="Clear General chat"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Clear General chat?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This permanently deletes all messages in the General channel. Direct messages are not affected.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() => clearGroupMutation.mutate()}
                  >
                    Clear all
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : (
            <div className="w-8" />
          )}
        </div>

        {/* Messages */}
        <ScrollArea className="flex-1 px-4 py-3">
          {grouped.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 py-16">
              <MessageSquare className="h-10 w-10 opacity-20" />
              <p className="text-sm">No messages yet. Say hello!</p>
            </div>
          )}
          {grouped.map((group) => (
            <div key={group.date}>
              <div className="flex items-center gap-3 my-4">
                <div className="flex-1 h-px bg-border" />
                <span className="text-xs text-muted-foreground shrink-0">{group.date}</span>
                <div className="flex-1 h-px bg-border" />
              </div>
              <div className="space-y-3">
                {group.messages.map((msg, idx) => {
                  const isMe = msg.senderId === me?.id;
                  const prevMsg = group.messages[idx - 1];
                  const showAvatar = !prevMsg || prevMsg.senderId !== msg.senderId;
                  const isMedia = msg.content.startsWith("[img]") || msg.content.startsWith("[audio]");
                  const canDelete = isMe || isAdmin;

                  return (
                    <div
                      key={msg.id}
                      className={cn("flex items-end gap-2 group", isMe && "flex-row-reverse")}
                      data-testid={`msg-${msg.id}`}
                    >
                      <div className="shrink-0 w-7">
                        {showAvatar && !isMe && (
                          <Initials firstName={msg.senderFirstName} lastName={msg.senderLastName} avatarUrl={msg.senderAvatarUrl} size="sm" />
                        )}
                      </div>

                      <div className={cn("max-w-[70%] flex flex-col gap-0.5", isMe && "items-end")}>
                        {showAvatar && (
                          <span className={cn("text-xs text-muted-foreground font-medium px-1", isMe && "text-right")}>
                            {isMe ? "You" : `${msg.senderFirstName} ${msg.senderLastName}`}
                          </span>
                        )}
                        <div className={cn("flex items-end gap-1.5", isMedia && "flex-col", isMe && !isMedia && "flex-row-reverse")}>
                          {!isMedia && isMe && (
                            <span className="text-[10px] text-muted-foreground shrink-0 mb-0.5">{formatMessageTime(msg.createdAt)}</span>
                          )}
                          {renderMessageContent(msg.content, isMe)}
                          {!isMedia && !isMe && (
                            <span className="text-[10px] text-muted-foreground shrink-0 mb-0.5">{formatMessageTime(msg.createdAt)}</span>
                          )}
                          {isMedia && (
                            <span className={cn("text-[10px] text-muted-foreground", isMe && "self-end")}>{formatMessageTime(msg.createdAt)}</span>
                          )}
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className={cn(
                                "h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive opacity-70 md:opacity-0 md:group-hover:opacity-100",
                                deleteMutation.isPending && "pointer-events-none opacity-40",
                              )}
                              onClick={() => deleteMutation.mutate(msg.id)}
                              aria-label="Delete message"
                              data-testid={`button-delete-msg-${msg.id}`}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
          <div ref={messagesEndRef} />
        </ScrollArea>

        {/* Input bar */}
        <div className="px-3 py-3 border-t shrink-0 bg-background">
          {isRecording && (
            <div className="flex items-center justify-between gap-2 mb-2 px-2 py-2 rounded-lg bg-destructive/10 border border-destructive/20">
              <div className="flex items-center gap-2 text-sm text-destructive">
                <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
                Recording {formatRecordingTime(recordingSeconds)}
              </div>
              <Button
                size="sm"
                variant="destructive"
                className="h-8 gap-1"
                onClick={stopVoiceRecording}
                data-testid="button-stop-voice-recording"
              >
                <Square className="h-3 w-3 fill-current" />
                Stop
              </Button>
            </div>
          )}
          {/* Attach menu */}
          {showAttachMenu && !isRecording && (
            <div className="flex items-center gap-2 mb-2 px-1">
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded-lg hover:bg-muted/60"
                onClick={() => galleryInputRef.current?.click()}
                data-testid="button-attach-gallery"
              >
                <ImageIcon className="h-4 w-4" />
                Gallery
              </button>
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded-lg hover:bg-muted/60"
                onClick={() => cameraInputRef.current?.click()}
                data-testid="button-attach-camera"
              >
                <Camera className="h-4 w-4" />
                Camera
              </button>
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors py-1 px-2 rounded-lg hover:bg-muted/60"
                onClick={() => voiceInputRef.current?.click()}
                data-testid="button-attach-audio-file"
              >
                <Mic className="h-4 w-4" />
                Audio file
              </button>
            </div>
          )}
          <div className="flex items-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn("shrink-0 h-10 w-10 rounded-xl", showAttachMenu && "text-primary bg-primary/10")}
              onClick={() => setShowAttachMenu((v) => !v)}
              disabled={uploadingImage || uploadingVoice || isRecording}
              data-testid="button-toggle-attach"
              aria-label="Attach image"
            >
              {uploadingImage ? (
                <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "shrink-0 h-10 w-10 rounded-xl",
                isRecording && "text-destructive bg-destructive/10",
              )}
              onClick={handleMicPress}
              disabled={uploadingImage || uploadingVoice || sendMutation.isPending}
              data-testid="button-voice-note"
              aria-label={isRecording ? "Stop recording" : "Record voice note"}
            >
              {uploadingVoice ? (
                <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              ) : (
                <Mic className="h-4 w-4" />
              )}
            </Button>
            <textarea
              ref={inputRef}
              className="flex-1 min-h-[40px] max-h-32 resize-none rounded-xl border bg-muted/40 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 placeholder:text-muted-foreground"
              placeholder={activeConvo.type === "group" ? "Message General…" : `Message ${activeConvo.type === "dm" ? activeConvo.recipientName : ""}…`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
              disabled={isRecording}
              data-testid="input-chat-message"
            />
            <Button
              size="icon"
              className="shrink-0 h-10 w-10 rounded-xl"
              onClick={handleSend}
              disabled={!text.trim() || sendMutation.isPending || isRecording}
              data-testid="button-send-message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      <NewDmDialog
        open={newDmOpen}
        onOpenChange={setNewDmOpen}
        onSelect={handleSelectDmUser}
        currentUserId={me?.id ?? ""}
      />
    </div>
  );
}
