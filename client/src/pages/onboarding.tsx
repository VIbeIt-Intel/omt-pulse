import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Eye, EyeOff, Camera, Upload, CheckCircle2, ArrowRight, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

type Step = "password" | "photo";

interface OnboardingPageProps {
  firstName?: string;
}

export default function OnboardingPage({ firstName: _firstName = undefined }: OnboardingPageProps) {
  const [step, setStep] = useState<Step>("password");
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  async function finishOnboarding() {
    await queryClient.refetchQueries({ queryKey: ["/api/auth/me"] });
    navigate("/");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2 mb-8 justify-center">
          <StepIndicator
            num={1}
            label="Set password"
            active={step === "password"}
            done={step === "photo"}
          />
          <div className="flex-1 max-w-[64px] h-px bg-border" />
          <StepIndicator
            num={2}
            label="Profile photo"
            active={step === "photo"}
            done={false}
          />
        </div>
        <div className="bg-card border rounded-xl p-6 shadow-sm">
          {step === "password" && (
            <PasswordStep onSuccess={() => setStep("photo")} />
          )}
          {step === "photo" && (
            <PhotoStep
              onSuccess={finishOnboarding}
              onSkip={finishOnboarding}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function StepIndicator({ num, label, active, done }: { num: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors ${
        done ? "bg-primary border-primary text-primary-foreground" :
        active ? "border-primary text-primary bg-primary/10" :
        "border-muted-foreground/30 text-muted-foreground/50"
      }`}>
        {done ? <CheckCircle2 className="h-4 w-4" /> : num}
      </div>
      <span className={`text-xs ${active ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
    </div>
  );
}

function PasswordStep({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword.length < 10) {
      toast({ title: "Password too short", description: "Minimum 10 characters required.", variant: "destructive" });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    setIsLoading(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", { newPassword });
      onSuccess();
    } catch (err: any) {
      toast({ title: "Error", description: err.message ?? "Failed to change password", variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="font-semibold text-lg">Set your password</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Choose a secure password for your OMT Pulse account.
        </p>
      </div>

      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="new-password">New password <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showNew ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Minimum 10 characters"
              className="pr-10"
              autoComplete="new-password"
              data-testid="input-new-password"
            />
            <button
              type="button"
              onClick={() => setShowNew((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <div className="flex gap-1 pt-0.5">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className={`h-1 flex-1 rounded-full transition-colors ${
                  newPassword.length >= (i + 1) * 2
                    ? newPassword.length >= 10 ? "bg-primary" : "bg-amber-400"
                    : "bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirm password <span className="text-destructive">*</span></Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirm ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              className="pr-10"
              autoComplete="new-password"
              data-testid="input-confirm-password"
            />
            <button
              type="button"
              onClick={() => setShowConfirm((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              tabIndex={-1}
            >
              {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {confirmPassword.length > 0 && (
            <p className={`text-xs ${newPassword === confirmPassword ? "text-primary" : "text-destructive"}`}>
              {newPassword === confirmPassword ? "Passwords match" : "Passwords do not match"}
            </p>
          )}
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isLoading} data-testid="button-set-password">
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ArrowRight className="h-4 w-4 mr-2" />}
        {isLoading ? "Saving..." : "Continue"}
      </Button>
    </form>
  );
}

function PhotoStep({ onSuccess, onSkip }: { onSuccess: () => void; onSkip: () => void }) {
  const { toast } = useToast();
  const [preview, setPreview] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Invalid file", description: "Please select an image file.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "File too large", description: "Maximum file size is 5 MB.", variant: "destructive" });
      return;
    }
    setSelectedFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function handleUpload() {
    if (!selectedFile) return;
    setIsUploading(true);
    try {
      const objectUrl = URL.createObjectURL(selectedFile);
      const avatarDataUrl = await new Promise<string>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(objectUrl);
          const MAX = 256;
          const scale = Math.min(1, MAX / Math.max(img.width, img.height));
          const w = Math.round(img.width * scale);
          const h = Math.round(img.height * scale);
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL("image/jpeg", 0.8));
        };
        img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("Image load failed")); };
        img.src = objectUrl;
      });

      const res = await fetch("/api/users/me/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ avatarDataUrl }),
      });
      if (!res.ok) {
        const msg = await res.json().catch(() => ({ message: "Upload failed" }));
        toast({ title: "Upload failed", description: msg.message ?? "Please try again.", variant: "destructive" });
        return;
      }
      onSuccess();
    } catch {
      toast({ title: "Upload failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-semibold text-lg">Add a profile photo</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload a photo so your team can identify you. You can skip this step and add one later.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        <div
          className="h-28 w-28 rounded-full border-2 border-dashed border-muted-foreground/30 flex items-center justify-center bg-muted/30 overflow-hidden cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileInputRef.current?.click()}
          data-testid="avatar-preview"
        >
          {preview ? (
            <img src={preview} alt="Preview" className="h-full w-full object-cover" />
          ) : (
            <User className="h-12 w-12 text-muted-foreground/40" />
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            data-testid="button-upload-photo"
          >
            <Upload className="h-4 w-4 mr-1.5" />
            Choose file
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => cameraInputRef.current?.click()}
            data-testid="button-take-selfie"
          >
            <Camera className="h-4 w-4 mr-1.5" />
            Take selfie
          </Button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-file-upload"
        />
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="user"
          className="hidden"
          onChange={handleFileChange}
          data-testid="input-camera-capture"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          onClick={onSkip}
          disabled={isUploading}
          data-testid="button-skip-photo"
        >
          Skip for now
        </Button>
        <Button
          type="button"
          className="flex-1"
          onClick={handleUpload}
          disabled={!selectedFile || isUploading}
          data-testid="button-save-photo"
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
          {isUploading ? "Uploading..." : "Save & continue"}
        </Button>
      </div>
    </div>
  );
}
