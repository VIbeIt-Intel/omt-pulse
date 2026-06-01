import { useState } from "react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { FileText, Mic, Paperclip, X } from "lucide-react";

export function AttachmentPreview({
  url,
  alt,
  mimeType,
  filename,
}: {
  url: string;
  alt: string;
  mimeType?: string;
  filename?: string;
}) {
  const isServable =
    url.startsWith("data:") ||
    url.startsWith("/objects/") ||
    url.startsWith("https://") ||
    url.startsWith("http://");
  const [broken, setBroken] = useState(() => !isServable);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  if (mimeType?.startsWith("audio/")) {
    return (
      <div className="flex flex-col gap-1 p-2 border border-border rounded-md bg-muted/30">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Mic className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate max-w-[160px]">{filename ?? alt}</span>
        </div>
        <audio controls src={url} className="w-full h-8" />
      </div>
    );
  }

  if (mimeType && !mimeType.startsWith("image/")) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 p-2 border border-border rounded-md text-xs text-primary hover:underline bg-muted/30"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate max-w-[160px]">{filename ?? alt}</span>
      </a>
    );
  }

  if (broken) {
    return (
      <div className="flex flex-col items-center justify-center h-20 text-muted-foreground gap-1">
        <FileText className="h-6 w-6 opacity-40" />
        <span className="text-xs opacity-60">File unavailable</span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="w-full block cursor-zoom-in focus:outline-none"
        onClick={() => setLightboxOpen(true)}
        aria-label={`View ${filename ?? alt}`}
      >
        <img
          src={url}
          alt={alt}
          className="w-full h-20 object-cover rounded"
          onError={() => setBroken(true)}
        />
      </button>
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-3xl p-2 bg-black/90 border-0" hideDefaultClose>
          <DialogTitle className="sr-only">{filename ?? alt}</DialogTitle>
          <DialogClose className="absolute right-3 top-3 z-10 rounded-full bg-black/75 hover:bg-black/95 text-white border border-white/30 p-2 transition-colors focus:outline-none">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </DialogClose>
          <img src={url} alt={alt} className="w-full max-h-[85vh] object-contain rounded" />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function attachmentUploaderLabel(
  att: { uploadedByFirstName?: string | null; uploadedByLastName?: string | null; createdAt?: Date | string },
): string {
  const name = `${att.uploadedByFirstName ?? ""} ${att.uploadedByLastName ?? ""}`.trim();
  const when = att.createdAt ? new Date(att.createdAt).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" }) : "";
  if (name && when) return `Added by ${name} · ${when}`;
  if (name) return `Added by ${name}`;
  if (when) return when;
  return "Added before tracking was enabled";
}

/** Digital footprint label for scene vs after-the-fact supplementary evidence. */
export function evidenceFootprintLabel(
  att: { uploadedByFirstName?: string | null; uploadedByLastName?: string | null; createdAt?: Date | string },
  phase: "scene" | "supplementary",
): string {
  const base = attachmentUploaderLabel(att);
  if (phase === "scene") {
    if (base.startsWith("Added by")) return `At scene · ${base}`;
    return `Captured at scene · ${base}`;
  }
  if (base.startsWith("Added by")) return `After incident · ${base}`;
  return `Recorded after incident · ${base}`;
}
