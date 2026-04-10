import { useState } from "react";
import { useLocation } from "wouter";
import { useAdminLogin } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { useQueryClient } from "@tanstack/react-query";
import { getGetAdminMeQueryKey } from "@workspace/api-client-react";

export default function AdminLogin() {
  const [password, setPassword] = useState("");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const loginMutation = useAdminLogin({
    mutation: {
      onSuccess: (data) => {
        if (data.success && data.token) {
          localStorage.setItem("wearurway_admin_token", data.token);
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
          <Button
            type="submit"
            className="w-full rounded-none uppercase tracking-widest h-12 font-bold"
            disabled={loginMutation.isPending}
            data-testid="button-login"
          >
            {loginMutation.isPending ? "Authenticating..." : "Enter"}
          </Button>
        </form>

        <p className="text-center text-xs text-muted-foreground mt-6 uppercase tracking-widest">
          Default password: admin123
        </p>
      </motion.div>
    </div>
  );
}
