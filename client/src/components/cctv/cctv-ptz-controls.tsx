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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

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
};

export function CctvPtzControls({ cameraId }: CctvPtzControlsProps) {
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
          // Ignore stale responses after a newer press/release.
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
        e.currentTarget.setPointerCapture(e.pointerId);
        send(action);
      },
      onPointerUp: () => send("stop"),
      onPointerCancel: () => send("stop"),
      onLostPointerCapture: () => {
        if (activeAction.current === action) send("stop");
      },
    };
  }

  return (
    <Card data-testid={`cctv-ptz-${cameraId}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">PTZ controls</CardTitle>
        <CardDescription>
          Hold a direction to move; release to stop. Live video may lag the motors by about a second
          (HLS preview).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-4">
        <div className="grid grid-cols-3 gap-1">
          <div />
          <Button type="button" variant="outline" size="icon" aria-label="Tilt up" {...bindHold("up")}>
            <ArrowUp className="h-4 w-4" />
          </Button>
          <div />
          <Button type="button" variant="outline" size="icon" aria-label="Pan left" {...bindHold("left")}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="icon"
            aria-label="Stop"
            onClick={() => send("stop")}
          >
            <Square className="h-4 w-4" />
          </Button>
          <Button type="button" variant="outline" size="icon" aria-label="Pan right" {...bindHold("right")}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div />
          <Button type="button" variant="outline" size="icon" aria-label="Tilt down" {...bindHold("down")}>
            <ArrowDown className="h-4 w-4" />
          </Button>
          <div />
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" {...bindHold("zoom_out")}>
            <Minus className="h-4 w-4 mr-1" />
            Zoom out
          </Button>
          <Button type="button" variant="outline" size="sm" {...bindHold("zoom_in")}>
            <Plus className="h-4 w-4 mr-1" />
            Zoom in
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
