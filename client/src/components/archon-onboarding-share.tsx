import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, CheckCheck, Mail, MailWarning, Link2, MessageCircle } from "lucide-react";
import {
  archonInstallUrl,
  buildArchonOnboardingMessage,
  type OnboardingUserInfo,
} from "@/lib/onboarding-messages";

type ArchonOnboardingShareProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: OnboardingUserInfo | null;
  panelBg?: React.CSSProperties;
};

function emailBanner(user: OnboardingUserInfo) {
  const status = user.emailStatus ?? "manual";
  if (status === "sent") {
    return {
      icon: Mail,
      className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
      title: "Invite email sent",
      body: `Primary delivery is email to ${user.email}. Use the options below only if they need a backup copy.`,
    };
  }
  if (status === "failed") {
    return {
      icon: MailWarning,
      className: "border-amber-500/30 bg-amber-500/10 text-amber-300",
      title: "Email could not be sent",
      body: `Check SendGrid on the server, then use Resend invite — or copy the invite link for ${user.email} below.`,
    };
  }
  if (status === "skipped") {
    return {
      icon: MailWarning,
      className: "border-white/15 bg-white/5 text-white/70",
      title: "Welcome email was skipped",
      body: `No email was sent. Copy the invite link for ${user.email}, or use Resend invite from the user list.`,
    };
  }
  return {
    icon: Mail,
    className: "border-white/15 bg-white/5 text-white/70",
    title: "Manual share",
    body: `Email is the normal invite channel. Copy the link below if you need to resend or share offline.`,
  };
}

export function ArchonOnboardingShare({ open, onOpenChange, user, panelBg }: ArchonOnboardingShareProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);
  const [copiedPlayLink, setCopiedPlayLink] = useState(false);

  if (!user) return null;

  const message = buildArchonOnboardingMessage(user);
  const installUrl = archonInstallUrl();
  const banner = emailBanner(user);
  const BannerIcon = banner.icon;

  function handleCopyMsg() {
    navigator.clipboard.writeText(message).then(() => {
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2500);
    });
  }

  function handleCopyInviteLink() {
    if (!user.inviteUrl) return;
    navigator.clipboard.writeText(user.inviteUrl).then(() => {
      setCopiedInviteLink(true);
      setTimeout(() => setCopiedInviteLink(false), 2500);
    });
  }

  function handleCopyPlayLink() {
    if (!installUrl) return;
    navigator.clipboard.writeText(installUrl).then(() => {
      setCopiedPlayLink(true);
      setTimeout(() => setCopiedPlayLink(false), 2500);
    });
  }

  function handleWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }

  function handleClose(next: boolean) {
    if (!next) {
      setCopiedMsg(false);
      setCopiedInviteLink(false);
      setCopiedPlayLink(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="border-white/20 sm:max-w-md max-h-[85vh] overflow-y-auto gap-3 p-4 sm:p-5"
        style={panelBg}
      >
        <DialogHeader className="space-y-1.5 text-left">
          <DialogTitle className="text-white flex items-center gap-2 text-base">
            <Mail className="h-4 w-4 text-primary shrink-0" />
            Onboarding — {user.firstName}
          </DialogTitle>
          <p className="text-xs text-white/50">
            Invites are sent by email. WhatsApp is optional backup only.
          </p>
        </DialogHeader>

        <div className={`rounded-lg border px-3 py-2.5 flex gap-2.5 ${banner.className}`} data-testid="banner-archon-email-status">
          <BannerIcon className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="min-w-0 space-y-0.5">
            <p className="text-sm font-medium text-white">{banner.title}</p>
            <p className="text-xs text-white/60 leading-snug">{banner.body}</p>
          </div>
        </div>

        {user.inviteUrl && (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider text-white/40">Invite link</p>
            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 flex items-center gap-2">
              <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="flex-1 text-xs font-mono text-white/60 truncate" title={user.inviteUrl}>
                {user.inviteUrl}
              </span>
            </div>
            <Button
              className="w-full h-9 bg-primary hover:bg-primary/90 text-white gap-2"
              onClick={handleCopyInviteLink}
              data-testid="button-archon-copy-invite-link"
            >
              {copiedInviteLink
                ? <><CheckCheck className="h-4 w-4" /> Invite link copied</>
                : <><Copy className="h-4 w-4" /> Copy invite link</>}
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wider text-white/40">Message preview</p>
          <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 max-h-28 overflow-y-auto">
            <p className="text-[11px] leading-relaxed text-white/55 whitespace-pre-wrap break-words" data-testid="text-archon-onboarding-message">
              {message}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full h-8 text-xs gap-1.5 border-white/20 text-white/80 hover:bg-white/10"
            onClick={handleCopyMsg}
            data-testid="button-archon-onboarding-copy"
          >
            {copiedMsg
              ? <><CheckCheck className="h-3.5 w-3.5 text-green-400" /> Message copied</>
              : <><Copy className="h-3.5 w-3.5" /> Copy full message</>}
          </Button>
        </div>

        {installUrl ? (
          <div className="rounded-md border border-white/10 bg-white/5 px-2.5 py-2 flex items-center gap-2">
            <span className="text-[11px] text-white/40 shrink-0">Android</span>
            <span className="flex-1 text-[11px] font-mono text-white/50 truncate">{installUrl}</span>
            <button
              type="button"
              onClick={handleCopyPlayLink}
              className="shrink-0 text-white/50 hover:text-white"
              data-testid="button-archon-copy-install-link"
            >
              {copiedPlayLink ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-amber-400/90 rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 py-1.5 leading-snug">
            Install link missing — set <code className="text-[10px]">VITE_PLAY_TESTING_JOIN_URL</code> on the server.
          </p>
        )}

        <button
          type="button"
          onClick={handleWhatsApp}
          className="text-xs text-white/45 hover:text-white/75 flex items-center justify-center gap-1.5 py-1 transition-colors"
          data-testid="button-archon-onboarding-whatsapp"
        >
          <MessageCircle className="h-3.5 w-3.5" />
          Optional: share via WhatsApp instead
        </button>

        <DialogFooter className="sm:justify-end pt-0">
          <Button
            variant="ghost"
            className="text-white/60 hover:text-white hover:bg-white/10 h-8"
            onClick={() => handleClose(false)}
            data-testid="button-archon-onboarding-done"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
