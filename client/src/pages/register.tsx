import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

const registerSchema = z.object({
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
  email: z.string().email("Valid email address is required"),
  organization: z.string().min(1, "Organization is required"),
  organizationAddress: z.string().min(1, "Organization address is required"),
  organizationPhone: z.string().min(1, "Organization contact number is required"),
  password: z.string().min(10, "Password must be at least 10 characters"),
  repeatPassword: z.string().min(1, "Please confirm your password"),
}).refine((data) => data.password === data.repeatPassword, {
  message: "Passwords do not match",
  path: ["repeatPassword"],
});

type RegisterForm = z.infer<typeof registerSchema>;

export default function RegisterPage() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      organization: "",
      organizationAddress: "",
      organizationPhone: "",
      password: "",
      repeatPassword: "",
    },
  });

  const registerMutation = useMutation({
    mutationFn: (data: RegisterForm) => apiRequest("POST", "/api/auth/register", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      navigate("/");
    },
    onError: (err: any) => {
      toast({
        title: "Registration failed",
        description: err.message || "Could not create account",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen w-full bg-[#0a0a0f] overflow-hidden relative flex items-center justify-center px-4 py-10">
      {/* Ambient glows */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-0 left-0 w-full h-full bg-[radial-gradient(ellipse_at_top,rgba(34,197,94,0.15),transparent_50%)]" />
        <div className="absolute bottom-0 right-0 w-full h-full bg-[radial-gradient(ellipse_at_bottom_right,rgba(6,182,212,0.1),transparent_50%)]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(34,197,94,0.08),transparent_70%)]" />
        {/* Grid overlays */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(34,197,94,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(34,197,94,0.03)_1px,transparent_1px)] bg-[size:60px_60px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(34,197,94,0.02)_1px,transparent_1px),linear-gradient(to_bottom,rgba(34,197,94,0.02)_1px,transparent_1px)] bg-[size:12px_12px]" />
        {/* Floating dots */}
        <div className="absolute top-20 left-20 w-2 h-2 bg-green-500/40 rounded-full animate-pulse" />
        <div className="absolute top-40 right-32 w-1 h-1 bg-cyan-400/50 rounded-full animate-pulse" style={{ animationDelay: "0.5s" }} />
        <div className="absolute bottom-32 left-40 w-1.5 h-1.5 bg-green-500/30 rounded-full animate-pulse" style={{ animationDelay: "1s" }} />
        <div className="absolute bottom-20 right-20 w-2 h-2 bg-cyan-400/30 rounded-full animate-pulse" style={{ animationDelay: "1.5s" }} />
        {/* Accent lines */}
        <div className="absolute top-1/4 left-10 w-[1px] h-32 bg-gradient-to-b from-transparent via-green-500/20 to-transparent" />
        <div className="absolute top-1/3 right-16 w-[1px] h-48 bg-gradient-to-b from-transparent via-cyan-400/10 to-transparent" />
        <div className="absolute bottom-1/4 left-1/4 w-24 h-[1px] bg-gradient-to-r from-transparent via-green-500/15 to-transparent" />
      </div>

      <div className="relative z-10 w-full max-w-md space-y-8">
        <div className="text-center space-y-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white" data-testid="text-register-title">Create Administrator Account</h1>
            <p className="text-sm text-white/50 mt-1">Set up the OMT for your organization</p>
          </div>
        </div>

        <div className="rounded-xl p-6 bg-black/40 backdrop-blur-xl border border-primary/20 shadow-2xl shadow-primary/5 space-y-6 [&_label]:text-white/80 [&_.text-muted-foreground]:text-white/45 [&_p.text-muted-foreground]:text-white/45 [&_input]:bg-white/10 [&_input]:border-white/20 [&_input]:text-white [&_input::placeholder]:text-white/35 [&_.border-t]:border-white/10">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => registerMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="John" data-testid="input-first-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last Name <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Smith" data-testid="input-last-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email Address <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} type="email" placeholder="john@example.com" data-testid="input-email" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="organization"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="Acme Security Pty Ltd" data-testid="input-organization" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="organizationAddress"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Address <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="1 Main Street, Johannesburg" data-testid="input-organization-address" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="organizationPhone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Organization Contact Number <span className="text-destructive">*</span></FormLabel>
                    <FormControl>
                      <Input {...field} type="tel" placeholder="+27 11 000 0000" data-testid="input-organization-phone" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="border-t pt-4 space-y-4">
                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Password <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Minimum 10 characters"
                          data-testid="input-password"
                          autoComplete="new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="repeatPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Repeat Password <span className="text-destructive">*</span></FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="password"
                          placeholder="Repeat your password"
                          data-testid="input-repeat-password"
                          autoComplete="new-password"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={registerMutation.isPending}
                data-testid="button-create-account"
              >
                {registerMutation.isPending ? "Creating account..." : "Create Account"}
              </Button>
            </form>
          </Form>

          <p className="text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline" data-testid="link-sign-in">
              Sign in
            </Link>
          </p>
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/privacy" className="hover:underline" data-testid="link-privacy-register">
              Privacy Policy
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
