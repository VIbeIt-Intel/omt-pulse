import { useEffect, useState } from "react";
import { FileText, Loader2, Mic, Paperclip } from "lucide-react";
import { resolveAttachmentKind } from "@/lib/attachment-kind";
import { PhotoLightbox } from "@/components/photo-lightbox";
import { useAuthedMediaUrl } from "@/lib/authed-media";

function AudioAttachmentPlayer({
  url,
  filename,
  alt,
  compact = false,
}: {
  url: string;
  filename?: string;
  alt: string;
  compact?: boolean;
}) {
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;

    async function load() {
      if (url.startsWith("data:") || url.startsWith("blob:")) {
        setPlaybackUrl(url);
        setError(false);
        return;
      }

      if (url.startsWith("/objects/")) {
        setLoading(true);
        setError(false);
        try {
          const res = await fetch(url, { credentials: "include" });
          if (!res.ok) throw new Error("fetch failed");
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setPlaybackUrl(objectUrl);
        } catch {
          if (!cancelled) {
            setError(true);
            setPlaybackUrl(null);
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      setPlaybackUrl(url);
      setError(false);
    }

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  return (
    <div
      className={
        compact
          ? "flex flex-col gap-1.5 p-2 border border-border rounded-md bg-muted/30 min-w-0"
          : "flex flex-col gap-2 p-3 border border-border/70 rounded-lg bg-background min-w-0"
      }
    >
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
        <Mic className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="truncate font-medium text-foreground">{filename ?? alt}</span>
      </div>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          Loading voice note…
        </div>
      ) : error ? (
        <p className="text-xs text-destructive py-1">Could not load voice note — try again after submitting.</p>
      ) : playbackUrl ? (
        <audio
          controls
          controlsList="nodownload"
          src={playbackUrl}
          className="w-full min-h-[44px]"
          preload="metadata"
          data-testid="audio-attachment-player"
        />
      ) : null}
    </div>
  );
}

export function AttachmentPreview({
  url,
  alt,
  mimeType,
  filename,
  compact = false,
}: {
  url: string;
  alt: string;
  mimeType?: string;
  filename?: string;
  /** Smaller layout for thumbnail grids. */
  compact?: boolean;
}) {
  const kind = resolveAttachmentKind(mimeType, filename ?? alt);
  const isServable =
    url.startsWith("data:") ||
    url.startsWith("blob:") ||
    url.startsWith("/objects/") ||
    url.startsWith("https://") ||
    url.startsWith("http://");
  const isImage = kind !== "audio" && kind !== "file";
  const needsAuthFetch = url.startsWith("/objects/");
  const { src, loading, error } = useAuthedMediaUrl(isImage && isServable && needsAuthFetch ? url : null);
  const [broken, setBroken] = useState(() => !isServable);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const imageSrc = needsAuthFetch ? src : isServable ? url : null;

  if (kind === "audio") {
    return (
      <AudioAttachmentPlayer
        url={url}
        filename={filename}
        alt={alt}
        compact={compact}
      />
    );
  }

  if (kind === "file") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1.5 p-2 border border-border rounded-md text-xs text-primary hover:underline bg-muted/30 min-w-0"
      >
        <Paperclip className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{filename ?? alt}</span>
      </a>
    );
  }

  if (broken || error || (!loading && !imageSrc)) {
    return (
      <div className="flex flex-col items-center justify-center h-20 text-muted-foreground gap-1">
        <FileText className="h-6 w-6 opacity-40" />
        <span className="text-xs opacity-60">File unavailable</span>
      </div>
    );
  }

  if (loading || !imageSrc) {
    return (
      <div className="flex items-center justify-center h-20 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin opacity-60" />
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
          src={imageSrc}
          alt={alt}
          className="w-full h-20 object-cover rounded"
          onError={() => setBroken(true)}
        />
      </button>
      <PhotoLightbox
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        src={imageSrc}
        alt={alt}
        title={filename ?? alt}
      />
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

export { resolveAttachmentKind } from "@/lib/attachment-kind";
