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

import { Navbar } from "@/components/layout/navbar";
import { CustomizerProvider } from "@/hooks/use-customizer";

const queryClient = new QueryClient();

setAuthTokenGetter(() => localStorage.getItem("wearurway_admin_token"));

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
          <Route path="/admin" component={AdminLogin} />
          <Route path="/admin/dashboard" component={AdminDashboard} />
          <Route component={NotFound} />
        </Switch>
      </main>
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
        </TooltipProvider>
      </CustomizerProvider>
    </QueryClientProvider>
  );
}

export default App;
