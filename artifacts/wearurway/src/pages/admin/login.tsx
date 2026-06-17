import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useAdminLogin, useGetAdminMe } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAdminMeQueryKey } from "@workspace/api-client-react";
import { setAdminToken, getAdminToken } from "@/lib/admin-token";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [hasToken] = useState(() => !!getAdminToken());
  const { data: adminMe, isFetching: isCheckingAuth } = useGetAdminMe({
    query: { enabled: hasToken, queryKey: getGetAdminMeQueryKey() },
  });

  useEffect(() => {
    if (hasToken && adminMe?.authenticated) {
      setLocation("/admin/dashboard");
    }
  }, [hasToken, adminMe, setLocation]);

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess: (data) => {
        if (data.success && data.token) {
          setAdminToken(data.token, remember);
          queryClient.invalidateQueries({ queryKey: getGetAdminMeQueryKey() });
          setLocation("/admin/dashboard");
        } else {
          toast({
            title: "Access Denied",
            description: "Invalid password. Try again.",
            variant: "destructive",
          });
        }
      },
      onError: () => {
        toast({
          title: "Access Denied",
          description: "Invalid password. Try again.",
          variant: "destructive",
        });
      }
    }
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    loginMutation.mutate({ data: { password } });
  };

  if (hasToken && (isCheckingAuth || adminMe?.authenticated)) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-sm uppercase tracking-widest text-muted-foreground animate-pulse">Verifying...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm"
      >
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-black uppercase tracking-tighter">Admin Portal</h1>
          <p className="text-muted-foreground text-sm mt-2 uppercase tracking-widest">Restricted Access</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password" className="uppercase tracking-widest text-xs">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-none border-foreground/20 focus-visible:ring-0 focus-visible:border-foreground h-12 bg-transparent"
              placeholder="Enter admin password"
              data-testid="input-password"
            />
          </div>
          <label className="flex items-center gap-2 text-xs uppercase tracking-widest cursor-pointer select-none">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-4 w-4 rounded-none border border-foreground/30 accent-foreground cursor-pointer"
              data-testid="checkbox-remember-me"
            />
            Remember me
          </label>
          <Button
            type="submit"
            className="w-full rounded-none uppercase tracking-widest h-12 font-bold"
            disabled={loginMutation.isPending}
            data-testid="button-login"
          >
            {loginMutation.isPending ? "Authenticating..." : "Enter"}
          </Button>
        </form>

      </motion.div>
    </div>
  );
}
