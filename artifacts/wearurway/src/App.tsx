import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { setAuthTokenGetter } from "@workspace/api-client-react";

import Landing from "@/pages/landing";
import Products from "@/pages/products";
import Fits from "@/pages/fits";
import Colors from "@/pages/colors";
import Sizes from "@/pages/sizes";
import AdminLogin from "@/pages/admin/login";
import AdminDashboard from "@/pages/admin/dashboard";
import Design from "@/pages/design";
import Checkout from "@/pages/checkout";

import { Navbar } from "@/components/layout/navbar";
import { CustomizerProvider } from "@/hooks/use-customizer";
import { getAdminToken } from "@/lib/admin-token";

const queryClient = new QueryClient();

setAuthTokenGetter(() => getAdminToken());

function Router() {
  return (
    <div className="flex flex-col min-h-screen">
      <Navbar />
      <main className="flex-grow">
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/products" component={Products} />
          <Route path="/fits" component={Fits} />
          <Route path="/colors" component={Colors} />
          <Route path="/sizes" component={Sizes} />
          <Route path="/design" component={Design} />
          <Route path="/checkout" component={Checkout} />
          <Route path="/admin" component={AdminLogin} />
          <Route path="/admin/dashboard" component={AdminDashboard} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function MobileDesktopSuggestion() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 768) return;
    try {
      if (localStorage.getItem("ww_mobile_suggestion_seen") === "1") return;
    } catch {}
    setVisible(true);
  }, []);

  const dismiss = () => {
    setVisible(false);
    try { localStorage.setItem("ww_mobile_suggestion_seen", "1"); } catch {}
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-6 bg-black/70 backdrop-blur-sm">
      <div className="w-full max-w-md bg-background border border-border p-8 space-y-5 shadow-2xl text-center">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-muted-foreground mb-2">Heads Up</p>
          <h2 className="text-xl font-black uppercase tracking-wide">Better on Desktop</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-relaxed">
          For the best design experience, we recommend using a laptop or desktop. You can still use all features on mobile though!
        </p>
        <button
          onClick={dismiss}
          className="w-full py-3.5 font-black uppercase text-sm tracking-[0.2em] transition-all active:scale-[0.98]"
          style={{ backgroundColor: "#f5c842", color: "#0d0d0d" }}
        >
          Continue on Mobile
        </button>
      </div>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <CustomizerProvider>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
          <MobileDesktopSuggestion />
        </TooltipProvider>
      </CustomizerProvider>
    </QueryClientProvider>
  );
}

export default App;
