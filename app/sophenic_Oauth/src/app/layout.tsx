import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: { default: "Sophenic — Local AI Agent for Windows", template: "%s · Sophenic" },
  description: "Sophenic est un assistant IA Windows avec modèles OpenRouter, personnalisation et outils intégrés."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr" suppressHydrationWarning><body><ThemeProvider>{children}<Toaster richColors position="top-right" /></ThemeProvider></body></html>;
}
