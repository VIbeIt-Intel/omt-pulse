import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { enrolWorkstation } from "@/lib/workstation-session";
import { queryClient } from "@/lib/queryClient";
import { Loader2, MonitorSmartphone } from "lucide-react";

export default function WorkstationEnrolPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleEnrol() {
    if (!code.trim()) return;
    setLoading(true);
    try {
      const result = await enrolWorkstation(code);
      toast({
        title: "Device enrolled",
        description: `${result.workstation.name} is ready for shift sign-in.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/");
    } catch (err) {
      toast({
        title: "Enrolment failed",
        description: err instanceof Error ? err.message : "Invalid code",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md space-y-6 rounded-xl border bg-card p-6 shadow-sm">
        <div className="text-center space-y-2">
          <MonitorSmartphone className="h-10 w-10 mx-auto text-primary" />
          <h1 className="text-xl font-semibold">Enrol dedicated device</h1>
          <p className="text-sm text-muted-foreground">
            Enter the enrolment code from your administrator to bind this tablet or phone to a gate post or shared shift device.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="enrol-code">Enrolment code</Label>
          <Input
            id="enrol-code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="e.g. A1B2C3D4"
            className="h-12 text-center text-lg tracking-widest font-mono uppercase"
            autoComplete="off"
            autoCapitalize="characters"
          />
        </div>

        <Button type="button" className="w-full h-11" disabled={!code.trim() || loading} onClick={() => void handleEnrol()}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enrol device"}
        </Button>

        <Button type="button" variant="ghost" className="w-full" onClick={() => navigate("/login")}>
          Back to normal sign-in
        </Button>
      </div>
    </div>
  );
}
