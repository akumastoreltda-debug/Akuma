import * as React from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router as WouterRouter, Switch } from "wouter";
import Dashboard from "./pages/dashboard";
import Products from "./pages/products";
import Sales from "./pages/sales";
import Inventory from "./pages/inventory";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
    },
  },
});

function smokeLocation(): [string, (path: string, ...args: any[]) => void] {
  const route = new URLSearchParams(window.location.search).get("route") || "/dashboard";
  return [route, () => undefined];
}

function BrowserSmokeApp() {
  return (
    <ClerkProvider publishableKey="pk_test_Y2xlcmsuZXhhbXBsZS5jb20k">
      <QueryClientProvider client={queryClient}>
        <WouterRouter hook={smokeLocation}>
          <Switch>
            <Route path="/dashboard" component={Dashboard} />
            <Route path="/products" component={Products} />
            <Route path="/sales" component={Sales} />
            <Route path="/inventory" component={Inventory} />
          </Switch>
        </WouterRouter>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

createRoot(document.getElementById("root")!).render(<BrowserSmokeApp />);