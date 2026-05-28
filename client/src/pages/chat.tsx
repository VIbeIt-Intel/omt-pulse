import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageSquare, Send, Plus, Search, Users, ArrowLeft, ImageIcon, Camera } from "lucide-react";
import { cn } from "@/lib/utils";

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
  avatarUrl?: string | null;
};

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
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);
  const [showThread, setShowThread] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [text, setText] = useState("");
  const [uploadingImage, setUploadingImage] = useState(false);
  const [activeConvo, setActiveConvo] = useState<{ type: "group" } | { type: "dm"; recipientId: string; recipientName: string; recipientAvatarUrl: string | null }>({ type: "group" });

  const { data: me } = useQuery<AuthUser>({ queryKey: ["/api/auth/me"] });

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

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  useEffect(() => {
    const rid = activeConvo.type === "group" ? null : activeConvo.recipientId;
    markRead(rid);
  }, [activeConvo, markRead]);

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

  async function handleImageFile(file: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please select an image file", variant: "destructive" });
      return;
    }
    setUploadingImage(true);
    setShowAttachMenu(false);
    try {
      const uploadResp = await fetch("/api/uploads", {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        credentials: "include",
        body: file,
      });
      if (!uploadResp.ok) throw new Error(`Upload failed: ${uploadResp.status}`);
      const { objectUrl } = await uploadResp.json();
      const recipientId = activeConvo.type === "dm" ? activeConvo.recipientId : null;
      await apiRequest("POST", "/api/chat/messages", {
        recipientId,
        content: `[img]${objectUrl}`,
      });
      qc.invalidateQueries({ queryKey: messagesQueryKey });
      qc.invalidateQueries({ queryKey: ["/api/chat/conversations"] });
    } catch {
      toast({ title: "Image upload failed", variant: "destructive" });
    } finally {
      setUploadingImage(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
      if (cameraInputRef.current) cameraInputRef.current.value = "";
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
      const url = content.slice(5);
      const imgSrc = url.startsWith("data:") ? url : (() => { try { return new URL(url).pathname; } catch { return url; } })();
      return (
        <a href={imgSrc} target="_blank" rel="noopener noreferrer" data-testid="msg-image-link">
          <img
            src={imgSrc}
            alt="Shared image"
            className="max-w-[220px] rounded-xl border border-white/10 object-cover cursor-pointer"
            onError={(e) => { (e.currentTarget as HTMLImageElement).alt = "Image unavailable"; }}
          />
        </a>
      );
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

      {/* Left panel — conversation list */}
      <div className={cn(
        "shrink-0 border-r flex flex-col bg-sidebar",
        "w-full md:w-72",
        showThread ? "hidden md:flex" : "flex"
      )}>
        <div className="p-4 border-b">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 -ml-1 mr-0.5"
                onClick={() => navigate("/")}
                data-testid="button-chat-back"
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
              <MessageSquare className="h-4 w-4 text-primary" />
              Chat
              {totalUnread > 0 && (
                <Badge className="h-5 min-w-5 px-1.5 text-xs" data-testid="badge-total-unread">
                  {totalUnread}
                </Badge>
              )}
            </h2>
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
          </div>
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
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{groupConvo.lastMessage}</p>
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
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{convo.lastMessage}</p>
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
        {/* Minimal back row — mobile only, no name/avatar */}
        <div className="flex md:hidden items-center px-2 py-1.5 border-b shrink-0 bg-background">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setShowThread(false)}
            data-testid="button-back-to-conversations"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
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
                  const isImage = msg.content.startsWith("[img]");

                  return (
                    <div
                      key={msg.id}
                      className={cn("flex items-end gap-2", isMe && "flex-row-reverse")}
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
                        <div className={cn("flex items-end gap-1.5", isImage && "flex-col", isMe && !isImage && "flex-row-reverse")}>
                          {!isImage && isMe && (
                            <span className="text-[10px] text-muted-foreground shrink-0 mb-0.5">{formatMessageTime(msg.createdAt)}</span>
                          )}
                          {renderMessageContent(msg.content, isMe)}
                          {!isImage && !isMe && (
                            <span className="text-[10px] text-muted-foreground shrink-0 mb-0.5">{formatMessageTime(msg.createdAt)}</span>
                          )}
                          {isImage && (
                            <span className={cn("text-[10px] text-muted-foreground", isMe && "self-end")}>{formatMessageTime(msg.createdAt)}</span>
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
          {/* Attach menu */}
          {showAttachMenu && (
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
            </div>
          )}
          <div className="flex items-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              className={cn("shrink-0 h-10 w-10 rounded-xl", showAttachMenu && "text-primary bg-primary/10")}
              onClick={() => setShowAttachMenu((v) => !v)}
              disabled={uploadingImage}
              data-testid="button-toggle-attach"
              aria-label="Attach image"
            >
              {uploadingImage ? (
                <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
              ) : (
                <ImageIcon className="h-4 w-4" />
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
              data-testid="input-chat-message"
            />
            <Button
              size="icon"
              className="shrink-0 h-10 w-10 rounded-xl"
              onClick={handleSend}
              disabled={!text.trim() || sendMutation.isPending}
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
