import { useEffect } from "react";
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
import { FaInstagram, FaTiktok, FaPinterest } from "react-icons/fa";

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

function MobileBlocker() {
  return (
    <div className="md:hidden fixed inset-0 z-[9999] flex items-center justify-center bg-background p-6 text-center">
      <div className="max-w-md space-y-4">
        <h1 className="text-2xl font-bold">Desktop Only</h1>
        <p className="text-base text-muted-foreground">
          This website is designed for desktop and laptop use only.
        </p>
        <p className="text-base text-muted-foreground">
          Mobile access is not supported to ensure the best quality and usability of the design tools.
        </p>
        <p className="text-base text-muted-foreground">
          If you don’t have a laptop or desktop and you want to create a specific design, you can message us. And if you don’t have anything in mind, you can check out the designs on Pinterest.
        </p>
        <div className="pt-4">
          <div className="flex items-center justify-center gap-3 flex-wrap">
            <a
              href="https://www.instagram.com/wearurway.store/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Instagram"
              data-testid="link-instagram-mobile"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FaInstagram className="w-5 h-5" />
              <span>Instagram</span>
            </a>
            <a
              href="https://www.tiktok.com/@wearurway"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="TikTok"
              data-testid="link-tiktok-mobile"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FaTiktok className="w-5 h-5" />
              <span>TikTok</span>
            </a>
            <a
              href="https://www.pinterest.com/WEARURWAY/t-shirt-designs/"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Pinterest"
              data-testid="link-pinterest-mobile"
              className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FaPinterest className="w-5 h-5" />
              <span>Pinterest</span>
            </a>
          </div>
        </div>
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
          <MobileBlocker />
        </TooltipProvider>
      </CustomizerProvider>
    </QueryClientProvider>
  );
}

export default App;
