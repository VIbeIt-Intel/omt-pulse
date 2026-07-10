import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import intelafriLogo from "@assets/IntelAfri_Logo_13_January_2025_2_1778851888379.png";

type InviteInfo = { firstName: string; orgName: string | null };
type PageState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "accepting"; firstName: string; orgName: string | null }
  | { phase: "done" };

export default function InvitePage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();

  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [state, setState] = useState<PageState>({ phase: "loading" });

  useEffect(() => {
    if (!token) {
      setState({ phase: "error", message: "No invite token found in this link. Please check the link and try again." });
      return;
    }

    fetch(`/api/invite/${token}`, { credentials: "include" })
      .then(async (res) => {
        const body: { firstName?: string; orgName?: string | null; message?: string } = await res.json();
        if (!res.ok) {
          setState({ phase: "error", message: body.message ?? "Invalid or expired invite link." });
          return;
        }
        const info = body as InviteInfo;
        setState({ phase: "accepting", firstName: info.firstName, orgName: info.orgName ?? null });
        autoAccept(info);
      })
      .catch(() => setState({ phase: "error", message: "Could not reach the server. Please try again." }));
  }, [token]);

  async function autoAccept(info: InviteInfo) {
    try {
      const res = await fetch(`/api/invite/${token}/accept`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const body: { message?: string } = await res.json();
      if (!res.ok) {
        setState({ phase: "error", message: body.message ?? "Failed to accept invite." });
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/onboarding");
    } catch {
      setState({ phase: "error", message: "Could not reach the server. Please try again." });
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img
            src={intelafriLogo}
            alt="IntelAfri"
            className="h-8 object-contain invert dark:invert-0 mx-auto mb-6"
          />
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10 mb-4">
            <KeyRound className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-bold">You've been invited</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Activating your account…
          </p>
        </div>

        <div className="bg-card border rounded-xl p-6 shadow-sm">
          {state.phase === "loading" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Validating invite link…</p>
            </div>
          )}

          {state.phase === "accepting" && (
            <div className="flex flex-col items-center gap-3 py-6">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                Welcome, {state.firstName}! Next you&apos;ll set your password.
              </p>
            </div>
          )}

          {state.phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-destructive">Invite link problem</p>
                <p className="text-sm text-muted-foreground mt-1">{state.phase === "error" ? state.message : ""}</p>
              </div>
              <Button variant="outline" onClick={() => navigate("/login")} className="mt-2">
                Go to Login
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
