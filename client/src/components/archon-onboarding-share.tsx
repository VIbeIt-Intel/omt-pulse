import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Copy, CheckCheck, Share2, Link2 } from "lucide-react";
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

export function ArchonOnboardingShare({ open, onOpenChange, user, panelBg }: ArchonOnboardingShareProps) {
  const [copiedMsg, setCopiedMsg] = useState(false);
  const [copiedPlayLink, setCopiedPlayLink] = useState(false);
  const [copiedInviteLink, setCopiedInviteLink] = useState(false);

  if (!user) return null;

  const message = buildArchonOnboardingMessage(user);
  const installUrl = archonInstallUrl();

  function handleCopyMsg() {
    navigator.clipboard.writeText(message).then(() => {
      setCopiedMsg(true);
      setTimeout(() => setCopiedMsg(false), 2500);
    });
  }

  function handleCopyPlayLink() {
    if (!installUrl) return;
    navigator.clipboard.writeText(installUrl).then(() => {
      setCopiedPlayLink(true);
      setTimeout(() => setCopiedPlayLink(false), 2500);
    });
  }

  function handleCopyInviteLink() {
    if (!user.inviteUrl) return;
    navigator.clipboard.writeText(user.inviteUrl).then(() => {
      setCopiedInviteLink(true);
      setTimeout(() => setCopiedInviteLink(false), 2500);
    });
  }

  function handleWhatsApp() {
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank");
  }

  function handleClose(next: boolean) {
    if (!next) {
      setCopiedMsg(false);
      setCopiedPlayLink(false);
      setCopiedInviteLink(false);
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="border-white/20 sm:max-w-lg max-h-[90vh] overflow-y-auto" style={panelBg}>
        <DialogHeader>
          <DialogTitle className="text-white flex items-center gap-2">
            <Share2 className="h-4 w-4 text-primary" />
            Send onboarding — {user.firstName}
          </DialogTitle>
        </DialogHeader>

        <p className="text-sm text-white/60">
          IntelAfri-only distribution. Includes the invite link{installUrl ? " and Android install link" : ""}.
        </p>

        <div className="rounded-xl overflow-hidden border border-white/10">
          <div className="bg-[#075e54] px-4 py-2.5 flex items-center gap-2">
            <div className="h-7 w-7 rounded-full bg-white/20 flex items-center justify-center text-xs font-bold text-white">
              {user.firstName.charAt(0).toUpperCase()}
            </div>
            <span className="text-white text-sm font-medium">{user.firstName}</span>
          </div>
          <div className="bg-[#e5ddd5] dark:bg-[#1a1a1a] px-3 py-3">
            <div className="bg-white dark:bg-[#2a2a2a] rounded-lg rounded-tl-none px-3 py-2.5 shadow-sm max-w-[95%] inline-block">
              <p className="text-[12px] leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words" data-testid="text-archon-onboarding-message">
                {message}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            className="w-full h-11 bg-[#25d366] hover:bg-[#1ebe5d] text-white font-semibold gap-2"
            onClick={handleWhatsApp}
            data-testid="button-archon-onboarding-whatsapp"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-white" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
            Send via WhatsApp
          </Button>
          <Button
            variant="outline"
            className="w-full h-10 gap-2 border-white/20 text-white hover:bg-white/10"
            onClick={handleCopyMsg}
            data-testid="button-archon-onboarding-copy"
          >
            {copiedMsg
              ? <><CheckCheck className="h-4 w-4 text-green-400" /> Message copied!</>
              : <><Copy className="h-4 w-4" /> Copy message</>}
          </Button>
        </div>

        {user.inviteUrl && (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="flex-1 text-xs font-mono text-white/50 truncate">{user.inviteUrl}</span>
            <button
              type="button"
              onClick={handleCopyInviteLink}
              className="shrink-0 text-white/50 hover:text-white transition-colors"
              data-testid="button-archon-copy-invite-link"
            >
              {copiedInviteLink ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        )}

        {installUrl ? (
          <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 flex items-center gap-2">
            <Link2 className="h-3.5 w-3.5 text-white/40 shrink-0" />
            <span className="flex-1 text-xs font-mono text-white/50 truncate">{installUrl}</span>
            <button
              type="button"
              onClick={handleCopyPlayLink}
              className="shrink-0 text-white/50 hover:text-white transition-colors"
              data-testid="button-archon-copy-install-link"
            >
              {copiedPlayLink ? <CheckCheck className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
        ) : (
          <p className="text-[11px] text-amber-400/90 rounded-md border border-amber-500/30 bg-amber-500/10 px-2.5 py-2">
            Set <code className="text-[10px]">VITE_PLAY_TESTING_JOIN_URL</code> on the server for automatic install links.
          </p>
        )}

        <DialogFooter>
          <Button
            variant="ghost"
            className="text-white/60 hover:text-white hover:bg-white/10"
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
