export type AgentCapability =
  | "filesystem.read_file"
  | "filesystem.read_directory"
  | "documents.search"
  | "documents.summarize_pdf"
  | "email.read"
  | "software.install"
  | "system.execute"
  | "browser.control"
  | "automation.run"
  | "github.access"
  | "external_tool.use";

export interface AgentToolDefinition {
  id: string;
  capability: AgentCapability;
  description: string;
  requiresDesktop: boolean;
  risk: "low" | "medium" | "high" | "critical";
}

export interface AgentExecutionContext {
  userId: string;
  conversationId: string;
  desktopSessionId?: string;
}
