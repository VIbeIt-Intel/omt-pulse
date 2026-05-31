import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Lock, Eye, EyeOff, Mail } from "lucide-react";
import africaLogo from "../assets/africa-logo.png";
import { HeartbeatLine } from "@/components/heartbeat-line";
import omtLogo from "@/assets/omt-logo-v2.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

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
    <div className="min-h-screen w-full bg-[#0a0a0f] overflow-hidden relative flex items-center justify-center px-6">

      {/* Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.15),transparent_50%)]" />
        <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_bottom_right,rgba(6,182,212,0.1),transparent_50%)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(34,197,94,0.08),transparent_70%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(34,197,94,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(34,197,94,0.02)_1px,transparent_1px)] bg-[size:12px_12px]" />
        <div className="absolute top-20 left-20 w-2 h-2 bg-green-500/40 rounded-full animate-pulse" />
        <div className="absolute top-40 right-32 w-1 h-1 bg-cyan-400/50 rounded-full animate-pulse" style={{ animationDelay: "0.5s" }} />
        <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-green-500/30 rounded-full animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-20 right-20 w-2 h-2 bg-cyan-400/30 rounded-full animate-pulse" style={{ animationDelay: "1.5s" }} />
        <div className="absolute top-1/4 left-10 w-[1px] h-32 bg-gradient-to-b from-transparent via-green-500/20 to-transparent" />
        <div className="absolute top-1/3 right-16 w-[1px] h-48 bg-gradient-to-b from-transparent via-cyan-400/10 to-transparent" />
        <div className="absolute bottom-1/4 left-1/4 w-24 h-[1px] bg-gradient-to-r from-transparent via-green-500/15 to-transparent" />
      </div>

      {/* Content: two-column on md+, stacked on mobile */}
      <div className="relative z-10 w-full max-w-4xl flex flex-col md:flex-row items-center gap-12 md:gap-20">

        {/* Left — branding + description */}
        <div className="flex-1 text-center md:text-left space-y-5">
          <div>
            <div className="flex flex-col md:flex-row items-center md:items-start gap-4 mb-3">
              <img src={omtLogo} alt="OMT Pulse" className="w-16 h-16 shrink-0 object-contain" />
              <div className="text-center md:text-left">
                <h1 className="text-4xl font-bold tracking-tight text-white" data-testid="text-login-title">OMT Pulse</h1>
                <HeartbeatLine className="w-28 h-6 mx-auto md:mx-0 mt-1 opacity-80" />
                <div className="flex items-center gap-2 mt-1 justify-center md:justify-start">
                  <div className="h-px w-6 bg-gradient-to-r from-transparent to-primary/50" />
                  <span className="text-[9px] text-white/30 font-light">powered by</span>
                  <span className="text-[10px] font-semibold tracking-[0.12em] uppercase text-primary/60">IntelAfri</span>
                  <div className="h-px w-6 bg-gradient-to-l from-transparent to-primary/50" />
                </div>
              </div>
            </div>
          </div>
          <div className="hidden md:block w-16 h-px bg-primary/40" />
          <p className="hidden md:block text-white/55 text-sm leading-relaxed max-w-sm">
            Track, manage, and respond to security incidents with precision. From initial reporting through to resolution, OMT provides a structured workflow for documenting occurrences, assigning tasks, and ensuring accountability across your organisation.
          </p>
          <div className="hidden md:flex flex-col gap-2">
            {FEATURES.map((f) => (
              <div key={f} className="flex items-center gap-2 text-xs text-white/40">
                <span className="w-1 h-1 rounded-full bg-primary/60 shrink-0" />
                {f}
              </div>
            ))}
          </div>
        </div>

        {/* Right — login card */}
        <div className="w-full max-w-sm">
          <div className="rounded-xl p-6 bg-black/40 backdrop-blur-xl border border-primary/20 shadow-2xl shadow-primary/5 space-y-6 text-white [&_label]:text-white/80 [&_.text-muted-foreground]:text-white/45 [&_p.text-muted-foreground]:text-white/45">
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
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                          <Input
                            {...field}
                            type="email"
                            placeholder="you@organisation.com"
                            className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/35 focus-visible:ring-primary/50"
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
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
                          <Input
                            {...field}
                            type={showPassword ? "text" : "password"}
                            placeholder="Enter your password"
                            className="pl-9 pr-10 bg-white/10 border-white/20 text-white placeholder:text-white/35 focus-visible:ring-primary/50"
                            data-testid="input-password"
                            autoComplete="current-password"
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword((v) => !v)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors"
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
                <Button
                  type="submit"
                  className="w-full"
                  disabled={loginMutation.isPending}
                  data-testid="button-sign-in"
                >
                  {loginMutation.isPending ? "Signing in..." : "Sign In"}
                </Button>
              </form>
            </Form>
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link href="/register" className="text-primary font-medium hover:underline" data-testid="link-register">
                Register here
              </Link>
            </p>
            <p className="text-center text-xs text-white/35">
              <Link href="/privacy" className="hover:text-white/60 hover:underline" data-testid="link-privacy-login">
                Privacy Policy
              </Link>
            </p>
          </div>
        </div>

      </div>
    </div>
  );
}
