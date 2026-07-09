import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Lock, Eye, EyeOff, Mail, ArrowLeft } from "lucide-react";
import { HeartbeatLine } from "@/components/heartbeat-line";
import { OmtShield } from "@/components/omt-shield";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { clearStoredWorkstationToken } from "@/lib/workstation-session";

const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

type LoginForm = z.infer<typeof loginSchema>;

const FEATURES = [
  "Rapid incident capture",
  "Role-based access control",
  "Analytics & heatmaps",
  "Multi-location support",
];

export default function LoginPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    clearStoredWorkstationToken();
  }, []);

  const form = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const loginMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      return res;
    },
    onSuccess: () => {
      queryClient.clear();
      navigate("/");
    },
    onError: (err: any) => {
      toast({
        title: "Sign in failed",
        description: err.message || "Invalid password",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-background">
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/8 via-background to-background" />

      <div className="mx-auto flex min-h-screen max-w-4xl flex-col px-4 py-6 sm:px-6">
        <Link
          href="/"
          className="mb-8 inline-flex w-fit items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          data-testid="link-back-home"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to home
        </Link>

        <div className="flex flex-1 flex-col items-center justify-center gap-12 md:flex-row md:gap-16">
          {/* Left — branding */}
          <div className="flex-1 space-y-5 text-center md:text-left">
            <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
              <OmtShield variant="mark" className="h-16 w-16 shrink-0 rounded-2xl" />
              <div>
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl" data-testid="text-login-title">
                  OMT Pulse
                </h1>
                <HeartbeatLine className="mx-auto mt-1 h-6 w-28 opacity-80 md:mx-0" />
                <p className="mt-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  An IntelAfri product
                </p>
              </div>
            </div>
            <p className="hidden max-w-sm text-sm leading-relaxed text-muted-foreground md:block">
              Track, manage, and respond to security incidents with precision — from the occurrence book to live
              responder maps and one-tap panic alerts.
            </p>
            <ul className="hidden flex-col gap-2 md:flex">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Right — sign in */}
          <div className="w-full max-w-sm">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
              <h2 className="mb-1 text-lg font-semibold">Sign in</h2>
              <p className="mb-6 text-sm text-muted-foreground">Use your organisation account</p>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((data) => loginMutation.mutate(data))} className="space-y-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              {...field}
                              type="email"
                              placeholder="you@organisation.com"
                              className="pl-9"
                              data-testid="input-email"
                              autoComplete="email"
                            />
                          </div>
                        </FormControl>
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
                          <div className="relative">
                            <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                              {...field}
                              type={showPassword ? "text" : "password"}
                              placeholder="Enter your password"
                              className="pl-9 pr-10"
                              data-testid="input-password"
                              autoComplete="current-password"
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              tabIndex={-1}
                              data-testid="button-toggle-password"
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="submit" className="w-full" disabled={loginMutation.isPending} data-testid="button-sign-in">
                    {loginMutation.isPending ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </Form>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                Access is by invitation only. Contact your organisation administrator if you need an account.
              </p>
              <p className="mt-3 text-center text-xs text-muted-foreground">
                <Link href="/privacy" className="hover:text-foreground hover:underline" data-testid="link-privacy-login">
                  Privacy Policy
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
