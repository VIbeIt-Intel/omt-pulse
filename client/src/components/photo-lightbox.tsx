import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuthedMediaUrl } from "@/lib/authed-media";
import { X } from "lucide-react";

function clampZoom(value: number) {
  return Math.max(1, Math.min(4, Math.round(value * 100) / 100));
}

export function PhotoLightbox({
  open,
  onOpenChange,
  src,
  alt = "",
  title = "Photo",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt?: string;
  title?: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) {
          setZoom(1);
          setDragging(false);
          dragRef.current = null;
        }
      }}
    >
      <DialogContent
        className="h-[92vh] w-[96vw] max-w-[96vw] p-2 bg-black/90 border-0"
        hideDefaultClose
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogClose className="absolute right-3 top-3 z-10 rounded-full bg-black/75 hover:bg-black/95 text-white border border-white/30 p-2 transition-colors focus:outline-none">
          <X className="h-5 w-5" />
          <span className="sr-only">Close</span>
        </DialogClose>
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 border-white/30 bg-black/75 px-3 text-white hover:bg-black/95"
            onClick={() => setZoom((z) => clampZoom(z - 0.25))}
          >
            -
          </Button>
          <div className="min-w-16 rounded-md border border-white/20 bg-black/60 px-2 py-1 text-center text-xs text-white">
            {Math.round(zoom * 100)}%
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 border-white/30 bg-black/75 px-3 text-white hover:bg-black/95"
            onClick={() => setZoom((z) => clampZoom(z + 0.25))}
          >
            +
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-9 border-white/30 bg-black/75 px-3 text-white hover:bg-black/95"
            onClick={() => setZoom(1)}
          >
            Reset
          </Button>
        </div>
        <div
          ref={scrollRef}
          className={cn(
            "h-full overflow-auto rounded",
            zoom > 1 && "cursor-grab",
            dragging && "cursor-grabbing",
          )}
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey && Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
            e.preventDefault();
            setZoom((z) => clampZoom(z + (e.deltaY < 0 ? 0.2 : -0.2)));
          }}
          onMouseDown={(e) => {
            if (zoom <= 1 || !scrollRef.current) return;
            e.preventDefault();
            setDragging(true);
            dragRef.current = {
              x: e.clientX,
              y: e.clientY,
              left: scrollRef.current.scrollLeft,
              top: scrollRef.current.scrollTop,
            };
          }}
          onMouseMove={(e) => {
            if (!dragging || !scrollRef.current || !dragRef.current) return;
            const dx = e.clientX - dragRef.current.x;
            const dy = e.clientY - dragRef.current.y;
            scrollRef.current.scrollLeft = dragRef.current.left - dx;
            scrollRef.current.scrollTop = dragRef.current.top - dy;
          }}
          onMouseUp={() => {
            setDragging(false);
            dragRef.current = null;
          }}
          onMouseLeave={() => {
            setDragging(false);
            dragRef.current = null;
          }}
        >
          <img
            src={src}
            alt={alt}
            className="mx-auto max-w-none rounded object-contain"
            style={{
              maxHeight: zoom === 1 ? "100%" : "none",
              height: zoom === 1 ? "100%" : undefined,
              width: `${zoom * 100}%`,
              objectFit: "contain",
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Thumbnail that opens the almost-fullscreen zoom/pan viewer. */
export function ExpandablePhoto({
  photoUrl,
  className,
  alt = "",
  title = "Photo",
  fallback,
  expandable = true,
}: {
  photoUrl: string | null | undefined;
  className?: string;
  alt?: string;
  title?: string;
  fallback?: ReactNode;
  /** When false, render a static thumbnail (for use inside clickable cards). */
  expandable?: boolean;
}) {
  const { src, loading, error } = useAuthedMediaUrl(photoUrl);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setFailedSrc(null);
  }, [photoUrl, src]);

  const show = Boolean(src) && !error && src !== failedSrc;

  if (!show) {
    if (!fallback) return null;
    return loading ? <div className="animate-pulse">{fallback}</div> : <>{fallback}</>;
  }

  const thumb = (
    <img
      src={src!}
      alt={alt}
      className={cn("object-cover", className)}
      onError={() => setFailedSrc(src)}
    />
  );

  return (
    <>
      {expandable ? (
        <div
          role="button"
          tabIndex={0}
          className="block shrink-0 cursor-zoom-in focus:outline-none"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" && e.key !== " ") return;
            e.preventDefault();
            e.stopPropagation();
            setOpen(true);
          }}
          aria-label={`View ${title}`}
        >
          {thumb}
        </div>
      ) : (
        thumb
      )}
      {expandable && (
        <PhotoLightbox
          open={open}
          onOpenChange={setOpen}
          src={src!}
          alt={alt}
          title={title}
        />
      )}
    </>
  );
}
