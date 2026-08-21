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

export type CapabilityDecision = "deny" | "ask" | "allow_once";

export interface AgentCapabilityRequest {
  requestId: string;
  capability: AgentCapability;
  reason: string;
  resource?: string;
}

export interface AgentCapabilityResult {
  requestId: string;
  decision: CapabilityDecision;
  data?: unknown;
  error?: string;
}

export const V1_AGENT_POLICY: Record<AgentCapability, CapabilityDecision> = {
  "filesystem.read_file": "deny",
  "filesystem.read_directory": "deny",
  "documents.search": "deny",
  "documents.summarize_pdf": "deny",
  "email.read": "deny",
  "software.install": "deny",
  "system.execute": "deny",
  "browser.control": "deny",
  "automation.run": "deny",
  "github.access": "deny",
  "external_tool.use": "deny"
};
