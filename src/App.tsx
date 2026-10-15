import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Home from "./pages/Home.tsx";
import Settings from "./pages/Settings.tsx";
import NotFound from "./pages/NotFound.tsx";

// Code-splitting: heavy route hubs loaded on demand (reduces initial bundle).
const Index = lazy(() => import("./pages/Index.tsx"));
const Strategies = lazy(() => import("./pages/Strategies.tsx"));
const Robots = lazy(() => import("./pages/Robots.tsx"));
const Market = lazy(() => import("./pages/Market.tsx"));
const Trends = lazy(() => import("./pages/Trends.tsx"));
const Orders = lazy(() => import("./pages/Orders.tsx"));
const HistoryPage = lazy(() => import("./pages/History.tsx"));

const queryClient = new QueryClient();

// Binance-only: Trading (Futuros), Robôs (Spot/Futuros via ?tab=), Estratégias, Mercado, Configurações.
// Rotas legadas Forex (forex, management, stats, operations, pending-test,
// ai-discovery, robots-performance) foram removidas — redirects abaixo evitam links quebrados.
const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Suspense fallback={<div className="flex h-screen items-center justify-center text-sm text-muted-foreground">A carregar módulo…</div>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/trading" element={<Index />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/robots" element={<Robots />} />
          <Route path="/strategies" element={<Strategies />} />
          <Route path="/market" element={<Market />} />
          <Route path="/trends" element={<Trends />} />
          <Route path="/settings" element={<Settings />} />
          {/* Redirects de compatibilidade (bookmarks/links antigos) */}
          <Route path="/forex" element={<Navigate to="/trading" replace />} />
          <Route path="/ai-discovery" element={<Navigate to="/market" replace />} />
          <Route path="/pending-test" element={<Navigate to="/robots" replace />} />
          <Route path="/robots-performance" element={<Navigate to="/robots" replace />} />
          <Route path="/stats" element={<Navigate to="/market" replace />} />
          <Route path="/operations" element={<Navigate to="/trading" replace />} />
          <Route path="/management" element={<Navigate to="/settings" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
