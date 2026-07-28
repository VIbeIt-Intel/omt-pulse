import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ROTATE180_OSD_HINT, type CctvCameraPublic } from "@shared/cctv";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";

const formSchema = z.object({
  name: z.string().min(1, "Name is required").max(120),
  rtspUrl: z
    .string()
    .min(8, "Enter a valid RTSP URL")
    .max(2000)
    .refine((u) => /^rtsp:\/\//i.test(u.trim()), "Must start with rtsp://"),
  username: z.string().max(200).optional(),
  streamRotation: z.enum(["normal", "rotate180"]).default("normal"),
  streamQuality: z.enum(["high", "medium", "low"]).default("medium"),
  aiEnabled: z.boolean().default(false),
  isPtz: z.boolean().default(false),
  password: z.string().max(500).optional(),
});

type FormValues = z.infer<typeof formSchema>;

type CctvCameraFormSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  camera?: CctvCameraPublic | null;
  onSaved: () => void;
};

export function CctvCameraFormSheet({
  open,
  onOpenChange,
  camera,
  onSaved,
}: CctvCameraFormSheetProps) {
  const isEdit = !!camera;

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      rtspUrl: "",
      username: "",
      streamRotation: "normal",
      streamQuality: "medium",
      aiEnabled: false,
      isPtz: false,
      password: "",
    },
  });

  useEffect(() => {
    if (!open) return;
    if (camera) {
      form.reset({
        name: camera.name,
        rtspUrl: camera.rtspPreview,
        username: camera.username ?? "",
        streamRotation: camera.streamRotation,
        streamQuality: camera.streamQuality ?? "medium",
        aiEnabled: !!camera.aiEnabled,
        isPtz: camera.isPtz,
        password: "",
      });
    } else {
      form.reset({
        name: "",
        rtspUrl: "",
        username: "",
        streamRotation: "normal",
        streamQuality: "medium",
        aiEnabled: false,
        isPtz: false,
        password: "",
      });
    }
  }, [open, camera, form]);

  async function onSubmit(values: FormValues) {
    const body: Record<string, unknown> = {
      name: values.name.trim(),
      rtspUrl: values.rtspUrl.trim(),
      streamRotation: values.streamRotation,
      streamQuality: values.streamQuality,
      aiEnabled: values.aiEnabled,
      isPtz: values.isPtz,
    };

    if (isEdit && camera) {
      // Keep saved username/password unless the user changes them.
      if (values.username?.trim()) {
        body.username = values.username.trim();
      }
      if (values.password?.trim()) {
        body.password = values.password.trim();
      }
      await apiRequest("PATCH", `/api/cctv/cameras/${camera.id}`, body);
    } else {
      body.username = values.username?.trim() || null;
      if (values.password?.trim()) {
        body.password = values.password.trim();
      }
      await apiRequest("POST", "/api/cctv/cameras", body);
    }
    onSaved();
    onOpenChange(false);
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto sm:max-w-md" data-testid="cctv-camera-form-sheet">
        <SheetHeader>
          <SheetTitle>{isEdit ? "Edit camera" : "Add camera"}</SheetTitle>
          <SheetDescription>
            RTSP streams are converted to HLS on the server for browser playback. Credentials are stored
            encrypted and never shown again after saving.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Camera name</FormLabel>
                  <FormControl>
                    <Input placeholder="Gate 1 — North" {...field} data-testid="cctv-input-name" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="rtspUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>RTSP URL</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="rtsp://192.168.1.50:554/stream1"
                      className="font-mono text-xs"
                      {...field}
                      data-testid="cctv-input-rtsp"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="streamRotation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Orientation</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="cctv-input-rotation">
                        <SelectValue placeholder="Choose orientation" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="rotate180">Rotate 180 degrees</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>{ROTATE180_OSD_HINT}</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="streamQuality"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stream Quality</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger data-testid="cctv-input-quality">
                        <SelectValue placeholder="Choose quality" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="high">High (best quality, higher bandwidth)</SelectItem>
                      <SelectItem value="medium">Medium (balanced – default)</SelectItem>
                      <SelectItem value="low">Low (lower bandwidth)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    High/Medium keep the camera’s native stream when possible. Low re-encodes at lower
                    resolution and bitrate for slower connections. Saving restarts the live stream.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="aiEnabled"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <FormLabel>AI analytics</FormLabel>
                    <FormDescription>
                      Detect people and vehicles (car, truck, bus, motorcycle) on the VPS every 4
                      seconds. Shows boxes on the live view and in-app alerts (60s cooldown).
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="cctv-input-ai-enabled"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="isPtz"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-3">
                  <div className="space-y-1">
                    <FormLabel>PTZ camera</FormLabel>
                    <FormDescription>
                      Mark this camera as pan-tilt-zoom capable so OMT can expose PTZ controls.
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="cctv-input-is-ptz"
                    />
                  </FormControl>
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Username</FormLabel>
                  <FormControl>
                    <Input
                      autoComplete="off"
                      placeholder="admin"
                      {...field}
                      data-testid="cctv-input-username"
                    />
                  </FormControl>
                  <FormDescription>Saved with the camera. Used for ONVIF / PTZ.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      autoComplete="new-password"
                      placeholder={isEdit && camera?.hasCredentials ? "•••••••• (saved)" : undefined}
                      {...field}
                      data-testid="cctv-input-password"
                    />
                  </FormControl>
                  <FormDescription>
                    {isEdit && camera?.hasCredentials
                      ? "A password is already saved. Leave blank to keep it — only type a new one to replace it."
                      : "Saved encrypted. For PTZ use the EZVIZ ONVIF password; the RTSP device code can stay in the RTSP URL."}
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
            <SheetFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={form.formState.isSubmitting} data-testid="cctv-save-camera">
                {form.formState.isSubmitting ? "Saving…" : isEdit ? "Save changes" : "Add camera"}
              </Button>
            </SheetFooter>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
