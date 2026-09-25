import {BrandingHead} from '@/components/Branding';
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import {LocaleProvider} from '@/contexts/LocaleContext';

// Create root with all global providers
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <LocaleProvider><ThemeProvider>
        <BrandingHead />
        <App />
        <Toaster />
      </ThemeProvider></LocaleProvider>
    </AuthProvider>
  </QueryClientProvider>
);
