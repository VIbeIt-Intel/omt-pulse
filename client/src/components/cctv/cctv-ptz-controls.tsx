import { useCallback, useEffect, useRef } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Minus,
  Plus,
  Square,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type PtzAction =
  | "left"
  | "right"
  | "up"
  | "down"
  | "zoom_in"
  | "zoom_out"
  | "stop";

type CctvPtzControlsProps = {
  cameraId: number;
  /** Compact pad for overlaying on the live video. */
  overlay?: boolean;
  className?: string;
};

export function CctvPtzControls({ cameraId, overlay = false, className }: CctvPtzControlsProps) {
  const { toast } = useToast();
  const seq = useRef(0);
  const activeAction = useRef<PtzAction | null>(null);
  const lastErrorAt = useRef(0);

  const send = useCallback(
    (action: PtzAction) => {
      const mySeq = ++seq.current;
      if (action !== "stop") activeAction.current = action;
      else activeAction.current = null;

      void (async () => {
        try {
          await apiRequest("POST", `/api/cctv/cameras/${cameraId}/ptz`, { action });
        } catch (err) {
          if (mySeq !== seq.current) return;
          const now = Date.now();
          if (now - lastErrorAt.current < 1500) return;
          lastErrorAt.current = now;
          const message = err instanceof Error ? err.message : "PTZ command failed";
          toast({ variant: "destructive", title: "PTZ", description: message });
        }
      })();
    },
    [cameraId, toast],
  );

  useEffect(() => {
    void apiRequest("POST", `/api/cctv/cameras/${cameraId}/ptz/warmup`, {}).catch(() => undefined);
  }, [cameraId]);

  function bindHold(action: PtzAction) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        send(action);
      },
      onPointerUp: (e: React.PointerEvent) => {
        e.stopPropagation();
        send("stop");
      },
      onPointerCancel: () => send("stop"),
      onLostPointerCapture: () => {
        if (activeAction.current === action) send("stop");
      },
    };
  }

  const padBtn = cn(
    overlay
      ? "h-9 w-9 bg-black/55 text-white border-white/20 hover:bg-black/75 shadow-sm backdrop-blur-sm"
      : undefined,
  );

  return (
    <div
      className={cn(
        overlay
          ? "pointer-events-auto flex flex-col items-center gap-2 rounded-xl bg-black/35 p-2 backdrop-blur-sm"
          : "flex flex-wrap items-center gap-4",
        className,
      )}
      data-testid={`cctv-ptz-${cameraId}`}
    >
      <div className="grid grid-cols-3 gap-1">
        <div />
        <Button type="button" variant="outline" size="icon" className={padBtn} aria-label="Tilt up" {...bindHold("up")}>
          <ArrowUp className="h-4 w-4" />
        </Button>
        <div />
        <Button type="button" variant="outline" size="icon" className={padBtn} aria-label="Pan left" {...bindHold("left")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="icon"
          className={padBtn}
          aria-label="Stop"
          onClick={(e) => {
            e.stopPropagation();
            send("stop");
          }}
        >
          <Square className="h-4 w-4" />
        </Button>
        <Button type="button" variant="outline" size="icon" className={padBtn} aria-label="Pan right" {...bindHold("right")}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div />
        <Button type="button" variant="outline" size="icon" className={padBtn} aria-label="Tilt down" {...bindHold("down")}>
          <ArrowDown className="h-4 w-4" />
        </Button>
        <div />
      </div>
      <div className={cn("flex gap-1", overlay && "flex-col")}>
        <Button
          type="button"
          variant="outline"
          size={overlay ? "icon" : "sm"}
          className={cn(padBtn, !overlay && "px-3")}
          aria-label="Zoom out"
          {...bindHold("zoom_out")}
        >
          <Minus className="h-4 w-4" />
          {!overlay && <span className="ml-1">Zoom out</span>}
        </Button>
        <Button
          type="button"
          variant="outline"
          size={overlay ? "icon" : "sm"}
          className={cn(padBtn, !overlay && "px-3")}
          aria-label="Zoom in"
          {...bindHold("zoom_in")}
        >
          <Plus className="h-4 w-4" />
          {!overlay && <span className="ml-1">Zoom in</span>}
        </Button>
      </div>
    </div>
  );
}
