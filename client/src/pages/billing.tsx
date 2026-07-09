import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { CreditCard, CheckCircle2, Clock, AlertCircle, Users, Gift, Mail } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

type BillingStatus = {
  subscriptionStatus: string;
  trialEndsAt: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  breakdown: {
    role: string;
    count: number;
  }[];
};

const ROLE_LABELS: Record<string, string> = {
  administrator: "Administrator",
  control_room: "Control Room",
  supervisor: "Supervisor",
  reporter: "Reporter",
};

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-ZA", {
    day: "numeric", month: "long", year: "numeric"
  });
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) {
    return `${days}d ${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} remaining`;
  }
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")} remaining`;
}

function useCountdown(targetDateStr: string | null | undefined) {
  const [msLeft, setMsLeft] = useState(() =>
    targetDateStr ? Math.max(0, new Date(targetDateStr).getTime() - Date.now()) : 0
  );

  useEffect(() => {
    if (!targetDateStr) return;
    const tick = () => setMsLeft(Math.max(0, new Date(targetDateStr).getTime() - Date.now()));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetDateStr]);

  return msLeft;
}

function StatusBadge({ status, trialEndsAt, periodEnd }: { status: string; trialEndsAt?: string | null; periodEnd?: string | null }) {
  const msLeft = useCountdown(status === "trial" ? trialEndsAt : null);

  if (status === "complimentary") {
    return (
      <div className="flex items-center gap-2">
        <Badge className="bg-emerald-600 text-white gap-1.5">
          <Gift className="h-3 w-3" /> Complimentary Plan
        </Badge>
        <span className="text-sm text-muted-foreground">Courtesy of IntelAfri — no subscription required</span>
      </div>
    );
  }
  if (status === "active") {
    return (
      <div className="flex items-center gap-2">
        <Badge className="bg-green-600 text-white gap-1.5">
          <CheckCircle2 className="h-3 w-3" /> Active
        </Badge>
        <span className="text-sm text-muted-foreground">Valid until {formatDate(periodEnd)}</span>
      </div>
    );
  }
  if (status === "trial") {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="gap-1.5">
          <Clock className="h-3 w-3" /> Trial
        </Badge>
        <span className="text-sm tabular-nums text-muted-foreground" data-testid="text-trial-countdown">
          {formatCountdown(msLeft)}
        </span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <Badge variant="destructive" className="gap-1.5">
        <AlertCircle className="h-3 w-3" /> Expired
      </Badge>
      <span className="text-sm text-muted-foreground">Contact IntelAfri to restore access</span>
    </div>
  );
}

export default function BillingPage() {
  const { data: billing, isLoading } = useQuery<BillingStatus>({
    queryKey: ["/api/billing/status"],
  });

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full max-w-2xl mx-auto">
      <div className="flex items-center gap-3">
        <CreditCard className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-billing-title">Subscription</h1>
          <p className="text-sm text-muted-foreground">View your organization's subscription status</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-48 w-full" />
        </div>
      ) : billing ? (
        <>
          <div className="border rounded-xl p-5 bg-card space-y-2">
            <p className="text-sm font-medium text-muted-foreground uppercase tracking-wide">Subscription Status</p>
            <StatusBadge
              status={billing.subscriptionStatus}
              trialEndsAt={billing.trialEndsAt}
              periodEnd={billing.subscriptionCurrentPeriodEnd}
            />
            {billing.subscriptionStatus === "trial" && (
              <p className="text-xs text-muted-foreground pt-1">
                Your trial expires on {formatDate(billing.trialEndsAt)}. Contact IntelAfri before then to continue access.
              </p>
            )}
          </div>

          <div className="border rounded-xl overflow-hidden">
            <div className="px-5 py-3 bg-muted/50 border-b flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Organization Users</span>
            </div>
            <table className="w-full text-sm">
              <thead className="bg-muted/30 border-b">
                <tr>
                  <th className="text-left px-5 py-2.5 font-medium">Role</th>
                  <th className="text-right px-5 py-2.5 font-medium">Users</th>
                </tr>
              </thead>
              <tbody>
                {billing.breakdown.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-5 py-4 text-center text-muted-foreground">No users in organization</td>
                  </tr>
                ) : (
                  billing.breakdown.map((row) => (
                    <tr key={row.role} className="border-b last:border-0" data-testid={`row-billing-${row.role}`}>
                      <td className="px-5 py-3 capitalize">{ROLE_LABELS[row.role] ?? row.role}</td>
                      <td className="px-5 py-3 text-right">{row.count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {(billing.subscriptionStatus === "expired" || billing.subscriptionStatus === "trial") && (
            <div className="border rounded-xl p-5 bg-card space-y-2">
              <div className="flex items-start gap-3">
                <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">Need to activate or renew?</p>
                  <p className="text-sm text-muted-foreground">
                    Subscriptions are managed by IntelAfri. Contact your account representative or email support to activate, extend, or renew your organization's access.
                  </p>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">Failed to load subscription information.</p>
      )}
    </div>
  );
}
