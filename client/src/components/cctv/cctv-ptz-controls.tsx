import { useCallback, useRef } from "react";
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
  const sending = useRef(false);

  const send = useCallback(
    async (action: PtzAction) => {
      if (sending.current && action !== "stop") return;
      sending.current = true;
      try {
        await apiRequest("POST", `/api/cctv/cameras/${cameraId}/ptz`, { action });
      } catch (err) {
        const message = err instanceof Error ? err.message : "PTZ command failed";
        toast({ variant: "destructive", title: "PTZ", description: message });
      } finally {
        sending.current = false;
      }
    },
    [cameraId, toast],
  );

  function bindHold(action: PtzAction) {
    return {
      onPointerDown: (e: React.PointerEvent) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        void send(action);
      },
      onPointerUp: () => void send("stop"),
      onPointerLeave: () => void send("stop"),
      onPointerCancel: () => void send("stop"),
    };
  }

  return (
    <Card data-testid={`cctv-ptz-${cameraId}`}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">PTZ controls</CardTitle>
        <CardDescription>
          Hold a direction to move; release to stop. Requires{" "}
          <span className="font-mono text-xs">scripts/cctv-lan-rtsp-tunnel.ps1</span> on your PC (RTSP 8554
          + HTTP 8555/8556).
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
            onClick={() => void send("stop")}
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
