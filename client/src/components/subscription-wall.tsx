import { Lock, Clock, Mail } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";

type AuthUser = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  subscriptionStatus: string;
  trialEndsAt?: string | null;
  subscriptionCurrentPeriodEnd?: string | null;
};

interface SubscriptionWallProps {
  user: AuthUser;
}

export function SubscriptionWall({ user }: SubscriptionWallProps) {
  const isAdmin = user.role === "administrator";
  const isTrialExpired = user.subscriptionStatus === "expired";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="flex items-center justify-end gap-2 p-3 border-b shrink-0">
        <ThemeToggle />
      </header>
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/10">
              <Lock className="h-8 w-8 text-destructive" />
            </div>
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-wall-title">
              Access Restricted
            </h1>
            <p className="text-muted-foreground">
              {isTrialExpired
                ? "Your 48-hour trial period has expired."
                : "Your subscription has lapsed."}
            </p>
          </div>

          <div className="border rounded-xl p-6 bg-card shadow-sm space-y-4 text-left">
            <div className="flex items-start gap-3">
              {isAdmin ? (
                <Mail className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              ) : (
                <Clock className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {isAdmin ? "Contact IntelAfri to renew" : "Account locked"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {isAdmin
                    ? "Subscriptions are managed by IntelAfri. Contact your account representative or email support to activate or renew access for your organization."
                    : "Your organization's subscription has expired. Please contact your system administrator to renew access."}
                </p>
              </div>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Logged in as {user.firstName} {user.lastName} ({user.role})
          </p>
        </div>
      </div>
    </div>
  );
}
