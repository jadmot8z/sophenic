import type { AgentToolDefinition } from "./contracts";

export const futureAgentTools: AgentToolDefinition[] = [
  { id: "local-file-reader", capability: "filesystem.read_file", description: "Lire un fichier choisi par l’utilisateur", requiresDesktop: true, risk: "medium" },
  { id: "local-directory-reader", capability: "filesystem.read_directory", description: "Analyser un dossier explicitement sélectionné", requiresDesktop: true, risk: "medium" },
  { id: "pdf-summarizer", capability: "documents.summarize_pdf", description: "Résumer un PDF", requiresDesktop: false, risk: "low" },
  { id: "email-reader", capability: "email.read", description: "Lire des emails via connecteur OAuth", requiresDesktop: false, risk: "medium" },
  { id: "software-installer", capability: "software.install", description: "Installer un logiciel après confirmation", requiresDesktop: true, risk: "critical" },
  { id: "terminal", capability: "system.execute", description: "Exécuter une commande système après confirmation", requiresDesktop: true, risk: "critical" },
  { id: "browser", capability: "browser.control", description: "Piloter une session navigateur autorisée", requiresDesktop: true, risk: "high" },
  { id: "github", capability: "github.access", description: "Interagir avec GitHub via OAuth et scopes limités", requiresDesktop: false, risk: "medium" }
];

export const agentRuntime = {
  enabled: false,
  tools: futureAgentTools
};
