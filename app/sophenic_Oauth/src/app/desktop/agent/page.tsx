import type { Metadata } from "next";
import { LocalAgentWorkspace } from "@/components/agent/local-agent-workspace";

export const metadata: Metadata = {
  title: "Sophenic Desktop",
  description: "Sophenic — assistant IA Windows avec modèles OpenRouter, personnalisation et outils intégrés."
};

export const dynamic = "force-dynamic";

export default function SophenicDesktopAgentPage() {
  return <LocalAgentWorkspace />;
}
